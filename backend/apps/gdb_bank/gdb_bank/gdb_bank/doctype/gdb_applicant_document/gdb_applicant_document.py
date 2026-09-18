"""One piece of evidence an applicant gave GDB.

The row exists BEFORE the file does, and that order is deliberate: Frappe's
`File.has_permission` delegates a private file's access to the document it is
attached to, so the shelf row is what makes an applicant's PDF readable by the
applicant and by an underwriter, and by nobody else. Upload therefore goes
through the framework's own `/api/method/upload_file` against this row, not
through an endpoint of ours that would have to re-invent the permission check.

`application` may be blank: a personal document (identity, proof of address)
belongs to the person, not to one case, and follows them across applications.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBApplicantDocument(Document):
	def validate(self):
		# The applicant is never a field the client gets to choose. It is set
		# from the session when the row is created and frozen thereafter.
		if not self.applicant:
			self.applicant = frappe.session.user
		if not self.applicant_name:
			self.applicant_name = frappe.utils.get_fullname(self.applicant)

	def on_trash(self):
		"""Evidence on a submitted application is the Bank's record, not the
		applicant's draft. It may be replaced — which keeps both rows and the
		trail between them — but never quietly removed."""
		if not self.application:
			return
		if frappe.db.get_value("Loan Application", self.application, "docstatus") == 1:
			frappe.throw(
				_("This document belongs to a submitted application and cannot be deleted. "
				  "Upload a replacement instead.")
			)
