"""GDB Sector — the sectors an underwriter classifies a case under (Credit risk).

Seeded once (install.SECTORS) with GDB's five priority sectors; after that the
list is the desk's to correct, so a re-seed adds what is missing and never
overwrites an edit.
"""

from frappe.model.document import Document


class GDBSector(Document):
	pass
