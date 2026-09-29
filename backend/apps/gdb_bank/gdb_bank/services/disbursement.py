"""The terms lending books a loan on, and the check that a booked loan carries them.

Booking and release themselves are api.book_loan and api.disburse_loan: lending's
create_loan, and the Loan Disbursement doctype whose submit generates the
schedule, behind the role and four-eyes gates. What lives here is what those
two share — the offer's amount and term as the inputs lending is given, and the
refusal to release on a Loan that was booked on anything else. Nothing here
computes money: every figure is lending's own.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money


def create_loan_on_offer(application: str, agreement):
	"""Book the Loan on the terms the applicant accepted, and submit it.

	lending's create_loan maps the Loan Application onto a Loan, and the
	application carries what was REQUESTED. The credit decision is the Letter of
	Offer, so its amount and term are the two inputs lending is given — and from
	there every figure is lending's own: the drawable ceiling
	(get_disbursal_amount), the schedule a disbursement generates, and the
	instalment, which is lending's get_monthly_repayment_amount — the same
	function lending's Loan Application runs on the requested amount.

	The caller has settled who may book and holds the system elevation.
	"""
	from lending.loan_management.doctype.loan_application.loan_application import create_loan
	from lending.loan_management.doctype.loan_repayment_schedule.utils import (
		get_monthly_repayment_amount,
	)

	loan = create_loan(application)  # lending's mapper, unsaved
	loan.loan_amount = flt(agreement.offered_amount)
	loan.repayment_periods = cint(agreement.term_months)
	# The rate lending itself fetches onto the Loan (fetch_from loan_product).
	rate = flt(frappe.db.get_value("Loan Product", loan.loan_product, "rate_of_interest"))
	loan.monthly_repayment_amount = get_monthly_repayment_amount(
		loan.loan_amount, rate, loan.repayment_periods, loan.repayment_frequency or "Monthly"
	)
	loan.submit()
	return loan


def offer_mismatch(loan, agreement) -> str | None:
	"""Why this Loan does not carry the executed offer's terms, or None.

	A Loan booked before book_loan took the offer's terms carries the REQUESTED
	amount, so lending's own drawable ceiling on it is too high. Releasing on it
	would pay out more than the borrower agreed to; it has to be rebooked.
	"""
	if not agreement:
		return None
	if flt(loan.loan_amount) == flt(agreement.offered_amount) and cint(
		loan.repayment_periods
	) == cint(agreement.term_months):
		return None

	# Frappe renders GYD as a bare "$" — read as USD on a Guyanese loan. Same
	# treatment as the Letter of Offer's own wording (offers._agreement_text).
	def money(value) -> str:
		return "G$" + fmt_money(flt(value), currency="GYD").replace("$", "").strip()

	return _(
		"Loan {0} is booked at {1} over {2} months, but the executed Letter of Offer {3} "
		"is {4} over {5} months. It must be rebooked on the offer's terms before any "
		"funds are released."
	).format(
		loan.name,
		money(loan.loan_amount),
		cint(loan.repayment_periods),
		agreement.name,
		money(agreement.offered_amount),
		cint(agreement.term_months),
	)
