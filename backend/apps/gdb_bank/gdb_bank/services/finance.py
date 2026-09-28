"""Borrower-side repayments.

`make_repayment` is the borrower's own act (or a cluster member's) — staff are
refused here and go through collections.apply_receipt instead. `repayment_plan`
decides how a payment of a given size should be posted and is shared with the
bank collections file, so a payment is decided the same way however it reaches
GDB; collections.py imports it from gdb_bank.api, which re-exports it from here.

Nothing in this module computes money: the due figures, the ceilings and the
schedule are all lending's own answer.
"""

import frappe
from frappe import _
from frappe.utils import flt, fmt_money, nowdate

from gdb_bank.utils.constants import LOAN_FIELDS
from gdb_bank.utils.session import _as_system, _is_staff, _logger
from gdb_bank.services.application import loan_account


def repayment_plan(loan_name: str, amount) -> dict:
	"""How a payment of this size against this loan should be posted.

	Which of lending's twenty repayment types applies depends on what is
	currently due, and lending is the one that knows. A Normal Repayment is
	capped at the amount demanded so far (validate_normal_repayment on the
	product), so paying ahead of schedule has to go in as an Advance Payment or
	lending rejects it. Nothing here computes money — the due figures and the
	ceiling are all lending's own numbers.

	Shared by the portal payment box and the bank collections file, so a
	payment is decided the same way however it reaches GDB. Returns `error` as
	a message rather than throwing, because a bank file needs to report a bad
	row and carry on rather than abandon the batch.
	"""
	from lending.loan_management.doctype.loan_repayment.loan_repayment import calculate_amounts

	amount = flt(amount)
	amounts = calculate_amounts(loan_name, nowdate(), "Normal Repayment") or {}
	due_now = flt(amounts.get("payable_amount"))
	outstanding = (
		flt(amounts.get("pending_principal_amount"))
		+ flt(amounts.get("interest_amount"))
		+ flt(amounts.get("penalty_amount"))
	)

	error = None
	if amount <= 0:
		error = _("Enter an amount greater than zero.")
	elif amount > outstanding > 0:
		error = _("Amount exceeds the {0} outstanding on this loan.").format(fmt_money(outstanding))

	return {
		"repayment_type": "Normal Repayment" if due_now and amount <= due_now else "Advance Payment",
		"due_now": due_now,
		"outstanding": outstanding,
		"error": error,
	}


def _may_repay(application: str, user: str):
	"""The borrower side of a facility: who may pay it FROM THE PORTAL.

	Reading a case and paying it are not the same right, and _readable_application
	answers the first. Staff pass that check — they must, to review and to
	release — and for a while that meant an underwriter could post a repayment
	against a citizen's loan from the borrower's own payment box. Money the Bank
	never received would have appeared on the ledger as the borrower's payment.

	So this is a separate question with a narrower answer: the applicant, or a
	member of the cluster whose head raised the facility. Bank-side receipts have
	their own door — collections.apply_receipt, which starts from a Bank
	Transaction, i.e. from money that actually arrived.
	"""
	from gdb_bank.api import _is_shared_with

	row = frappe.db.get_value("Loan Application", application, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.gdb_owner == user or _is_shared_with(row, user):
		return row
	if _is_staff(user):
		_logger().warning(f"denied staff repayment on {application} to {user}")
		frappe.throw(
			_("GDB staff cannot record a payment on a borrower's behalf here. Apply the "
			  "receipt from Collections instead."),
			frappe.PermissionError,
		)
	frappe.throw(_("You may only pay your own loan."), frappe.PermissionError)


def make_repayment(user: str, application: str, amount):
	"""Record a repayment against the loan booked from this application.

	Any member of the cluster may pay the group's facility — the ledger records
	who made the payment, not only whose facility it is. GDB staff may not: see
	_may_repay.
	"""
	_may_repay(application, user)

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Enter an amount greater than zero."))

	loan = frappe.db.get_value(
		"Loan", {"loan_application": application}, ["name", "company", "status"], as_dict=True
	)
	if not loan:
		frappe.throw(_("No loan has been booked for {0} yet.").format(application))
	if loan.status not in ("Disbursed", "Partially Disbursed", "Active"):
		frappe.throw(_("Loan {0} is not open for repayment (status {1}).").format(loan.name, loan.status))

	plan = repayment_plan(loan.name, amount)
	if plan["error"]:
		frappe.throw(plan["error"])
	repayment_type = plan["repayment_type"]

	# Posting a repayment is a bank operation: lending's path writes Loan Demand
	# and the repayment schedule, which no citizen may touch. This endpoint has
	# already established who is allowed to pay this loan, so the ledger write
	# runs as the system and the record keeps the name of whoever asked.
	with _as_system() as caller:
		doc = frappe.get_doc(
			{
				"doctype": "Loan Repayment",
				"against_loan": loan.name,
				"company": loan.company,
				"posting_date": nowdate(),
				"repayment_type": repayment_type,
				"amount_paid": amount,
				"gdb_paid_by": caller,
			}
		)
		doc.insert()
		doc.submit()
		frappe.db.commit()

	_logger().info(f"repayment {doc.name}: {amount} ({repayment_type}) on {loan.name} by {user}")
	return loan_account(user, application)
