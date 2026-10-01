"""GDB Field Task — a site visit or reference check a Loan Officer asks for.

Raised by the underwriter on a submitted case, picked up from the regional pool
by a Field Officer, and closed by the officer's report. The report is
officer-OBSERVED evidence and is kept apart from the applicant's own documents:
its photographs are attached to this row (through Frappe's upload_file), so
File.has_permission hands their access to this row's rules — the assigned
officer and GDB's underwriters, never the applicant
(permissions.field_task_has_permission).

Every write goes through services/field_operations; the desk form is read-only.
"""

from frappe.model.document import Document


class GDBFieldTask(Document):
	pass
