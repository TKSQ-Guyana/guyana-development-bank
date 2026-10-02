"""The GDB Inc loan agreement, as a Word document filled from an offer.

THE TEMPLATE is templates/agreements/gdb_loan_agreement.docx: GDB's own draft
("Draft loan Agreement GDB INC.docx", kept as supplied in docs/templates/) with
each blank replaced by a {{token}} that sits whole inside one text run. Filling
it is therefore a string replacement inside word/document.xml — no Word library
and no office suite on the server — and every value is XML-escaped first, so a
name like "O'Neil & Sons" can never break the document.

GENERATED ON REQUEST, from the offer as issued plus what has happened since:
before the loan is booked the agreement says its account number and first
repayment date are to be advised; once lending holds the Loan, the same
download names them. The binding wording a borrower accepts in the portal is
still offers._agreement_text, frozen at issue — this is the printable, signable
form of the same terms.
"""

import io
import os
import zipfile
from xml.sax.saxutils import escape

import frappe
from frappe.utils import cint, flt, fmt_money, formatdate, getdate, in_words

TEMPLATE = os.path.join(os.path.dirname(__file__), "templates", "agreements", "gdb_loan_agreement.docx")

TOKENS = (
	"borrower_name",
	"borrower_address",
	"bank_account",
	"amount",
	"amount_words",
	"purpose",
	"term_months",
	"moratorium_clause",
	"instalment",
	"first_repayment",
	"repayment_day",
	"loan_account",
	"borrower_signature_name",
)

TO_BE_ADVISED = "to be advised at disbursement"


def _money(value) -> str:
	# G$, never a bare $: on a Guyanese loan a bare dollar sign reads as USD.
	return "G$" + fmt_money(flt(value), currency="GYD").replace("$", "").strip()


def _ordinal(n: int) -> str:
	suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
	return f"{n}{suffix}"


def _address(user: str, application) -> str:
	"""Where the borrower lives, as their profile states it — what they declared
	first, then what the e-ID directory holds — and failing both, where the
	business is, which is the "address/region" the agreement asks for."""
	profile = frappe.db.get_value(
		"GDB Citizen Profile",
		{"user": user},
		["address", "village_or_town", "region", "verified_address"],
		as_dict=True,
	)
	parts = [profile.address, profile.village_or_town, profile.region] if profile else []
	declared = ", ".join(p.strip() for p in parts if p and p.strip())
	return (
		declared
		or ((profile.verified_address or "").strip() if profile else "")
		or (application.gdb_trade_address or "").strip()
		or (application.gdb_trade_region or "").strip()
		or "address not on file"
	)


def _payout_account(user: str) -> str:
	customer = frappe.db.get_value("Customer", {"gdb_user": user})
	row = (
		frappe.db.get_value(
			"Bank Account",
			{"party_type": "Customer", "party": customer},
			["bank", "bank_account_no"],
			as_dict=True,
		)
		if customer
		else None
	)
	if not row or not row.bank_account_no:
		return TO_BE_ADVISED
	return f"{row.bank_account_no} ({row.bank})"


def _moratorium_clause(months) -> str:
	"""The sentence the repayment clause opens with when a moratorium applies."""
	months = cint(months)
	if not months:
		return ""
	return (
		f"A moratorium of {months} month{'s' if months != 1 else ''} applies: no instalment is due for "
		f"the first {months} month{'s' if months != 1 else ''} after the loan is disbursed. "
	)


def values_for(offer) -> dict:
	"""Every token's value for this offer."""
	application = frappe.db.get_value(
		"Loan Application",
		offer.application,
		["gdb_purpose", "gdb_owner", "gdb_trade_address", "gdb_trade_region"],
		as_dict=True,
	)
	loan = frappe.db.get_value(
		"Loan", {"loan_application": offer.application, "docstatus": 1}, ["name", "repayment_start_date"], as_dict=True
	)
	amount = flt(offer.offered_amount)
	first = getdate(loan.repayment_start_date) if loan and loan.repayment_start_date else None
	name = (offer.applicant_name or "").strip()
	return {
		"borrower_name": name,
		"borrower_address": _address(offer.applicant or application.gdb_owner, application),
		"bank_account": _payout_account(offer.applicant or application.gdb_owner),
		"amount": _money(amount),
		"amount_words": f"{in_words(int(round(amount))).lower()} Guyana dollars",
		"purpose": (application.gdb_purpose or "").strip() or "—",
		"term_months": str(cint(offer.term_months)),
		"moratorium_clause": _moratorium_clause(offer.get("moratorium_months")),
		"instalment": _money(offer.monthly_instalment),
		"first_repayment": formatdate(first)
		if first
		else (
			f"the {_ordinal(cint(offer.get('moratorium_months')) + 1)} month after disbursement"
			if cint(offer.get("moratorium_months"))
			else "the date stated in your repayment schedule"
		),
		"repayment_day": f"{_ordinal(first.day)} day" if first else "same day",
		"loan_account": loan.name if loan else TO_BE_ADVISED,
		"borrower_signature_name": name.upper(),
	}


def render(values: dict) -> bytes:
	"""The template with every token replaced, as .docx bytes."""
	missing = [t for t in TOKENS if t not in values]
	if missing:
		frappe.throw(f"Loan agreement is missing: {', '.join(missing)}")

	source = zipfile.ZipFile(TEMPLATE)
	out = io.BytesIO()
	with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
		for item in source.infolist():
			data = source.read(item.filename)
			if item.filename == "word/document.xml":
				xml = data.decode("utf-8")
				for token in TOKENS:
					xml = xml.replace("{{" + token + "}}", escape(str(values[token])))
				data = xml.encode("utf-8")
			target.writestr(item, data)
	return out.getvalue()
