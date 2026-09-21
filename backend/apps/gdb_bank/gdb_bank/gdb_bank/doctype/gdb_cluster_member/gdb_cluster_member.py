"""Controller for GDB Cluster Member.

Business behaviour lives in `gdb_bank/services/`, not here: CLAUDE.md keeps
domain logic out of Frappe controllers so it can be tested and reused. This
class carries only invariants that must hold no matter which code path writes
the document.
"""

from frappe.model.document import Document


class GDBClusterMember(Document):
	pass
