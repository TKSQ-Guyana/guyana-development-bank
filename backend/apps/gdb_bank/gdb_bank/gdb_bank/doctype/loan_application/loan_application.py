import frappe
from frappe import _
from frappe.model.document import Document


class LoanApplication(Document):
	def validate(self):
		if not self.loan_amount or self.loan_amount <= 0:
			frappe.throw(_("Loan amount must be greater than zero."))
		if not self.term_months or not (1 <= self.term_months <= 360):
			frappe.throw(_("Term must be between 1 and 360 months."))
		if not (self.purpose or "").strip():
			frappe.throw(_("Purpose is required."))
