"""One access decision, recorded once and never again touched.

Who changed which account or setting, from what, to what, when and why. Rows
are written only by services/access_audit.py, in the same transaction as the
change they describe, so a change cannot be committed without its record.

Append-only by construction: no role holds write, create or delete in the
doctype, and the controller refuses an edit or a delete even from the
Administrator, whom Frappe's permission checks never stop.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBAccessChange(Document):
	def validate(self):
		if not self.is_new():
			frappe.throw(_("An access change record cannot be edited."), frappe.PermissionError)
		if not (self.reason or "").strip():
			frappe.throw(_("Say why this change was made."))

	def on_trash(self):
		frappe.throw(_("An access change record cannot be deleted."), frappe.PermissionError)
