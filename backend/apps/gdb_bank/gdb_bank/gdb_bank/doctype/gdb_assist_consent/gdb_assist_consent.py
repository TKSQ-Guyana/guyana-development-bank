"""GDB Assist Consent — an applicant letting one Field Officer work on their file.

Asked by the officer (field_officer.request_assist_consent), answered by the
applicant on their OWN signed-in portal (respond_to_assist_consent) — never by
the officer on the applicant's behalf, so the record proves the applicant's
act rather than the officer's word for it. While it is Granted, and not past
field_operations.CONSENT_DAYS, the officer may read and fill that applicant's
draft (security/assist.subject_for). Handing the draft back ends it.

Only the four lifecycle moves in services/field_operations write it; nothing
reopens an Ended or Declined consent — the officer asks again.
"""

from frappe.model.document import Document


class GDBAssistConsent(Document):
	pass
