"""Collections — applying bank receipts to loans.

Money arriving from Demerara or Citizens is a **Bank Transaction**. ERPNext
already models everything around that properly, and none of it is rebuilt here:

  * `Bank Statement Import` reads CSV or MT940 and maps each bank's own column
    layout, so there is no parser in this module.
  * `Bank Transaction.unallocated_amount` holds money recognised but not yet
    applied — the suspense position, already native.
  * `Bank Transaction Payments` allocates one receipt across several vouchers,
    partially, and `allocate_payment_entries()` does the arithmetic.
  * lending's own matcher reconciles receipts against Loan Repayments that
    already exist (a portal payment the statement later confirms).

The one case nothing covers is a receipt with **no voucher behind it** — a
standing order or a counter deposit that GDB learns about only from the
statement. ERPNext has `create_payment_entry_bts` / `create_journal_entry_bts`
for that shape, but no loan equivalent. That gap is what this module fills:

    unreconciled_receipts  what arrived and is still unapplied
    suggest_loans          ranked candidates for one receipt
    apply_receipt          create the Loan Repayment, then allocate it

Posting goes through `api.repayment_plan`, the same helper the portal payment
box uses, so a payment is decided identically however it reaches GDB.

Endpoints: POST /api/method/gdb_bank.collections.<name>
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate

from gdb_bank.api import _as_system, _logger, _require_finance, repayment_plan

OPEN_LOAN_STATUSES = ("Disbursed", "Partially Disbursed", "Active")

RECEIPT_FIELDS = [
	"name",
	"date",
	"deposit",
	"withdrawal",
	"allocated_amount",
	"unallocated_amount",
	"description",
	"reference_number",
	"party_type",
	"party",
	"bank_account",
	"status",
]


@frappe.whitelist()
def unreconciled_receipts(bank_account: str | None = None, limit: int = 50):
	"""Money in, not yet applied to a loan.

	Reads stock Bank Transactions. Anything here came from a statement import,
	so the cash is already recognised — what is missing is which loan it
	belongs to.
	"""
	_require_finance()
	filters = {
		"docstatus": 1,
		"deposit": [">", 0],
		"unallocated_amount": [">", 0],
	}
	if bank_account:
		filters["bank_account"] = bank_account

	rows = frappe.get_all(
		"Bank Transaction",
		filters=filters,
		fields=RECEIPT_FIELDS,
		order_by="date asc",
		limit=limit,
	)
	return {
		"receipts": rows,
		"total_unapplied": sum(flt(r.unallocated_amount) for r in rows),
	}


@frappe.whitelist()
def suggest_loans(bank_transaction: str, limit: int = 8):
	"""Ranked loan candidates for one receipt.

	Ranking mirrors ERPNext's own matchers so the reasoning is familiar:
	+1 the statement reference names the loan or its application, +1 the amount
	equals an instalment, +1 the amount clears the balance outright, +1 the
	party matches. Never applied automatically — a receipt put against the
	wrong loan is far worse than one that waits for a human.
	"""
	_require_finance()
	bt = frappe.db.get_value(
		"Bank Transaction", bank_transaction, RECEIPT_FIELDS, as_dict=True
	)
	if not bt:
		frappe.throw(_("Bank Transaction {0} not found.").format(bank_transaction))

	amount = flt(bt.unallocated_amount)
	reference = (bt.reference_number or "").strip().upper()
	haystack = f"{reference} {(bt.description or '')}".upper()

	loans = frappe.get_all(
		"Loan",
		filters={"docstatus": 1, "status": ["in", OPEN_LOAN_STATUSES]},
		fields=[
			"name",
			"loan_application",
			"applicant",
			"applicant_name",
			"loan_amount",
			"total_principal_paid",
			"monthly_repayment_amount",
		],
		limit_page_length=0,
	)

	scored = []
	for loan in loans:
		outstanding = flt(loan.loan_amount) - flt(loan.total_principal_paid)
		if outstanding <= 0:
			continue

		rank, why = 1, []
		# The bank quoted something that names this loan, or the application it
		# came from. Strongest signal there is.
		if loan.name.upper() in haystack or (
			loan.loan_application and loan.loan_application.upper() in haystack
		):
			rank += 2
			why.append("reference names this loan")
		if abs(flt(loan.monthly_repayment_amount) - amount) < 1:
			rank += 1
			why.append("amount matches the instalment")
		if abs(outstanding - amount) < 1:
			rank += 1
			why.append("amount clears the balance")
		if bt.party and loan.applicant == bt.party:
			rank += 1
			why.append("payer matches the borrower")
		elif loan.applicant_name and loan.applicant_name.upper() in haystack:
			rank += 1
			why.append("borrower named on the statement")
		# No name-guessing beyond this. The payer's account number is the
		# deterministic answer and ERPNext already resolves it: on import,
		# `auto_set_party` matches `bank_party_account_number` / IBAN against
		# the Bank Account records GDB holds for every borrower, and sets
		# `party`. That is the branch above. Matching on a surname when an
		# account number is available would be guessing where GDB can be
		# certain — and it is the account number the bank actually keys on.

		if rank > 1:
			scored.append(
				{
					"loan": loan.name,
					"application": loan.loan_application,
					"borrower": loan.applicant_name,
					"outstanding": outstanding,
					"instalment": flt(loan.monthly_repayment_amount),
					"rank": rank,
					"why": why,
				}
			)

	scored.sort(key=lambda x: -x["rank"])
	return {
		"receipt": bt,
		"candidates": scored[:limit],
	}


@frappe.whitelist()
def apply_receipt(bank_transaction: str, loan: str, amount=None):
	"""Apply a bank receipt to a loan.

	Creates the Loan Repayment the statement implies, then hands it to the
	stock Bank Transaction so ERPNext does the allocation and clearance. The
	receipt is the source of truth for the money; this only decides which loan
	it belongs to.
	"""
	staff = _require_finance()

	bt = frappe.get_doc("Bank Transaction", bank_transaction)
	if flt(bt.unallocated_amount) <= 0:
		frappe.throw(_("Receipt {0} is already fully applied.").format(bank_transaction))

	amount = flt(amount) or flt(bt.unallocated_amount)
	if amount > flt(bt.unallocated_amount):
		frappe.throw(
			_("Cannot apply more than the {0} still unapplied on this receipt.").format(
				flt(bt.unallocated_amount)
			)
		)

	loan_row = frappe.db.get_value(
		"Loan", loan, ["name", "company", "status"], as_dict=True
	)
	if not loan_row:
		frappe.throw(_("Loan {0} not found.").format(loan))
	if loan_row.status not in OPEN_LOAN_STATUSES:
		frappe.throw(_("Loan {0} is {1} and not open for repayment.").format(loan, loan_row.status))

	plan = repayment_plan(loan, amount)
	if plan["error"]:
		frappe.throw(plan["error"])

	with _as_system():
		repayment = frappe.get_doc(
			{
				"doctype": "Loan Repayment",
				"against_loan": loan,
				"company": loan_row.company,
				# The bank's value date, not today's: arrears and any penalty
				# must run off when the borrower actually paid, not off when
				# GDB got round to importing the statement.
				"posting_date": getdate(bt.date),
				"repayment_type": plan["repayment_type"],
				"amount_paid": amount,
				"gdb_paid_by": staff,
			}
		)
		repayment.insert()
		repayment.submit()

		# Hand the voucher to ERPNext; save() allocates and sets clearance.
		bt.reload()
		bt.add_payment_entries(
			[{"payment_doctype": "Loan Repayment", "payment_name": repayment.name}],
			is_new_voucher=True,
		)
		bt.save()
		frappe.db.commit()

	_logger().info(
		f"receipt {bank_transaction} applied to {loan} as {repayment.name} "
		f"({plan['repayment_type']}, {amount}) by {staff}"
	)
	bt.reload()
	return {
		"repayment": repayment.name,
		"repayment_type": plan["repayment_type"],
		"applied": amount,
		"receipt_status": bt.status,
		"still_unapplied": flt(bt.unallocated_amount),
	}
