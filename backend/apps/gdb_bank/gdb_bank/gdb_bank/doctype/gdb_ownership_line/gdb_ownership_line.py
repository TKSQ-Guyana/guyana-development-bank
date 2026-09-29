"""GDB Ownership Line — one co-owner of the business an application is for.

A child table on Loan Application (Custom Field gdb_ownership_lines). It serves
a PARTNERSHIP (each partner and their share) and an INCORPORATED company (each
shareholder and theirs) with one shape, because an underwriter reading either
is asking the same question: who owns this, and how much of it.

Held as rows rather than in the gdb_co_applicants text, so a share is a real
Percent column that can be totalled and checked instead of a string nobody can
query. The applicant's own share is gdb_applicant_share on the application.
"""

from frappe.model.document import Document


class GDBOwnershipLine(Document):
	pass
