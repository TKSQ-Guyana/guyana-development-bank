"""GDB Visit Check — one line of a site visit's checklist, as the officer found it.

The items themselves are GDB's (services/field_operations.VISIT_CHECKLIST); the
row records the item's wording at the time, so a later change to the list never
rewrites what an officer was asked on an earlier visit.
"""

from frappe.model.document import Document


class GDBVisitCheck(Document):
	pass
