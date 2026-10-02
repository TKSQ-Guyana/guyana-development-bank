"""Whitelisted endpoints for field operations — the Field Officer's desk, the
applicant's answer to an officer asking for access, and the Loan Officer's ask
for field work. The rules live in services/field_operations.

Endpoints: POST /api/method/gdb_bank.field_officer.<name>

Who may call what is settled here, once per endpoint; which record they may
touch is settled per record in the service (region, assignment, consent).
"""

import frappe
from frappe.rate_limiter import rate_limit

from gdb_bank.services import field_operations as service
from gdb_bank.utils.session import (
	_require_field_officer,
	_require_staff,
	_require_underwriter,
	_session_user,
)

# -- the desk -------------------------------------------------------------------


@frappe.whitelist()
def desk(tab: str = "assist", status: str | None = None, start=0, page_length=25):
	"""One tab of the officer's queue, the counts on all three, by status."""
	return service.desk(_require_field_officer(), tab, status, start, page_length)


# -- assist requests ------------------------------------------------------------


@frappe.whitelist()
def assist_request(name: str):
	return service.assist_request(_require_field_officer(), name)


@frappe.whitelist(methods=["POST"])
def accept_assist_request(name: str):
	return service.accept_request(_require_field_officer(), name)


@frappe.whitelist(methods=["POST"])
def log_contact_attempt(name: str, result: str, note: str | None = None):
	return service.log_attempt(_require_field_officer(), name, result, note)


@frappe.whitelist(methods=["POST"])
def set_assist_outcome(name: str, outcome: str, note: str | None = None):
	return service.set_outcome(_require_field_officer(), name, outcome, note)


# -- consent and the assisted application ---------------------------------------


@frappe.whitelist()
@rate_limit(limit=20, seconds=60 * 5)
def find_applicant(eid: str):
	"""A partial name for an e-ID — rate-limited, or it would be a directory."""
	return service.find_applicant(_require_field_officer(), eid)


@frappe.whitelist(methods=["POST"])
def request_assist_consent(eid: str | None = None, request: str | None = None):
	return service.request_consent(_require_field_officer(), eid=eid, request=request)


@frappe.whitelist()
def assist_consent(name: str):
	return service.consent_view(_require_field_officer(), name)


@frappe.whitelist(methods=["POST"])
def hand_off_application(consent: str, name: str):
	"""Give the draft back to the applicant to check and submit themselves."""
	return service.hand_off(_require_field_officer(), consent, name)


@frappe.whitelist(methods=["POST"])
def submit_assisted_application(consent: str, name: str, accept_terms=None, credit_check_consent=None):
	"""Submit the applicant's draft to GDB for them. They are told it was.
	A Quick Loan also needs the applicant's `accept_terms` and
	`credit_check_consent`, given in front of the officer."""
	return service.submit_for(
		_require_field_officer(), consent, name, accept_terms=accept_terms, credit_check_consent=credit_check_consent
	)


@frappe.whitelist()
def my_assist_consents():
	"""The citizen's side: what officers have asked, and what they have allowed."""
	return service.my_consents(_session_user())


@frappe.whitelist(methods=["POST"])
def respond_to_assist_consent(name: str, accept=1):
	return service.respond(_session_user(), name, accept)


@frappe.whitelist(methods=["POST"])
def end_assist_consent(name: str):
	"""Withdrawn by the applicant, or closed by the officer."""
	return service.end_consent(_session_user(), name)


# -- field tasks ----------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def request_field_task(
	application: str,
	kind: str,
	instructions: str,
	due_date: str | None = None,
	address: str | None = None,
	region: str | None = None,
):
	"""The Loan Officer asks for a site visit or a reference check."""
	return service.request_task(
		_require_underwriter(), application, kind, instructions, due_date=due_date, address=address, region=region
	)


@frappe.whitelist(methods=["POST"])
def cancel_field_task(name: str, reason: str):
	return service.cancel_task(_require_underwriter(), name, reason)


@frappe.whitelist()
def field_tasks_for(application: str):
	"""The field work on one case, for GDB staff reading it."""
	return service.tasks_for(_require_staff(), application)


@frappe.whitelist()
def field_task(name: str):
	return service.field_task(_require_field_officer(), name)


@frappe.whitelist(methods=["POST"])
def accept_field_task(name: str):
	return service.accept_task(_require_field_officer(), name)


@frappe.whitelist(methods=["POST"])
def save_field_report(name: str, report=None):
	return service.save_report(_require_field_officer(), name, report)


@frappe.whitelist(methods=["POST"])
def submit_field_report(name: str, report=None):
	return service.save_report(_require_field_officer(), name, report, submit=1)


@frappe.whitelist(methods=["POST"])
def remove_field_photo(name: str, file: str):
	return service.remove_photo(_require_field_officer(), name, file)


# -- the case, read-only --------------------------------------------------------


@frappe.whitelist()
def case_view(application: str):
	"""The case with its history, for an officer with an assignment on it."""
	return service.case_view(_session_user(), application)
