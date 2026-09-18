"""Evidence — the documents an application is decided on.

An application is a set of claims. Evidence is what turns them into something a
credit officer can act on, so the portal treats a document as a first-class
record with a type, a status, a provenance trail and an owner — not as an
anonymous attachment hanging off a form.

HOW A FILE GETS HERE, and why it is this way round:

    new_document()                 the shelf row exists first
    POST /api/method/upload_file   the framework's own endpoint, against that row
    confirm_document()             the row is stamped with what arrived

The middle step is Frappe's, not ours. `File.has_permission` delegates a private
file's access to the document it is attached to, so attaching to the shelf row
is what makes a citizen's PDF readable by that citizen and by GDB staff and by
nobody else — the framework does the access control, and there is no second
implementation of it here to drift. An upload endpoint of our own would mean
re-deciding that question in code we would then have to be right about forever.

WHAT THE BANK CAN ASK FOR. An underwriter who needs more raises an itemised
information request; the applicant answers it by uploading against it and the
request closes itself. Neither side is left guessing what a case is waiting on.

Endpoints: POST /api/method/gdb_bank.documents.<name>
"""

import os

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from gdb_bank.api import (
	_is_staff,
	_logger,
	_readable_application,
	_require_underwriter,
	_session_user,
)

DOCTYPE = "GDB Applicant Document"
REQUEST_DOCTYPE = "GDB Information Request"

# The typed shelf. THIS LIST AND THE document_type OPTIONS IN
# gdb_applicant_document.json ARE ONE CONTRACT — a type here that the doctype
# does not know is a row that fails to insert, with a validation error naming a
# field the applicant never saw.
DOCUMENT_TYPES = (
	"Identity",
	"Proof of Address",
	"Financials",
	"Business Plan",
	"Bank Statement",
	"Quotation",
	"Other",
)

# Documents about the person rather than the venture. They are kept against the
# applicant with no application, so a returning applicant does not photograph
# their ID card again for a second loan — the ask-once rule in the delivery
# plan, applied where it is cheapest to honour.
PERSONAL_TYPES = ("Identity", "Proof of Address")

# PDF only, and small enough to arrive over a phone connection in Region 9.
# Both are enforced in validate_attachment, which runs on Frappe's own upload
# path — so the limit holds even for a caller that never touches this module.
ALLOWED_EXTENSIONS = (".pdf",)
MAX_FILE_BYTES = 10 * 1024 * 1024

OPEN = "Open"
RECEIVED = "Received"
REPLACED = "Replaced"
REVIEWED = ("Accepted", "Rejected")

DOCUMENT_FIELDS = [
	"name",
	"applicant",
	"applicant_name",
	"application",
	"document_type",
	"status",
	"request",
	"file_url",
	"file_name",
	"file_size",
	"uploaded_on",
	"reviewed_by",
	"reviewed_on",
	"review_note",
	"superseded_by",
	"creation",
]

REQUEST_FIELDS = [
	"name",
	"application",
	"applicant",
	"status",
	"document_type",
	"item",
	"requested_by",
	"requested_on",
	"satisfied_by",
	"responded_on",
]


def _settings() -> dict:
	"""What the upload control needs, from the server that enforces it."""
	return {
		"types": list(DOCUMENT_TYPES),
		"personal_types": list(PERSONAL_TYPES),
		"accepts": ",".join(ALLOWED_EXTENSIONS),
		"max_bytes": MAX_FILE_BYTES,
	}


def required_types(business_stage: str | None) -> tuple:
	"""What the Bank EXPECTS on the shelf for this application.

	Expected, not required: submission is no longer gated on any of it (see
	api.submit_application). This list is what the shelf prompts the applicant
	for and what tells an underwriter, at a glance, that a case arrived thin.

	Identity always. Beyond that the two business stages are different
	propositions and need different evidence: an existing trading business is
	asked for its financials, a start-up for the plan it intends to trade on.
	Asking a start-up for accounts it cannot have would be a form nobody can
	complete honestly.
	"""
	base = ("Identity",)
	stage = (business_stage or "").strip().title()
	if stage == "Existing":
		return base + ("Financials",)
	if stage == "New":
		return base + ("Business Plan",)
	return base


