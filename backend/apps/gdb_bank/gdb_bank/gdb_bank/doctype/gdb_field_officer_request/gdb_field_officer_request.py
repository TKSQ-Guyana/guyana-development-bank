"""A citizen asking a GDB field officer to call and complete a Quick Loan with them.

Not a Loan Lead: lending's lead needs a product and an amount, and the whole
point of asking for help is that the applicant has not worked those out yet.
This records only who to call, where, and when — the officer does the rest.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBFieldOfficerRequest(Document):
	def validate(self):
		for field, label in (("applicant_name", _("your name")), ("phone", _("a phone number"))):
			if not (self.get(field) or "").strip():
				frappe.throw(_("Enter {0}.").format(label))
