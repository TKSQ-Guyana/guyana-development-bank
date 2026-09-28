"""Evidence rules: the typed shelf, and what the Bank expects on it.

Expected, never required — submission is not gated on any of it. The shelf
prompts from these rules and the review queue flags a thin case with them.
"""

import frappe

DOCTYPE = "GDB Applicant Document"
REQUEST_DOCTYPE = "GDB Information Request"

# THIS LIST AND THE document_type OPTIONS IN gdb_applicant_document.json ARE ONE
# CONTRACT — a type here the doctype does not know is a row that fails to insert.
DOCUMENT_TYPES = (
	"Identity",
	"Proof of Address",
	"Personal Financials",
	"Financials",
	"Business Plan",
	"Bank Statement",
	"Quotation",
	"Other",
)

# About the person, not the venture: held with no application, so they follow
# the person across cases (ask once). `Financials` is the BUSINESS's accounts and
# stays on the case; `Personal Financials` follows the person.
PERSONAL_TYPES = ("Identity", "Proof of Address", "Personal Financials")

# What every individual on a group's case is asked for — the head and each member.
PERSONAL_EVIDENCE = ("Identity", "Personal Financials")

# PDF only, and small enough for a phone connection in Region 9. Enforced on
# Frappe's own upload path (documents.validate_attachment).
ALLOWED_EXTENSIONS = (".pdf",)
MAX_FILE_BYTES = 10 * 1024 * 1024

OPEN = "Open"
RECEIVED = "Received"
REPLACED = "Replaced"
REVIEWED = ("Accepted", "Rejected")


def required_types(business_stage: str | None, cluster: bool = False) -> tuple:
	"""What the Bank expects from the applicant of an application.

	Identity always — plus, on a group's case, the head's own personal
	financials. Beyond that an existing business owes its financials and a
	start-up its business plan.
	"""
	base = PERSONAL_EVIDENCE if cluster else ("Identity",)
	stage = (business_stage or "").strip().title()
	if stage == "Existing":
		return base + ("Financials",)
	if stage == "New":
		return base + ("Business Plan",)
	return base


def _counts_for(doc, application: str | None) -> bool:
	"""A document counts on a case if it was filed on it, or is personal."""
	return doc.application == application or (not doc.application and doc.document_type in PERSONAL_TYPES)


def _held_types(application: str | None, applicant: str) -> set:
	"""Document types this applicant has on file for this case."""
	rows = frappe.get_all(
		DOCTYPE,
		filters={"applicant": applicant, "status": ["!=", REPLACED], "file_url": ["is", "set"]},
		fields=["document_type", "application"],
	)
	return {r.document_type for r in rows if _counts_for(r, application)}


def missing_evidence(application: str, person: str | None = None) -> list:
	"""Expected types not yet on `person`'s shelf (default: the applicant).

	A member on a group's case owes only their personal evidence; the business
	evidence is the head's.
	"""
	row = frappe.db.get_value(
		"Loan Application", application, ["gdb_owner", "gdb_business_stage", "gdb_cluster"], as_dict=True
	)
	if not row:
		return []
	person = person or row.gdb_owner
	if person == row.gdb_owner:
		expected = required_types(row.gdb_business_stage, bool(row.gdb_cluster))
	else:
		expected = PERSONAL_EVIDENCE
	held = _held_types(application, person)
	return [t for t in expected if t not in held]


def missing_by_application(rows) -> dict:
	"""missing_evidence for a whole list of cases, in one document query."""
	if not rows:
		return {}
	docs = frappe.get_all(
		DOCTYPE,
		filters={
			"applicant": ["in", list({r.gdb_owner for r in rows})],
			"status": ["!=", REPLACED],
			"file_url": ["is", "set"],
		},
		fields=["applicant", "application", "document_type"],
	)
	by_owner: dict = {}
	for doc in docs:
		by_owner.setdefault(doc.applicant, []).append(doc)

	missing = {}
	for row in rows:
		held = {d.document_type for d in by_owner.get(row.gdb_owner, []) if _counts_for(d, row.name)}
		expected = required_types(row.gdb_business_stage, bool(row.gdb_cluster))
		missing[row.name] = [t for t in expected if t not in held]
	return missing