def _held_types(application: str | None, applicant: str) -> set:
	"""Document types this applicant has on file for this case.

	Counts personal documents held against the person as well as documents
	filed on the case itself — an identity document is an identity document
	whichever application it first arrived with.
	"""
	rows = frappe.get_all(
		DOCTYPE,
		filters={
			"applicant": applicant,
			"status": ["!=", REPLACED],
			"file_url": ["is", "set"],
		},
		fields=["document_type", "application"],
	)
	return {
		r.document_type
		for r in rows
		if r.application == application or (not r.application and r.document_type in PERSONAL_TYPES)
	}


def missing_evidence(application: str) -> list:
	"""Expected document types not yet on the shelf. Advisory — it blocks nothing."""
	row = frappe.db.get_value(
		"Loan Application", application, ["gdb_owner", "gdb_business_stage"], as_dict=True
	)
	if not row:
		return []
	held = _held_types(application, row.gdb_owner)
	return [t for t in required_types(row.gdb_business_stage) if t not in held]


@frappe.whitelist()
def document_settings():
	"""The typed list, the accepted format and the size limit."""
	_session_user()
	return _settings()


def _own_application(application: str, user: str):
	"""The applicant's own case. Evidence is theirs to give, and only theirs.

	An officer must not upload an applicant's evidence for them: the record
	would then say the applicant produced something they never saw. Officers
	ask (request_information); applicants answer.
	"""
	row = frappe.db.get_value(
		"Loan Application", application, ["name", "gdb_owner", "docstatus"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.gdb_owner != user:
		frappe.throw(
			_("Evidence is uploaded by the applicant, not on their behalf."),
			frappe.PermissionError,
		)
	return row


@frappe.whitelist()
def new_document(document_type: str, application: str | None = None, request: str | None = None):
	"""Open a shelf row. The file is uploaded against it next, by the framework.

	Returns the row, whose `name` is the `docname` to pass to
	/api/method/upload_file along with doctype=GDB Applicant Document and
	is_private=1.
	"""
	user = _session_user()
	document_type = (document_type or "").strip()
	if document_type not in DOCUMENT_TYPES:
		frappe.throw(_("{0} is not a document type GDB accepts.").format(document_type))

	if application:
		_own_application(application, user)
	elif document_type not in PERSONAL_TYPES:
		frappe.throw(
			_("A {0} document belongs to an application. Say which one.").format(document_type)
		)

	if request:
		ask = frappe.db.get_value(
			REQUEST_DOCTYPE, request, ["application", "applicant", "status"], as_dict=True
		)
		if not ask or ask.applicant != user:
			frappe.throw(_("Information request {0} not found.").format(request))
		if ask.status != OPEN:
			frappe.throw(_("That request is already {0}.").format((ask.status or "").lower()))
		application = application or ask.application

	doc = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"applicant": user,
			"applicant_name": frappe.utils.get_fullname(user),
			"application": application,
			"document_type": document_type,
			"status": RECEIVED,
			"request": request,
		}
	).insert()
	return frappe.db.get_value(DOCTYPE, doc.name, DOCUMENT_FIELDS, as_dict=True)


