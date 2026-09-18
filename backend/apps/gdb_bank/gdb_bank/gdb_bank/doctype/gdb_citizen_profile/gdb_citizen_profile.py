"""Who the applicant is, in two blocks that are never merged.

The upper block is what the e-ID directory asserted at sign-in. The lower block
is what the applicant typed. They are kept apart on purpose: a phone number the
directory holds and a phone number the applicant gave are different kinds of
fact, and an underwriter deciding a loan is entitled to see which is which. A
single "phone" field that silently prefers one source would answer a question
nobody asked and hide the one that matters.
"""

import frappe
from frappe.model.document import Document


class GDBCitizenProfile(Document):
	def validate(self):
		self.full_name = frappe.utils.get_fullname(self.user)
		if not self.eid:
			self.eid = frappe.db.get_value("User", self.user, "gdb_eid")
		self.updated_on = frappe.utils.now_datetime()
