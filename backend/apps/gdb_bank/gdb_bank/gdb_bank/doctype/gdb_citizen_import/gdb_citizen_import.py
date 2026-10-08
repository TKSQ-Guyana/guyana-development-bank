"""One MPS call-list workbook, as the platform administrator uploaded it, and
what became of every row in it (services/citizen_import.py).

Written only by that service. Kept, never deleted: it is how GDB answers "who
opened this citizen's account, from which file, and why".
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GDBCitizenImport(Document):
	def on_trash(self):
		frappe.throw(_("An import record cannot be deleted."), frappe.PermissionError)