def validate_attachment(doc, method=None):
	"""Gate every file arriving on a shelf row. Hooked onto File.before_insert.

	This is the enforcement point rather than confirm_document, because the
	upload runs through Frappe's own endpoint and would otherwise land on disk
	before anything of ours had an opinion about it.
	"""
	if doc.attached_to_doctype != DOCTYPE:
		return

	name = (doc.file_name or "").strip()
	extension = os.path.splitext(name)[-1].lower()
	if extension not in ALLOWED_EXTENSIONS:
		frappe.throw(
			_("{0} is not a PDF. GDB accepts PDF documents only.").format(name or _("This file"))
		)

	content = doc.get_content() if hasattr(doc, "get_content") else None
	size = len(content) if content else cint(doc.file_size)
	if size > MAX_FILE_BYTES:
		frappe.throw(
			_("{0} is {1} MB. The limit is {2} MB — please upload a smaller scan.").format(
				name, round(size / 1024 / 1024, 1), MAX_FILE_BYTES // 1024 // 1024
			)
		)

	# Evidence is never public. A shelf row's file is readable through the row,
	# by whoever may read the row, and by nobody who merely has the URL.
	doc.is_private = 1


@frappe.whitelist()
def confirm_document(name: str):
	"""Stamp the shelf row with the file that arrived, and close what it answers.

	Also retires the previous document of the same type on the same case:
	replacement during an application is expected, and the trail
	(superseded_by) is what keeps a replaced document from simply vanishing.
	"""
	user = _session_user()
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.applicant != user:
		frappe.throw(_("This is not your document."), frappe.PermissionError)

	uploaded = frappe.db.get_value(
		"File",
		{"attached_to_doctype": DOCTYPE, "attached_to_name": name},
		["name", "file_url", "file_name", "file_size"],
		as_dict=True,
		order_by="creation desc",
	)
	if not uploaded:
		frappe.throw(_("No file arrived for this document. Please try the upload again."))

	previous = [
		r.name
		for r in frappe.get_all(
			DOCTYPE,
			filters={
				"applicant": user,
				"document_type": doc.document_type,
				"status": ["!=", REPLACED],
				"name": ["!=", name],
				"file_url": ["is", "set"],
			},
			fields=["name", "application"],
		)
		if r.application == doc.application
	]
	for old in previous:
		frappe.db.set_value(DOCTYPE, old, {"status": REPLACED, "superseded_by": name})

	doc.db_set(
		{
			"file_url": uploaded.file_url,
			"file_name": uploaded.file_name,
			"file_size": cint(uploaded.file_size),
			"uploaded_on": now_datetime(),
		}
	)

	if doc.request:
		frappe.db.set_value(
			REQUEST_DOCTYPE,
			doc.request,
			{"status": "Satisfied", "satisfied_by": name, "responded_on": now_datetime()},
		)
	frappe.db.commit()
	_logger().info(
		f"document {name} ({doc.document_type}) uploaded by {user} for "
		f"{doc.application or 'profile'}, replacing {len(previous)}"
	)
	return frappe.db.get_value(DOCTYPE, name, DOCUMENT_FIELDS, as_dict=True)


@frappe.whitelist()
def list_documents(application: str | None = None, applicant: str | None = None):
	"""The shelf: documents on this case, plus the applicant's personal ones.

	Readable by whoever may read the case — the applicant and GDB staff. Staff
	may also ask for one person's shelf by `applicant`, which is how a cluster
	member's own documents reach the underwriter reading the head's case.
	"""
	user = _session_user()
	if application:
		row = _readable_application(application, user)
		owner = row.gdb_owner
	elif applicant and applicant != user:
		if not _is_staff(user):
			frappe.throw(_("You may only read your own documents."), frappe.PermissionError)
		owner = applicant
	else:
		owner = user

	rows = frappe.get_all(
		DOCTYPE, filters={"applicant": owner}, fields=DOCUMENT_FIELDS, order_by="creation asc"
	)
	shelf = [
		r
		for r in rows
		if r.application == application
		or (not r.application and r.document_type in PERSONAL_TYPES)
	]
	return {
		"documents": shelf,
		"missing": missing_evidence(application) if application else [],
		"settings": _settings(),
	}


