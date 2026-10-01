"""Whose records this call works on — the caller's own, or an applicant's
under that applicant's consent.

The applicant's own endpoints (the application form, its documents, the payout
account, the profile) all ask "who is the applicant?" and have always answered
with the session user. A Field Officer filling an application WITH the
applicant passes `acting=<GDB Assist Consent>`, and this one function turns
that into the applicant — only while the applicant's own yes holds
(services/field_operations.applicant_for). Every assisted call goes through
here, so there is one place the rule lives and one log line per use.

What the officer may or may not do beyond reading and filling is decided where
it is done: submitting goes through its own endpoint and is recorded as the
officer's act (field_operations.submit_for — api.submit_application never
takes `acting`); an information-request reply is the applicant's to send
(documents.confirm_document); and an answer the applicant already declared is
never overwritten (profiles.save_profile).
"""

from gdb_bank.utils.session import _logger, _require_field_officer, _session_user


def subject_for(acting: str | None = None) -> str:
	"""The applicant this call is about."""
	if not acting:
		return _session_user()
	from gdb_bank.services.field_operations import applicant_for

	officer = _require_field_officer()
	applicant = applicant_for(officer, acting)
	_logger().info(f"field officer {officer} acting for {applicant} under {acting}")
	return applicant


def officer_for(acting: str | None = None) -> str | None:
	"""The officer behind an assisted call, for attribution; None otherwise."""
	return _session_user() if acting else None
