"""GDB Contact Attempt — one phone call a Field Officer made.

A child table, used twice: the call log on a GDB Field Officer Request (did the
officer reach the applicant who asked for help?) and the calls of a reference
check on a GDB Field Task (what did each referee say?). `verdict` is only ever
set on the second.
"""

from frappe.model.document import Document


class GDBContactAttempt(Document):
	pass
