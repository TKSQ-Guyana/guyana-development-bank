"""GDB Loan Offer — the Letter of Offer, and once accepted, the agreement.

An approval is a credit decision, not a contract. What binds GDB and the
borrower is a Letter of Offer: stated amount, term, repayment and conditions
precedent, valid until a named date, which the applicant accepts or declines.
On acceptance the wording is frozen onto the record and that frozen text is
the executed agreement — one authoritative document, as the SOW requires.

The document is submittable so acceptance is a submit, not an edit: after that
only the fields marked allow_on_submit can move, and every change is versioned.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate, nowdate


class GDBLoanOffer(Document):
	def validate(self):
		if self.offered_amount is not None and flt(self.offered_amount) <= 0:
			frappe.throw(_("Offered amount must be greater than zero."))
		if self.term_months is not None and not (1 <= int(self.term_months) <= 360):
			frappe.throw(_("Term must be between 1 and 360 months."))
		if self.valid_until and getdate(self.valid_until) < getdate(nowdate()):
			# Only on the way in — an offer that expired while outstanding is
			# handled by is_open(), not by refusing to save the record.
			if self.is_new():
				frappe.throw(_("Validity date cannot be in the past."))

		self.set_repayment_figures()

	def set_repayment_figures(self):
		"""The instalment lending will bill on these terms, from lending itself.

		get_monthly_repayment_amount is the function lending runs on a Loan
		Application and on every repayment schedule, so the figure printed on the
		offer is the one the borrower is later charged — not a division of GDB's
		that disagrees with it by the rounding. Total repayable is stated only on
		an interest-free offer, where it is the principal and nothing is
		calculated; with a rate it is whatever lending's schedule accrues, which
		exists only once the loan is disbursed.
		"""
		from lending.loan_management.doctype.loan_repayment_schedule.utils import (
			get_monthly_repayment_amount,
		)

		# Set once, before submission. Acceptance saves the submitted offer again,
		# and an offer issued before this used lending's function carries GDB's
		# old figure: recomputing it then would be a change to a submitted field,
		# which Frappe refuses — and the borrower is accepting the wording as issued.
		if self.docstatus != 0:
			return
		amount = flt(self.offered_amount)
		term = int(self.term_months or 0)
		rate = flt(self.rate_of_interest)
		if not amount or not term:
			return
		self.monthly_instalment = get_monthly_repayment_amount(amount, rate, term, "Monthly")
		self.total_repayable = amount if not rate else None

	def is_open(self) -> bool:
		"""Still capable of being accepted."""
		if self.status != "Issued":
			return False
		return getdate(self.valid_until) >= getdate(nowdate())

	def expiry_state(self) -> str:
		"""Status as it should read now, allowing for an unattended lapse."""
		if self.status == "Issued" and getdate(self.valid_until) < getdate(nowdate()):
			return "Expired"
		return self.status
