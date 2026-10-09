"""Completing a submitted application: what was left out, and only that.

Submission does not wait for everything (services/application.submit_application
— documents are expected, never blocking, and many answers are optional). So
an application can reach the Bank with gaps. While it is still in review — with
GDB, not yet decided — its applicant may come back and fill them:

  application_gaps(user, name)      the blank answers and the document checklist
  complete_application(user, name, sections)
                                    writes ONLY answers that are still blank

WHAT WAS SUBMITTED STAYS AS SUBMITTED. An answer already given is the record
the Bank is reviewing; it is never overwritten here, and a call that tries is
refused, not quietly trimmed. Documents follow the same rule in
documents.new_document: once the case is with the Bank, a type already on file
is not replaced, except in answer to GDB's own information request.

The record is submitted (docstatus 1), so the new answers are written with
db_set — the same way review_loan writes a submitted case — and each write is
recorded as a Version on the Loan Application: who, which fields, old and new
values, when.
"""

import re

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from gdb_bank.install import APPLICATION_SECTIONS
from gdb_bank.services import evidence
from gdb_bank.utils.constants import (
	EXISTING_ONLY,
	NEW_ONLY,
	QUICK_ONLY,
	QUICK_PRODUCT,
	SME_ONLY,
	SHARED_SECTIONS,
)
from gdb_bank.utils.eid import EID_SHAPE, normalize_eid
from gdb_bank.utils.formatters import _normalised_phone, _portal_product
from gdb_bank.utils.session import _logger

NUMERIC = ("Currency", "Int", "Percent", "Float")

# Never offered: a tick box unticked is an answer, not a gap; the table and the
# map pin are not single fields; the moratorium is required at submission and
# 0 is a real choice; the review flag is the server's, never the applicant's.
NOT_OFFERED = {
	"gdb_requires_loan_officer_review",
	"gdb_use_of_funds",
	"gdb_trade_latitude",
	"gdb_trade_longitude",
	"gdb_moratorium_months",
	# The underwriter's to classify (Credit risk tab), never the applicant's.
	"gdb_sector",
	"gdb_sub_sector",
	# Retired 2026-10-05: no longer asked on either form.
	"gdb_public_service_employed",
	"gdb_public_service_ministry",
	"gdb_public_service_under_250k",
	"gdb_related_to_gdb_employee",
	# Never asked by the apply form, so never a gap the applicant left: offering
	# them here would be asking new questions after submission, not completing
	# old ones. Ask them on the form first if GDB wants them.
	"gdb_challenges",
	"gdb_customer_need",
	"gdb_pricing_approach",
	"gdb_key_people",
	"gdb_relevant_experience",
	"gdb_skills_gaps",
	"gdb_total_debt",
}

# The answer asked outside sections B-H. (Monthly income is not: neither form
# asks it, so a blank one is not a gap the applicant left.)
TOP_LEVEL = (("phone", "applicant_phone_number", "Phone Number", "Data", None),)

# The documents the Bank reviews a case on, beside the case's own expected
# types (evidence.required_types). Each is (key, label, document_type, kind).
CHECKLIST = (
	("national_id", "National ID document", "Identity", "National ID Card"),
	("e_id", "e-ID document", "Identity", "e-ID"),
	("bank_statement", "Bank account document (bank statement)", "Bank Statement", None),
	("payslip", "Payslip", "Payslip", None),
)

_QUALIFIER = re.compile(r"\s*\((?:Declared|Quick Loan|New Business)[^)]*\)")


def _label(raw: str) -> str:
	"""The section's label as the applicant reads it: no internal qualifiers."""
	return _QUALIFIER.sub("", raw).strip()


def _editable_case(user: str, name: str):
	"""The caller's own single application, with GDB and not yet decided."""
	doc = frappe.get_doc("Loan Application", name)
	if doc.gdb_owner != user:
		frappe.throw(_("You may only complete your own application."), frappe.PermissionError)
	if doc.gdb_cluster:
		frappe.throw(_("A group's application is managed by its GDB facilitator."), frappe.PermissionError)
	if cint(doc.docstatus) == 0:
		frappe.throw(_("{0} has not been submitted yet. Finish it from the draft.").format(name))
	if cint(doc.docstatus) != 1 or doc.status != "Open" or doc.gdb_reviewed_on:
		frappe.throw(_("{0} has been decided by GDB and can no longer be changed.").format(name))
	return doc


