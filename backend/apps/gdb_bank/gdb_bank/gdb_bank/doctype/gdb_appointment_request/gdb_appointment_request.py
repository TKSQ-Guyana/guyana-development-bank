"""Someone who cannot finish sign-up online asking GDB to book them in.

Asked from the sign-up page by a person with no account yet — so no User to
hang it on: just who they are and how to reach them. Two reasons send them
here: they have no National ID yet, or the phone on record for their National
ID is not theirs any more. GDB staff (loan officers, field officers) call them
back and record what happened.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBAppointmentRequest(Document):
	def validate(self):
		for field, label in (
			("first_name", _("your first name")),
			("last_name", _("your last name")),
			("phone", _("a phone number")),
		):
			if not (self.get(field) or "").strip():
				frappe.throw(_("Enter {0}.").format(label))