@frappe.whitelist()
def delete_document(name: str):
	"""Remove a document from a draft. Blocked once the application is with the
	Bank — the doctype's own on_trash says so, and says why."""
	user = _session_user()
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.applicant != user:
		frappe.throw(_("This is not your document."), frappe.PermissionError)
	application = doc.application
	doc.delete()
	frappe.db.commit()
	_logger().info(f"document {name} deleted by {user}")
	return {"deleted": name, "missing": missing_evidence(application) if application else []}


@frappe.whitelist()
def review_document(name: str, status: str, note: str | None = None):
	"""Staff accept or reject one document. Underwriter only.

	Rejecting says the document does not do its job — unreadable, expired, the
	wrong account. It is recorded with a reason rather than deleted, and the
	applicant sees both, because a rejection an applicant cannot read is a case
	that stalls for reasons nobody has stated.
	"""
	staff = _require_underwriter()
	status = (status or "").strip().title()
	if status not in REVIEWED:
		frappe.throw(_("A document is either Accepted or Rejected."))
	if not frappe.db.exists(DOCTYPE, name):
		frappe.throw(_("Document {0} not found.").format(name))

	frappe.db.set_value(
		DOCTYPE,
		name,
		{
			"status": status,
			"reviewed_by": staff,
			"reviewed_on": now_datetime(),
			"review_note": (note or "").strip(),
		},
	)
	frappe.db.commit()
	_logger().info(f"document {name} -> {status} by {staff}")
	return frappe.db.get_value(DOCTYPE, name, DOCUMENT_FIELDS, as_dict=True)


# --------------------------------------------------------------------------
# What the Bank has asked for
# --------------------------------------------------------------------------


@frappe.whitelist()
def request_information(application: str, item: str, document_type: str | None = None):
	"""Ask the applicant for something, itemised. Underwriter only."""
	staff = _require_underwriter()
	item = (item or "").strip()
	if not item:
		frappe.throw(_("Say what you are asking the applicant for."))
	document_type = (document_type or "").strip()
	if document_type and document_type not in DOCUMENT_TYPES:
		frappe.throw(_("{0} is not a document type GDB accepts.").format(document_type))

	row = frappe.db.get_value(
		"Loan Application", application, ["gdb_owner", "docstatus"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if cint(row.docstatus) != 1:
		frappe.throw(_("That application has not been submitted to GDB yet."))

	doc = frappe.get_doc(
		{
			"doctype": REQUEST_DOCTYPE,
			"application": application,
			"applicant": row.gdb_owner,
			"item": item,
			"document_type": document_type or None,
			"status": OPEN,
			"requested_by": staff,
			"requested_on": now_datetime(),
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"information request {doc.name} raised on {application} by {staff}")
	return frappe.db.get_value(REQUEST_DOCTYPE, doc.name, REQUEST_FIELDS, as_dict=True)


@frappe.whitelist()
def withdraw_request(name: str):
	"""Take back an ask. Kept as a withdrawn row, never deleted."""
	staff = _require_underwriter()
	if not frappe.db.exists(REQUEST_DOCTYPE, name):
		frappe.throw(_("Information request {0} not found.").format(name))
	frappe.db.set_value(
		REQUEST_DOCTYPE, name, {"status": "Withdrawn", "responded_on": now_datetime()}
	)
	frappe.db.commit()
	_logger().info(f"information request {name} withdrawn by {staff}")
	return frappe.db.get_value(REQUEST_DOCTYPE, name, REQUEST_FIELDS, as_dict=True)


@frappe.whitelist()
def list_requests(application: str):
	"""Everything the Bank has asked for on this case.

	Applicant-visible by design: an itemised ask is only useful if the person
	who has to answer it can read it.
	"""
	user = _session_user()
	_readable_application(application, user)
	rows = frappe.get_all(
		REQUEST_DOCTYPE,
		filters={"application": application},
		fields=REQUEST_FIELDS,
		order_by="creation asc",
	)
	return {"requests": rows, "open": len([r for r in rows if r.status == OPEN])}