def _applies(fieldname: str, doc) -> bool:
	"""Whether this question belongs on this application at all."""
	quick = _portal_product(doc.loan_product) == QUICK_PRODUCT
	if fieldname in QUICK_ONLY and not quick:
		return False
	if fieldname in SME_ONLY and quick:
		return False
	stage = (doc.gdb_business_stage or "").title()
	if fieldname in NEW_ONLY and stage != "New":
		return False
	if fieldname in EXISTING_ONLY and stage != "Existing":
		return False
	structure = doc.gdb_legal_structure or ""
	follows = {
		"gdb_legal_structure_other": structure == "Other",
		"gdb_co_applicants": structure == "Partnership",
		"gdb_applicant_share": structure in ("Partnership", "Incorporated (Inc.)"),
		# Asked of a new business too (2026-10-07), as its registration is.
		"gdb_date_established": stage in ("Existing", "New"),
		# A new business is no longer asked for its registration (2026-10-04).
		"gdb_registration_date": False,
		# The mentor is no longer asked (2026-10-05).
		"gdb_has_mentor": False,
		"gdb_mentor_details": False,
		"gdb_mentor_first_name": False,
		"gdb_mentor_last_name": False,
		"gdb_mentor_phone": False,
		# The industrial program's follow-ups belong to its Yes.
		"gdb_institution": doc.gdb_industrial_training == "Yes",
		"gdb_course_name": doc.gdb_industrial_training == "Yes",
		"gdb_course_completion_date": doc.gdb_industrial_training == "Yes",
		"gdb_applicant_eid": doc.gdb_has_eid != "No",
		"gdb_employer_category": doc.gdb_employed == "Yes",
		"gdb_employer_name": doc.gdb_employed == "Yes",
		"gdb_income_band": doc.gdb_employed == "Yes",
	}
	return follows.get(fieldname, True)


def _blank(value, fieldtype: str) -> bool:
	if fieldtype in NUMERIC:
		return not flt(value)
	return value in (None, "") or (isinstance(value, str) and not value.strip())


def _questions():
	"""Every single-value question: (key, fieldname, label, fieldtype, options)."""
	for row in APPLICATION_SECTIONS:
		fieldname, label, fieldtype = row[0], row[1], row[2]
		if fieldtype == "Check" or fieldname in NOT_OFFERED:
			continue
		if fieldname not in SME_ONLY + QUICK_ONLY + SHARED_SECTIONS:
			continue
		options = row[3] if len(row) > 3 else None
		yield fieldname[4:], fieldname, _label(label), fieldtype, options
	yield from TOP_LEVEL


def eid_on_card(applicant: str) -> str | None:
	"""The e-ID number on the applicant's uploaded e-ID card (not rejected, not
	replaced), in its canonical form — or None."""
	number = frappe.db.get_value(
		evidence.DOCTYPE,
		{
			"applicant": applicant,
			"document_type": "Identity",
			"id_document_kind": evidence.EID_REQUEST,
			"file_url": ["is", "set"],
			"status": ["not in", ["Rejected", evidence.REPLACED]],
		},
		"id_document_number",
		order_by="creation desc",
	)
	eid = normalize_eid(number)
	return eid if EID_SHAPE.match(eid) else None


def fill_eid_from_card(applicant: str) -> list[str]:
	"""Write the uploaded e-ID card's number into "Applicant e-ID" where it is
	still blank, on the applicant's applications not yet decided. The card is
	the answer: asking for the same number again is what this prevents."""
	eid = eid_on_card(applicant)
	if not eid:
		return []
	names = frappe.get_all(
		"Loan Application",
		filters={"gdb_owner": applicant, "docstatus": ["<", 2], "status": "Open"},
		fields=["name", "gdb_applicant_eid", "gdb_reviewed_on"],
	)
	filled = []
	for row in names:
		if row.gdb_reviewed_on or (row.gdb_applicant_eid or "").strip():
			continue
		frappe.db.set_value("Loan Application", row.name, "gdb_applicant_eid", eid, update_modified=False)
		filled.append(row.name)
	return filled


def _gaps(doc) -> list[dict]:
	"""The questions this application asks that were left blank."""
	gaps = []
	card_eid = eid_on_card(doc.gdb_owner)
	for key, fieldname, label, fieldtype, options in _questions():
		if not _applies(fieldname, doc) or not _blank(doc.get(fieldname), fieldtype):
			continue
		# Answered by the e-ID card on file.
		if fieldname == "gdb_applicant_eid" and card_eid:
			continue
		gaps.append(
			{
				"key": key,
				"fieldname": fieldname,
				"label": label,
				"fieldtype": fieldtype,
				"options": [o for o in (options or "").split("\n") if o] or None,
			}
		)
	return gaps


def _checklist(doc) -> list[dict]:
	"""The documents this case is reviewed on, each on file or not."""
	rows = frappe.get_all(
		evidence.DOCTYPE,
		filters={"applicant": doc.gdb_owner, "status": ["!=", evidence.REPLACED], "file_url": ["is", "set"]},
		fields=["document_type", "application", "id_document_kind"],
	)
	held = [r for r in rows if evidence._counts_for(r, doc.name)]

	def on_file(document_type, kind):
		return any(r.document_type == document_type and (not kind or r.id_document_kind == kind) for r in held)

	items = [
		{
			"key": t,
			"label": t,
			"document_type": t,
			"id_document_kind": None,
			"required": True,
			"on_file": on_file(t, None),
		}
		for t in evidence._expected(doc)
	]
	for key, label, document_type, kind in CHECKLIST:
		if any(i["document_type"] == document_type and not kind for i in items):
			continue
		items.append(
			{
				"key": key,
				"label": label,
				"document_type": document_type,
				"id_document_kind": kind,
				"required": False,
				"on_file": on_file(document_type, kind),
			}
		)
	return items


