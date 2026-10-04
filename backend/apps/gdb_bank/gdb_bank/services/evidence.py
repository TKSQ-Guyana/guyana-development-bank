"""Evidence rules: the typed shelf, and what the Bank expects on it.

Expected, never required — submission is not gated on any of it. The shelf
prompts from these rules and the review queue flags a thin case with them.
"""

import frappe

from gdb_bank.utils.constants import QUICK_PRODUCT
from gdb_bank.utils.formatters import _portal_product

DOCTYPE = "GDB Applicant Document"
REQUEST_DOCTYPE = "GDB Information Request"

# THIS LIST AND THE document_type OPTIONS IN gdb_applicant_document.json ARE ONE
# CONTRACT — a type here the doctype does not know is a row that fails to insert.
DOCUMENT_TYPES = (
	"Identity",
	"Proof of Address",
	"Personal Financials",
	"Financials",
	# The three financial statements an SME files, each on its own row so an
	# underwriter can see which one is missing rather than "some financials".
	"Cash Flow Projection",
	"Income Statement",
	"Balance Sheet",
	"Business Plan",
	"Bank Statement",
	"Quotation",
	# The Quick Loan's evidence. An informal trader proves they trade with a
	# phone camera — the stall, the goods, whatever receipts they happen to keep
	# — never with registration, accounts or a plan.
	"Trading Photo",
	"Receipts or Records",
	# Pictures of the business itself — the stall, the shop, the goods — taken
	# while describing it. Advisory, like every Quick Loan photo.
	"Business Photo",
	"Other",
)

# About the person, not the venture: held with no application, so they follow
# the person across cases (ask once). `Financials` is the BUSINESS's accounts and
# stays on the case; `Personal Financials` follows the person.
PERSONAL_TYPES = ("Identity", "Proof of Address", "Personal Financials")

# Which identity document a file is, and the number printed on it — asked with
# every Identity upload so the officer verifying it can check the number on the
# page against what the applicant typed, and against the KYC register.
ID_DOCUMENT_KINDS = ("National ID Card", "Passport", "Driver's Licence", "e-ID")


NATIONAL_ID_CARD = "National ID Card"


def require_national_id_match(kind: str, number: str, national_id: str | None) -> None:
	"""A National ID card's number IS the person's National ID: refuse one that
	differs from the National ID they signed up with. Nothing to check against
	for an account opened another way (e-ID)."""
	from frappe import _

	if kind != NATIONAL_ID_CARD or not national_id:
		return
	if number != national_id.upper():
		frappe.throw(
			_("The National ID card number must match your National ID number ({0}).").format(national_id)
		)


def clean_id_number(kind: str | None, number: str | None) -> tuple[str, str]:
	"""(kind, number) for an Identity document, or a clear refusal. The number
	is kept as letters and digits, uppercased: "r 012-3456" is R0123456."""
	import re

	from frappe import _

	kind = (kind or "").strip()
	if kind not in ID_DOCUMENT_KINDS:
		frappe.throw(_("Choose which identity document you are attaching."))
	compact = re.sub(r"[\s\-/.]", "", (number or "").strip().upper())
	if not compact:
		frappe.throw(_("Enter the number printed on your {0}.").format(kind))
	if not re.fullmatch(r"[A-Z0-9]{5,20}", compact):
		frappe.throw(_("Enter the {0} number as printed on it — letters and digits only.").format(kind))
	return kind, compact

# What every individual on a group's case is asked for — the head and each member.
PERSONAL_EVIDENCE = ("Identity", "Personal Financials")

# PDF, and small enough for a phone connection in Region 9. Enforced on
# Frappe's own upload path (documents.validate_attachment).
ALLOWED_EXTENSIONS = (".pdf",)
MAX_FILE_BYTES = 10 * 1024 * 1024

# Photographs, for the two types a trader produces with a phone. A photo of the
# stall is a photo; receipts may be photographed or scanned.
# Every format a phone camera saves in: JPEG and PNG, WebP (Android), and
# HEIC/HEIF (iPhone).
PHOTO_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")
ACCEPTED_BY_TYPE = {
	# An identity document may be a PDF scan or a photo of the card or page
	# (GDB, 2026-10-03) — most people sign up from a phone.
	"Identity": ALLOWED_EXTENSIONS + PHOTO_EXTENSIONS,
	"Trading Photo": PHOTO_EXTENSIONS,
	"Business Photo": PHOTO_EXTENSIONS,
	"Receipts or Records": PHOTO_EXTENSIONS + ALLOWED_EXTENSIONS,
}

# What each format's file begins with. A name is what the uploader typed; these
# bytes are what the file is. Frappe itself parses a PDF (for JavaScript) and a
# JPEG (for EXIF) on the way in, but nothing looks inside a PNG — so the
# signature is checked here for every format, and a renamed file is refused
# with a reason rather than stored.
SIGNATURES = {
	".pdf": b"%PDF-",
	".jpg": b"\xff\xd8\xff",
	".jpeg": b"\xff\xd8\xff",
	".png": b"\x89PNG\r\n\x1a\n",
}


HEIF_BRANDS = (b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1")


def accepted_extensions(document_type: str | None) -> tuple:
	"""The file formats GDB accepts for this type of evidence."""
	return ACCEPTED_BY_TYPE.get(document_type or "", ALLOWED_EXTENSIONS)


def is_what_it_claims(extension: str, content: bytes) -> bool:
	"""Whether the file's own first bytes match the format its name claims.

	A PDF may carry a little junk before its header (the format allows it within
	the first KB), so only a PDF is searched rather than matched at the start.
	"""
	if extension == ".webp":
		return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
	if extension in (".heic", ".heif"):
		# An ISO media file: a "ftyp" box naming a HEIF brand.
		return content[4:8] == b"ftyp" and content[8:12] in HEIF_BRANDS
	signature = SIGNATURES.get(extension)
	if not signature:
		return False
	if extension == ".pdf":
		return signature in content[:1024]
	return content.startswith(signature)

OPEN = "Open"
RECEIVED = "Received"
REPLACED = "Replaced"
REVIEWED = ("Accepted", "Rejected")


def required_types(business_stage: str | None, cluster: bool = False, quick: bool = False) -> tuple:
	"""What the Bank expects from the applicant of an application.

	Identity always — plus, on a group's case, the head's own personal
	financials. Beyond that an existing business owes its three statements (a
	12-month cash-flow projection, its income and expenditure, its balance
	sheet) and a start-up its business plan and cash-flow projection. A Quick Loan owes a photograph of the trade and
	nothing else: receipts are welcome and never expected.
	"""
	if quick:
		return ("Identity", "Business Photo")
	base = PERSONAL_EVIDENCE if cluster else ("Identity",)
	stage = (business_stage or "").strip().title()
	if stage == "Existing":
		return base + ("Cash Flow Projection", "Income Statement", "Balance Sheet")
	if stage == "New":
		return base + ("Business Plan", "Cash Flow Projection")
	return base


def _expected(row) -> tuple:
	"""required_types for one Loan Application row (needs stage, cluster, product)."""
	return required_types(
		row.gdb_business_stage,
		bool(row.gdb_cluster),
		quick=_portal_product(row.get("loan_product")) == QUICK_PRODUCT,
	)


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
		"Loan Application",
		application,
		["gdb_owner", "gdb_business_stage", "gdb_cluster", "loan_product"],
		as_dict=True,
	)
	if not row:
		return []
	person = person or row.gdb_owner
	if person == row.gdb_owner:
		expected = _expected(row)
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
		expected = _expected(row)
		missing[row.name] = [t for t in expected if t not in held]
	return missing
