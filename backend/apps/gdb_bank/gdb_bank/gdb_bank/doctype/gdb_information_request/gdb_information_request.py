"""Something the Bank has asked the applicant for, itemised.

An underwriter who needs another document raises one of these rather than
sending a message: the ask becomes an open item the applicant can see, answer
by uploading against it, and watch close. A request nobody can enumerate is a
case that stalls with neither side able to say what it is waiting for.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBInformationRequest(Document):
	def validate(self):
		if not (self.item or "").strip():
			frappe.throw(_("Say what is being asked for."))
		if not self.applicant:
			self.applicant = frappe.db.get_value("Loan Application", self.application, "gdb_owner")
		# Attribution follows the outcome: an open request has been answered by
		# nothing, and must not carry a document or a response date.
		if self.status == "Open":
			self.satisfied_by = None
			self.responded_on = None