def application_gaps(user: str, name: str) -> dict:
	doc = _editable_case(user, name)
	return {"name": name, "fields": _gaps(doc), "documents": _checklist(doc)}


def information_gaps(name: str) -> dict:
	"""The soft flag staff see: the answers a submitted application left blank.

	The same gaps the applicant is offered (_gaps), read for the Bank. It never
	gates a decision or a payment — it tells the underwriter what to ask for
	(request_information). Documents are the Evidence card's (missing_evidence),
	not repeated here. A draft is not before the Bank, so it has no gaps yet.
	"""
	doc = frappe.get_doc("Loan Application", name)
	if cint(doc.docstatus) != 1:
		return {"name": name, "fields": []}
	return {"name": name, "fields": [{"key": g["key"], "label": g["label"]} for g in _gaps(doc)]}


def gap_counts(names: list[str]) -> dict:
	"""{application: number of answers left blank} — one review-queue page."""
	return {n: len(information_gaps(n)["fields"]) for n in names}


def _coerced(gap: dict, raw):
	"""The answer in its field's type, or a clear refusal. None when left empty."""
	fieldtype, label = gap["fieldtype"], gap["label"]
	if raw is None or (isinstance(raw, str) and not raw.strip()):
		return None
	if gap["key"] == "phone":
		phone = _normalised_phone(raw)
		if not phone:
			frappe.throw(_("Enter a valid phone number."))
		return phone
	if gap["fieldname"] == "gdb_applicant_eid":
		eid = normalize_eid(raw)
		if not EID_SHAPE.match(eid):
			frappe.throw(_("Enter your E-ID as its 11 digits, e.g. 592-2001-0101."))
		return eid
	if fieldtype in NUMERIC:
		value = cint(raw) if fieldtype == "Int" else flt(raw)
		if value < 0:
			frappe.throw(_("{0} cannot be negative.").format(label))
		if fieldtype == "Percent" and value > 100:
			frappe.throw(_("{0} cannot be more than 100%.").format(label))
		return value or None
	value = str(raw).strip()
	if gap["options"] and value not in gap["options"]:
		frappe.throw(_("Choose one of the options for {0}.").format(label))
	return value


def complete_application(user: str, name: str, sections=None) -> list[str]:
	"""Fill blank answers on a submitted application. Answers the fields written.

	`sections` is {key: value} with the keys application_gaps gave. A key for an
	answer already given is refused; a key left empty is skipped.
	"""
	doc = _editable_case(user, name)
	if isinstance(sections, str):
		sections = frappe.parse_json(sections) if sections.strip() else {}
	if not isinstance(sections, dict):
		sections = {}

	gaps = {g["key"]: g for g in _gaps(doc)}
	known = {q[0]: q for q in _questions()}
	changes = {}
	for key, raw in sections.items():
		gap = gaps.get(key)
		if not gap:
			if key in known:
				frappe.throw(
					_("{0} was given when you applied and cannot be changed.").format(_label(known[key][2]))
				)
			frappe.throw(_("{0} is not a question on this application.").format(key))
		value = _coerced(gap, raw)
		if value is not None:
			changes[gap["fieldname"]] = value

	if not changes:
		frappe.throw(_("Fill in at least one missing answer."))

	before = {f: doc.get(f) for f in changes}
	# db_set: the case is submitted, and these are its applicant's own answers
	# to questions left blank — the same write review_loan makes on a submitted
	# case. The Version below is the audit trail a doc.save() would have left.
	doc.db_set(dict(changes))  # a copy: db_set adds `modified` to what it is given
	frappe.get_doc(
		{
			"doctype": "Version",
			"ref_doctype": "Loan Application",
			"docname": name,
			"data": frappe.as_json(
				{
					"changed": [[f, before[f], v] for f, v in changes.items()],
					"comment": "Missing answers completed by the applicant after submission",
				}
			),
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(
		f"application {name}: {len(changes)} missing answer(s) completed by {user} at {now_datetime()}: "
		+ ", ".join(changes)
	)
	return list(changes)


def is_with_bank(application: str | None) -> bool:
	"""Submitted to GDB (docstatus 1): what was filed then stays as filed."""
	return bool(application) and cint(frappe.db.get_value("Loan Application", application, "docstatus")) == 1


def refuse_if_on_file(applicant: str, application: str, document_type: str, kind: str | None) -> None:
	"""Once a case is with the Bank, a document already on file is not replaced
	by its applicant — GDB asks for a new one if it needs it."""
	rows = frappe.get_all(
		evidence.DOCTYPE,
		filters={
			"applicant": applicant,
			"document_type": document_type,
			"status": ["!=", evidence.REPLACED],
			"file_url": ["is", "set"],
		},
		fields=["application", "document_type", "id_document_kind"],
	)
	for row in rows:
		if evidence._counts_for(row, application) and (document_type != "Identity" or row.id_document_kind == kind):
			label = kind or document_type
			frappe.throw(
				_(
					"Your {0} was submitted with this application and cannot be replaced. "
					"If GDB needs a new one, it will ask you on this page."
				).format(label)
			)
