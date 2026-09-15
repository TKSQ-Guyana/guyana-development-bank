"""A single condition precedent on an accepted offer.

Raised from the offer's own wording when the applicant accepts, then worked
through one item at a time by staff. `api.disburse_loan` refuses to release
while any required one is still Outstanding — which is what makes the wording
in the Letter of Offer a control rather than a sentence.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBLoanCondition(Document):
	def validate(self):
		if not (self.description or "").strip():
			frappe.throw(_("A condition needs wording."))
		# Attribution and status travel together: a settled condition must say
		# who settled it, and an open one must carry nobody's name.
		if self.status == "Outstanding":
			self.verified_by = None
			self.verified_on = None
