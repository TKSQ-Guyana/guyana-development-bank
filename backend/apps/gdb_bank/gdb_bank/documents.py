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

from gdb_bank.services.application import _readable_application
from gdb_bank.services.evidence import (  # noqa: F401  (PERSONAL_EVIDENCE, required_types: public rules)
	ALLOWED_EXTENSIONS,
	DOCTYPE,
	DOCUMENT_TYPES,
	MAX_FILE_BYTES,
	OPEN,
	PERSONAL_EVIDENCE,
	PERSONAL_TYPES,
	RECEIVED,
	REPLACED,
	REQUEST_DOCTYPE,
	REVIEWED,
	ID_DOCUMENT_KINDS,
	accepted_extensions,
	clean_id_number,
	is_what_it_claims,
	require_national_id_match,
	missing_evidence,
	required_types,
)
from gdb_bank.security.assist import officer_for, subject_for
from gdb_bank.services.evidence import PHOTO_EXTENSIONS
from gdb_bank.utils.session import _is_staff, _logger, _require_underwriter, _session_user

# Officer-observed evidence: a site visit's photographs, attached to the task
# row rather than the applicant's shelf (services/field_operations).
FIELD_TASK = "GDB Field Task"

DOCUMENT_FIELDS = [
	"name",
	"applicant",
	"applicant_name",
	"application",
	"document_type",
	"status",
	"id_document_kind",
	"id_document_number",
	"request",
	"file_url",
	"file_name",
	"file_size",
	"uploaded_on",
	"uploaded_by",
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


def _cross_check_identity(owner: str, rows: list) -> None:
	"""For staff: does each Identity document's number match the KYC register's
	record of this person? Adds `register_check` to those rows —
	match / mismatch / not_on_register / no_number — and, on a mismatch, the
	register's ID type and the last digits of its number to compare with."""
	identity = [r for r in rows if r.document_type == "Identity"]
	if not identity:
		return
	from gdb_bank.integrations import kyc_registry

	number = frappe.db.get_value("User", owner, "gdb_national_id") or frappe.db.get_value(
		"User", owner, "gdb_tin"
	)
	numbers = kyc_registry.id_numbers(number) if number else None
	for row in identity:
		typed = row.id_document_number
		if not typed:
			row.register_check = {"status": "no_number"}
		elif not numbers:
			row.register_check = {"status": "not_on_register"}
		elif typed in numbers["numbers"]:
			row.register_check = {"status": "match", "id_type": numbers["id_type"]}
		else:
			row.register_check = {
				"status": "mismatch",
				"id_type": numbers["id_type"],
				"hint": ", ".join(f"…{n[-3:]}" for n in sorted(numbers["numbers"])),
			}


def _settings(types: tuple = DOCUMENT_TYPES) -> dict:
	"""What the upload control needs, from the server that enforces it."""
	return {
		"types": list(types),
		"personal_types": list(PERSONAL_TYPES),
		"accepts": ",".join(ALLOWED_EXTENSIONS),
		# Per type, for the types that take photographs as well as PDFs.
		"accepts_by_type": {t: ",".join(accepted_extensions(t)) for t in types},
		"max_bytes": MAX_FILE_BYTES,
		# An Identity upload says which document it is and its number.
		"id_document_kinds": list(ID_DOCUMENT_KINDS),
	}


@frappe.whitelist()
def document_settings():
	"""The typed list, the accepted format and the size limit."""
	_session_user()
	return _settings()


def _own_application(application: str, user: str):
	"""The applicant's own case. Evidence is theirs to give, and only theirs.

	An officer must not upload an applicant's evidence for them: the record
	would then say the applicant produced something they never saw. Officers
	ask (request_information); applicants answer. The one exception is a Field
	Officer working WITH the applicant under their consent (`acting`, resolved
	before this is called, so `user` is still the applicant): the row records
	the officer as its uploader, and a reply to an information request still
	only leaves when the applicant sends it (confirm_document).
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
def new_document(
	document_type: str,
	application: str | None = None,
	request: str | None = None,
	acting: str | None = None,
	id_document_kind: str | None = None,
	id_document_number: str | None = None,
):
	"""Open a shelf row. The file is uploaded against it next, by the framework.

	An Identity document needs `id_document_kind` and `id_document_number` —
	which document it is and the number printed on it — so the officer can
	cross-check them (clean_id_number).

	Returns the row, whose `name` is the `docname` to pass to
	/api/method/upload_file along with doctype=GDB Applicant Document and
	is_private=1.
	"""
	user = subject_for(acting)
	officer = officer_for(acting)
	document_type = (document_type or "").strip()
	if document_type not in DOCUMENT_TYPES:
		frappe.throw(_("{0} is not a document type GDB accepts.").format(document_type))

	id_fields = {}
	if document_type == "Identity":
		kind, number = clean_id_number(id_document_kind, id_document_number)
		require_national_id_match(kind, number, frappe.db.get_value("User", user, "gdb_national_id"))
		id_fields = {"id_document_kind": kind, "id_document_number": number}

	if document_type in PERSONAL_TYPES:
		# About the person, so it follows them rather than one case — which is
		# also how a group's member files theirs from the head's application.
		application = None
	elif not application:
		frappe.throw(
			_("A {0} document belongs to an application. Say which one.").format(document_type)
		)
	else:
		_own_application(application, user)

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
			"uploaded_by": officer or user,
			**id_fields,
		}
	# The officer holds no create right on the applicant's shelf; their access
	# was settled by subject_for above, and upload_file then checks the row.
	).insert(ignore_permissions=bool(officer))
	return frappe.db.get_value(DOCTYPE, doc.name, DOCUMENT_FIELDS, as_dict=True)


def validate_attachment(doc, method=None):
	"""Gate every file arriving on a shelf row. Hooked onto File.before_insert.

	This is the enforcement point rather than confirm_document, because the
	upload runs through Frappe's own endpoint and would otherwise land on disk
	before anything of ours had an opinion about it.
	"""
	if doc.attached_to_doctype not in (DOCTYPE, FIELD_TASK):
		return

	name = (doc.file_name or "").strip()
	extension = os.path.splitext(name)[-1].lower()
	if doc.attached_to_doctype == FIELD_TASK:
		# A site visit's photographs: pictures only, and only while the task
		# is the officer's to report on.
		accepted = PHOTO_EXTENSIONS
		if frappe.db.get_value(FIELD_TASK, doc.attached_to_name, "status") != "Accepted":
			frappe.throw(_("Photos are added while the task is open."))
	else:
		document_type = frappe.db.get_value(DOCTYPE, doc.attached_to_name, "document_type")
		accepted = accepted_extensions(document_type)
	if extension not in accepted:
		if accepted == ALLOWED_EXTENSIONS:
			frappe.throw(
				_("{0} is not a PDF. GDB accepts PDF documents only.").format(name or _("This file"))
			)
		frappe.throw(
			_("{0}: upload {1}.").format(
				name or _("This file"), ", ".join(e.lstrip(".").upper() for e in accepted)
			)
		)

	content = doc.get_content() if hasattr(doc, "get_content") else None
	if isinstance(content, str):
		content = content.encode()
	if content and not is_what_it_claims(extension, content):
		frappe.throw(
			_("{0} is not a real {1} file.").format(
				name, extension.lstrip(".").upper()
			)
		)
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
def confirm_document(name: str, acting: str | None = None):
	"""Stamp the shelf row with the file that arrived, and close what it answers.

	Also retires the previous document of the same type on the same case:
	replacement during an application is expected, and the trail
	(superseded_by) is what keeps a replaced document from simply vanishing.

	A reply to an information request is the APPLICANT's to send, even when a
	Field Officer put the file there for them: an assisted call is refused it,
	and the file waits (list_requests shows it as `staged`) until the applicant
	sends it from their own account.
	"""
	user = subject_for(acting)
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.applicant != user:
		frappe.throw(_("This is not your document."), frappe.PermissionError)
	if acting and doc.request:
		frappe.throw(_("The applicant sends this reply."), frappe.PermissionError)

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
def list_documents(application: str | None = None, applicant: str | None = None, acting: str | None = None):
	"""One person's shelf: their documents on this case, plus their personal ones.

	Whose shelf is the reader's own — on a group's case a member sees theirs,
	never the head's. Staff read the applicant's, or one member's by `applicant`.
	"""
	user = subject_for(acting)
	staff = _is_staff(user)
	if applicant and applicant != user and not staff:
		frappe.throw(_("You may only read your own documents."), frappe.PermissionError)

	owner, case_owner = applicant or user, None
	if application:
		case_owner = _readable_application(application, user).gdb_owner
		if staff and not applicant:
			owner = case_owner

	rows = frappe.get_all(
		DOCTYPE, filters={"applicant": owner}, fields=DOCUMENT_FIELDS, order_by="creation asc"
	)
	shelf = [
		r
		for r in rows
		if r.application == application
		or (not r.application and r.document_type in PERSONAL_TYPES)
	]
	member = case_owner is not None and owner != case_owner
	if staff:
		_cross_check_identity(owner, shelf)
	return {
		"documents": shelf,
		"missing": missing_evidence(application, owner) if application else [],
		"can_upload": owner == user,
		"settings": _settings(PERSONAL_TYPES if member else DOCUMENT_TYPES),
	}


@frappe.whitelist()
def delete_document(name: str, acting: str | None = None):
	"""Remove a document from a draft. Blocked once the application is with the
	Bank — the doctype's own on_trash says so, and says why."""
	user = subject_for(acting)
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
	current = frappe.db.get_value(DOCTYPE, name, "status")
	if current is None:
		frappe.throw(_("Document {0} not found.").format(name))
	# A document is reviewed once. An accepted one is not then rejected, nor a
	# rejected one accepted: a rejection is answered by a new upload, which
	# arrives Received and is reviewed in its own right.
	if current in REVIEWED:
		frappe.throw(_("This document has already been {0}.").format(current.lower()))

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
def list_requests(application: str, acting: str | None = None):
	"""Everything the Bank has asked for on this case.

	Applicant-visible by design: an itemised ask is only useful if the person
	who has to answer it can read it. An open request a Field Officer has put a
	file against carries it as `staged`, for the applicant to send.
	"""
	user = subject_for(acting)
	_readable_application(application, user)
	rows = frappe.get_all(
		REQUEST_DOCTYPE,
		filters={"application": application},
		fields=REQUEST_FIELDS,
		order_by="creation asc",
	)
	for row in rows:
		row["staged"] = _staged(row.name) if row.status == OPEN else None
	return {"requests": rows, "open": len([r for r in rows if r.status == OPEN])}


def _staged(request: str):
	"""The newest unsent file a Field Officer put against this request, or None."""
	for doc in frappe.get_all(
		DOCTYPE,
		filters={"request": request, "uploaded_on": ["is", "not set"]},
		fields=["name", "applicant", "uploaded_by"],
		order_by="creation desc",
	):
		if not doc.uploaded_by or doc.uploaded_by == doc.applicant:
			continue
		file = frappe.db.get_value(
			"File", {"attached_to_doctype": DOCTYPE, "attached_to_name": doc.name}, ["file_name"], as_dict=True
		)
		if file:
			return {
				"name": doc.name,
				"file_name": file.file_name,
				"uploaded_by_name": frappe.utils.get_fullname(doc.uploaded_by),
			}
	return None
