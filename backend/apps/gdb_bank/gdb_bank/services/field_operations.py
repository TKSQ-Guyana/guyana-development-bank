"""Field operations: what a GDB Field Officer does, and the limits on it.

Four things, all bounded by the officer's REGION (User.gdb_region, set by the
platform administrator) or by an ASSIGNMENT on the record itself:

  * assist requests — a citizen asks for help (GDB Field Officer Request); an
    officer in that region takes it from the pool, logs each call, and records
    how it ended
  * assisted applications — the officer finds the applicant by e-ID (a partial
    name comes back, nothing else), asks for access, and the applicant allows
    it on their OWN signed-in portal (GDB Assist Consent). While it holds, the
    officer may read and fill that applicant's draft (security/assist.py), then
    either submit it for them (submit_for — recorded as the officer's act and
    told to the applicant) or hand it back for the applicant to submit
  * field tasks — a Loan Officer asks for a site visit or a reference check on
    a case under review (GDB Field Task); an officer in the region takes it and
    files a report that becomes officer-observed evidence on the case
  * documents on behalf — against an open information request the officer may
    stage a file into the applicant's case, but only the applicant sends it
    (documents.confirm_document refuses the officer)

A field officer is in no authority set: nothing here decides credit, and every
gate below refuses an officer working on their own application
(security/conflict.is_same_person).
"""

from collections import Counter

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate

from gdb_bank.gdb_bank.doctype.gdb_citizen_profile.gdb_citizen_profile import canonical_region
from gdb_bank.security.conflict import is_same_person
from gdb_bank.services.notification import notify
from gdb_bank.utils.constants import LOAN_FIELDS
from gdb_bank.utils.eid import EID_SHAPE, normalize_eid
from gdb_bank.utils.formatters import _portal_dict
from gdb_bank.utils.session import _eids, _is_staff, _logger

REQUEST = "GDB Field Officer Request"
CONSENT = "GDB Assist Consent"
TASK = "GDB Field Task"

# How long one "yes" lasts. An applicant who allowed access for one sitting has
# not allowed it for a month; the officer asks again.
CONSENT_DAYS = 7

# Assist request lifecycle. Waiting is the regional pool; Accepted and Visit
# booked are the officer's work in hand; the rest are how it ended.
WAITING = "Waiting"
WORKING = ("Accepted", "Visit booked")
OUTCOMES = ("Helped remotely", "Visit booked", "Application started", "Couldn't reach", "Closed")

CALL_RESULTS = ("Reached", "No answer", "Wrong number", "Call back")
VERDICTS = ("Positive", "Neutral", "Negative")

SITE_VISIT = "Site Visit"
REFERENCE_CHECK = "Reference Check"
TASK_KINDS = (SITE_VISIT, REFERENCE_CHECK)
LIVE_TASK = ("Open", "Accepted")
# What every site visit answers. The row keeps the wording it was asked with
# (GDB Visit Check), so changing this list never rewrites an earlier report.
VISIT_CHECKLIST = (
	"Business operating at this address",
	"Applicant met in person",
	"Stock or equipment seen",
	"Premises match the application",
	"Neighbours or customers confirm trading",
)
CHECK_RESULTS = ("Yes", "No", "N/A")
REFERENCES_NEEDED = 2

# ponytail: the desk reads at most this many rows per list and pages in Python,
# so counts by status come from one fetch. Page in SQL if a region's pool ever
# outgrows it.
DESK_SCAN = 500

REQUEST_FIELDS = [
	"name",
	"applicant",
	"applicant_name",
	"phone",
	"business_type",
	"product",
	"region",
	"best_time",
	"status",
	"requested_on",
	"assigned_to",
	"accepted_on",
	"outcome_note",
	"closed_on",
]
CONSENT_FIELDS = [
	"name",
	"officer",
	"officer_name",
	"applicant",
	"applicant_eid",
	"status",
	"request",
	"application",
	"requested_on",
	"responded_on",
	"ended_on",
	"end_reason",
]
TASK_FIELDS = [
	"name",
	"application",
	"applicant",
	"applicant_name",
	"kind",
	"status",
	"region",
	"due_date",
	"instructions",
	"address",
	"requested_by",
	"requested_on",
	"assigned_to",
	"accepted_on",
	"latitude",
	"longitude",
	"location_accuracy",
	"visited_on",
	"findings",
	"submitted_on",
	"cancelled_on",
	"cancel_reason",
]


# -- shared ---------------------------------------------------------------------


def region_of(user: str) -> str | None:
	"""The region an officer works, as the profile list spells it."""
	return canonical_region(frappe.db.get_value("User", user, "gdb_region"))


def _same_region(officer: str, region: str | None) -> bool:
	mine = region_of(officer)
	return bool(mine) and canonical_region(region) == mine


def masked_name(full_name: str | None) -> str | None:
	""""Jane D." — enough for an officer to confirm they have the right person
	with the person in front of them, and nothing more to anyone else."""
	parts = (full_name or "").split()
	if not parts:
		return None
	if len(parts) == 1:
		return parts[0]
	return f"{parts[0]} {parts[-1][0]}."


def _fullname(user: str | None) -> str | None:
	return frappe.utils.get_fullname(user) if user else None


def _note(value) -> str:
	return (value or "").strip()


# -- assist requests ------------------------------------------------------------


def _request(name: str, *, lock: bool = False):
	row = frappe.db.get_value(REQUEST, name, REQUEST_FIELDS, as_dict=True, for_update=lock)
	if not row:
		frappe.throw(_("Request {0} not found.").format(name), frappe.DoesNotExistError)
	return row


def _in_pool(officer: str, row) -> bool:
	return row.status == WAITING and _same_region(officer, row.region)


def assist_request(officer: str, name: str) -> dict:
	"""One request, for the officer it is assigned to or one in its region's pool.
	The phone number is shown only once the officer has taken it."""
	row = _request(name)
	mine = row.assigned_to == officer
	if not (mine or _in_pool(officer, row)):
		frappe.throw(_("This request is not in your region."), frappe.PermissionError)
	out = dict(row)
	out.pop("applicant", None)
	out["mine"] = mine
	out["assigned_to_name"] = _fullname(row.assigned_to)
	if not mine:
		out["phone"] = None
	out["attempts"] = frappe.get_all(
		"GDB Contact Attempt",
		filters={"parent": name, "parenttype": REQUEST},
		fields=["attempted_on", "result", "note"],
		order_by="idx desc",
	)
	out["consent"] = frappe.db.get_value(
		CONSENT, {"request": name, "officer": officer}, ["name", "status"], as_dict=True, order_by="creation desc"
	)
	return out


def accept_request(officer: str, name: str) -> dict:
	"""Take a waiting request from the regional pool. Two officers racing for the
	same one: the row is locked, and the second is told it has gone."""
	row = _request(name, lock=True)
	if row.assigned_to == officer:
		return assist_request(officer, name)
	if row.status != WAITING:
		frappe.throw(_("Another officer has already taken this request."))
	if not _same_region(officer, row.region):
		frappe.throw(_("This request is not in your region."), frappe.PermissionError)
	if is_same_person(officer, row.applicant):
		frappe.throw(_("You cannot take your own request."), frappe.PermissionError)

	doc = frappe.get_doc(REQUEST, name)
	doc.update({"status": "Accepted", "assigned_to": officer, "accepted_on": now_datetime()})
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"assist request {name} accepted by {officer}")
	return assist_request(officer, name)


def _my_working_request(officer: str, name: str):
	doc = frappe.get_doc(REQUEST, name)
	if doc.assigned_to != officer:
		frappe.throw(_("This request is not assigned to you."), frappe.PermissionError)
	if doc.status not in WORKING:
		frappe.throw(_("This request is already {0}.").format(doc.status.lower()))
	return doc


def log_attempt(officer: str, name: str, result: str, note=None) -> dict:
	"""One call to the applicant, as it went."""
	result = _note(result)
	if result not in CALL_RESULTS:
		frappe.throw(_("Choose how the call went."))
	doc = _my_working_request(officer, name)
	doc.append(
		"attempts",
		{
			"attempted_on": now_datetime(),
			"contact_name": doc.applicant_name,
			"phone": doc.phone,
			"result": result,
			"note": _note(note),
		},
	)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"assist request {name}: call logged by {officer} ({result})")
	return assist_request(officer, name)


def set_outcome(officer: str, name: str, outcome: str, note=None) -> dict:
	"""How the request ended. "Visit booked" keeps it open; the rest close it."""
	outcome = _note(outcome)
	if outcome not in OUTCOMES:
		frappe.throw(_("Choose an outcome."))
	note = _note(note)
	doc = _my_working_request(officer, name)
	if outcome == "Couldn't reach" and not doc.attempts:
		frappe.throw(_("Log the call attempts first."))
	if outcome == "Closed" and not note:
		frappe.throw(_("Say why it is closed."))
	doc.status = outcome
	doc.outcome_note = note
	doc.closed_on = None if outcome in WORKING else now_datetime()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"assist request {name}: {outcome} by {officer}")
	return assist_request(officer, name)


# -- consent and the assisted application ---------------------------------------


def find_applicant(officer: str, eid: str) -> dict:
	"""A partial name for an e-ID, and nothing else. No record is read until the
	applicant has said yes."""
	eid = normalize_eid(eid)
	if not EID_SHAPE.match(eid):
		frappe.throw(_("Enter the e-ID as 3, then 4, then 4 digits."))
	row = frappe.db.get_value(
		"User", {"gdb_eid": eid, "user_type": "Website User"}, ["name", "enabled"], as_dict=True
	)
	_logger().info(f"field officer {officer} looked up an e-ID: {'found' if row else 'none'}")
	if not row or not cint(row.enabled):
		return {"eid": eid, "registered": False, "masked_name": None, "is_you": False}
	return {
		"eid": eid,
		"registered": True,
		"masked_name": masked_name(_fullname(row.name)),
		"is_you": is_same_person(officer, row.name),
	}


def _granted_until(row):
	return add_days(get_datetime(row.responded_on), CONSENT_DAYS) if row.responded_on else None


def _is_live(row) -> bool:
	until = _granted_until(row)
	return row.status == "Granted" and until is not None and until > now_datetime()


def _end(doc, reason: str) -> None:
	doc.update({"status": "Ended", "ended_on": now_datetime(), "end_reason": reason})
	doc.save(ignore_permissions=True)


def _expire_if_stale(name: str):
	row = frappe.db.get_value(CONSENT, name, CONSENT_FIELDS, as_dict=True)
	if row and row.status == "Granted" and not _is_live(row):
		_end(frappe.get_doc(CONSENT, name), "Expired")
		frappe.db.commit()
		row = frappe.db.get_value(CONSENT, name, CONSENT_FIELDS, as_dict=True)
	return row


def request_consent(officer: str, eid: str | None = None, request: str | None = None) -> dict:
	"""Ask an applicant to let this officer work on their file. The applicant is
	told in their portal inbox and answers there, signed in as themselves."""
	if request:
		row = _request(request)
		if row.assigned_to != officer:
			frappe.throw(_("This request is not assigned to you."), frappe.PermissionError)
		applicant = row.applicant
	else:
		eid = normalize_eid(eid)
		if not EID_SHAPE.match(eid or ""):
			frappe.throw(_("Enter the e-ID as 3, then 4, then 4 digits."))
		applicant = frappe.db.get_value(
			"User", {"gdb_eid": eid, "user_type": "Website User", "enabled": 1}
		)
	if not applicant:
		frappe.throw(_("No portal account holds this e-ID yet."))
	if is_same_person(officer, applicant):
		frappe.throw(_("You cannot assist yourself."), frappe.PermissionError)

	existing = frappe.db.get_value(
		CONSENT, {"officer": officer, "applicant": applicant, "status": ["in", ["Pending", "Granted"]]}
	)
	if existing and _expire_if_stale(existing).status != "Ended":
		return consent_view(officer, existing)

	doc = frappe.get_doc(
		{
			"doctype": CONSENT,
			"officer": officer,
			"officer_name": _fullname(officer),
			"applicant": applicant,
			"applicant_eid": frappe.db.get_value("User", applicant, "gdb_eid"),
			"status": "Pending",
			"request": request,
			"requested_on": now_datetime(),
		}
	).insert(ignore_permissions=True)
	notify(applicant, _("A GDB Field Officer asks to help with your application"), "/", from_user=officer)
	frappe.db.commit()
	_logger().info(f"assist consent {doc.name} asked by {officer}")
	return consent_view(officer, doc.name)


def applicant_for(officer: str, consent: str) -> str:
	"""Whose records `officer` may work on under `consent` — or a refusal.
	The one question security/assist.subject_for asks on every assisted call."""
	row = frappe.db.get_value(CONSENT, consent, CONSENT_FIELDS, as_dict=True)
	if not row or row.officer != officer:
		frappe.throw(_("Access {0} not found.").format(consent), frappe.PermissionError)
	if row.status != "Granted":
		frappe.throw(_("The applicant has not allowed access."), frappe.PermissionError)
	if not _is_live(row):
		frappe.throw(_("Access has expired. Ask the applicant again."), frappe.PermissionError)
	if is_same_person(officer, row.applicant):
		frappe.throw(_("You cannot assist yourself."), frappe.PermissionError)
	return row.applicant


def consent_view(officer: str, name: str) -> dict:
	"""The officer's view of one consent: who, and — only while it holds — the
	applicant's drafts and the open information requests on their cases."""
	row = _expire_if_stale(name)
	if not row or row.officer != officer:
		frappe.throw(_("Access {0} not found.").format(name), frappe.PermissionError)
	full = _fullname(row.applicant)
	live = _is_live(row)
	out = {
		"name": row.name,
		"status": row.status,
		"applicant_eid": row.applicant_eid,
		"masked_name": masked_name(full),
		"applicant_name": full if live else None,
		"request": row.request,
		"application": row.application,
		"requested_on": row.requested_on,
		"responded_on": row.responded_on,
		"expires_on": _granted_until(row) if live else None,
		"ended_on": row.ended_on,
		"end_reason": row.end_reason,
		"drafts": [],
		"open_requests": [],
	}
	if live:
		out["drafts"] = [
			{
				"name": d.name,
				"loan_amount": d.loan_amount,
				"purpose": d.gdb_purpose,
				"modified": d.modified,
				"handed_off_on": d.gdb_handed_off_on,
			}
			for d in frappe.get_all(
				"Loan Application",
				filters={"gdb_owner": row.applicant, "docstatus": 0, "gdb_cluster": ["is", "not set"]},
				fields=["name", "loan_amount", "gdb_purpose", "modified", "gdb_handed_off_on"],
				order_by="modified desc",
			)
		]
		out["open_requests"] = frappe.get_all(
			"GDB Information Request",
			filters={"applicant": row.applicant, "status": "Open"},
			fields=["name", "application", "item", "document_type", "requested_on"],
			order_by="requested_on asc",
		)
	return out


def my_consents(user: str) -> list[dict]:
	"""What a citizen has been asked, or has allowed, that is still open."""
	rows = frappe.get_all(
		CONSENT,
		filters={"applicant": user, "status": ["in", ["Pending", "Granted"]]},
		fields=CONSENT_FIELDS,
		order_by="requested_on desc",
	)
	return [
		{
			"name": r.name,
			"officer_name": r.officer_name,
			"status": r.status,
			"requested_on": r.requested_on,
			"expires_on": _granted_until(r) if r.status == "Granted" else None,
		}
		for r in rows
		if r.status == "Pending" or _is_live(r)
	]


def respond(user: str, name: str, accept) -> list[dict]:
	"""The applicant's own yes or no. Only the applicant, only while it is asked."""
	doc = frappe.get_doc(CONSENT, name) if frappe.db.exists(CONSENT, name) else None
	if not doc or doc.applicant != user:
		frappe.throw(_("Request {0} not found.").format(name), frappe.PermissionError)
	if doc.status != "Pending":
		frappe.throw(_("This request is already {0}.").format(doc.status.lower()))
	granted = bool(cint(accept))
	doc.update({"status": "Granted" if granted else "Declined", "responded_on": now_datetime()})
	doc.save(ignore_permissions=True)
	notify(
		doc.officer,
		_("{0} {1} access").format(masked_name(_fullname(user)), _("allowed") if granted else _("declined")),
		f"/field/assist/{name}",
		from_user=user,
	)
	frappe.db.commit()
	_logger().info(f"assist consent {name} {'granted' if granted else 'declined'} by the applicant")
	return my_consents(user)


def end_consent(user: str, name: str) -> dict:
	"""Withdrawn by the applicant, or closed by the officer. Never reopened."""
	doc = frappe.get_doc(CONSENT, name) if frappe.db.exists(CONSENT, name) else None
	if not doc or user not in (doc.applicant, doc.officer):
		frappe.throw(_("Access {0} not found.").format(name), frappe.PermissionError)
	if doc.status not in ("Pending", "Granted"):
		frappe.throw(_("This access has already ended."))
	_end(doc, _("Withdrawn by the applicant") if user == doc.applicant else _("Closed by the officer"))
	frappe.db.commit()
	_logger().info(f"assist consent {name} ended by {'applicant' if user == doc.applicant else 'officer'}")
	return {"name": name, "status": "Ended"}


def hand_off(officer: str, consent: str, application: str) -> dict:
	"""Give the draft back. The officer's access ends here, and the applicant is
	told it is ready for them to check and submit with their own e-ID."""
	applicant = applicant_for(officer, consent)
	row = frappe.db.get_value(
		"Loan Application", application, ["gdb_owner", "gdb_cluster", "docstatus"], as_dict=True
	)
	if not row or row.gdb_owner != applicant:
		frappe.throw(_("Loan Application {0} not found.").format(application), frappe.PermissionError)
	if row.gdb_cluster:
		frappe.throw(_("A group's application is managed by its GDB facilitator."), frappe.PermissionError)
	if cint(row.docstatus) != 0:
		frappe.throw(_("{0} has already been submitted to GDB.").format(application))

	doc = frappe.get_doc("Loan Application", application)
	doc.gdb_assisted_by = officer
	doc.gdb_handed_off_on = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()
	grant = frappe.get_doc(CONSENT, consent)
	grant.application = application
	_end(grant, _("Handed to the applicant"))
	notify(applicant, _("Your application is ready for you to check and submit"), f"/apply/{application}", officer)
	frappe.db.commit()
	_logger().info(f"assisted draft {application} handed back by {officer} under {consent}")
	return {"application": application, "handed_off_on": doc.gdb_handed_off_on}


def submit_for(
	officer: str, consent: str, application: str, accept_terms=None, credit_check_consent=None
) -> dict:
	"""Put the applicant's draft before the Bank, for them, under their consent.

	Recorded as the officer's act (gdb_submitted_by) and told to the applicant
	in their inbox, so nobody learns from the Bank that an application they
	never saw submitted exists. The consent ends here, as at a handback.

	A Quick Loan has no Letter of Offer, so its terms and the credit check are
	accepted at submission. Assisted, the applicant accepts them in front of the
	officer, who records it: `accept_terms` and `credit_check_consent` are
	required for a Quick Loan exactly as on the applicant's own submit
	(application.submit_application stamps both), and the log names the officer
	who attested them. Decided 2026-10-02 — an officer may submit a Quick Loan.
	"""
	from gdb_bank.services import application as application_service
	from gdb_bank.services.quick_loan import is_quick

	applicant = applicant_for(officer, consent)
	row = frappe.db.get_value(
		"Loan Application", application, ["gdb_owner", "gdb_cluster", "docstatus", "loan_product"], as_dict=True
	)
	if not row or row.gdb_owner != applicant:
		frappe.throw(_("Loan Application {0} not found.").format(application), frappe.PermissionError)
	if row.gdb_cluster:
		frappe.throw(_("A group's application is managed by its GDB facilitator."), frappe.PermissionError)
	quick = is_quick(row.loan_product)
	# Refuse before anything changes: the consent is ended below, and a refused
	# submission must leave the officer's access exactly as it was. The same two
	# rules application.submit_application enforces, asked first here.
	if quick and not cint(accept_terms):
		frappe.throw(_("Accept the terms to submit."))
	if quick and not cint(credit_check_consent):
		frappe.throw(_("Give your consent for the credit check to submit."))

	# Before the submission's own commit, so all of it lands together.
	grant = frappe.get_doc(CONSENT, consent)
	grant.application = application
	_end(grant, _("Submitted for the applicant"))
	notify(
		applicant,
		_("{0} submitted your application {1} to GDB").format(_fullname(officer), application),
		f"/loans/{application}",
		officer,
	)
	case = application_service.submit_application(
		applicant,
		application,
		accept_terms=accept_terms,
		credit_check_consent=credit_check_consent,
		submitted_by=officer,
		assisted_by=officer,
	)
	_logger().info(
		f"assisted application {application} submitted by {officer} under {consent}"
		+ (" — terms and credit check accepted by the applicant, attested by the officer" if quick else "")
	)
	return case


# -- field tasks ----------------------------------------------------------------


def _task(name: str, *, lock: bool = False):
	row = frappe.db.get_value(TASK, name, TASK_FIELDS, as_dict=True, for_update=lock)
	if not row:
		frappe.throw(_("Field task {0} not found.").format(name), frappe.DoesNotExistError)
	return row


def _photos(name: str) -> list[dict]:
	return frappe.get_all(
		"File",
		filters={"attached_to_doctype": TASK, "attached_to_name": name},
		fields=["name", "file_url", "file_name", "creation"],
		order_by="creation asc",
	)


def _task_dict(row) -> dict:
	out = dict(row)
	out["applicant_eid"] = _eids([row.applicant]).get(row.applicant)
	out.pop("applicant", None)
	out["requested_by_name"] = _fullname(row.requested_by)
	out["assigned_to_name"] = _fullname(row.assigned_to)
	out["checks"] = frappe.get_all(
		"GDB Visit Check",
		filters={"parent": row.name, "parenttype": TASK},
		fields=["item", "result", "note"],
		order_by="idx asc",
	)
	out["reference_calls"] = frappe.get_all(
		"GDB Contact Attempt",
		filters={"parent": row.name, "parenttype": TASK},
		fields=["attempted_on", "contact_name", "phone", "relationship", "result", "verdict", "note"],
		order_by="idx asc",
	)
	out["photos"] = _photos(row.name)
	return out


def request_task(
	underwriter: str,
	application: str,
	kind: str,
	instructions: str,
	due_date=None,
	address=None,
	region=None,
) -> dict:
	"""A Loan Officer asks for a site visit or reference check on a case under review."""
	kind = _note(kind)
	if kind not in TASK_KINDS:
		frappe.throw(_("Choose a site visit or a reference check."))
	instructions = _note(instructions)
	if not instructions:
		frappe.throw(_("Say what the officer should check."))
	case = frappe.db.get_value(
		"Loan Application",
		application,
		["gdb_owner", "applicant_name", "docstatus", "status", "gdb_trade_region"],
		as_dict=True,
	)
	if not case:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if cint(case.docstatus) != 1 or case.status != "Open":
		frappe.throw(_("Field work is asked for while the case is under review."))
	if is_same_person(underwriter, case.gdb_owner):
		frappe.throw(_("You cannot act on your own application."), frappe.PermissionError)
	if frappe.db.exists(TASK, {"application": application, "kind": kind, "status": ["in", list(LIVE_TASK)]}):
		frappe.throw(_("A {0} is already open on this case.").format(kind.lower()))
	if due_date and getdate(due_date) < getdate(nowdate()):
		frappe.throw(_("The due date is in the past."))

	profile = frappe.db.get_value(
		"GDB Citizen Profile", {"user": case.gdb_owner}, ["region", "address", "village_or_town"], as_dict=True
	) or frappe._dict()
	region = canonical_region(region) or canonical_region(profile.region) or canonical_region(case.gdb_trade_region)
	if not region:
		frappe.throw(_("Choose the region."))
	address = _note(address) or ", ".join(p for p in (profile.address, profile.village_or_town) if p)

	doc = frappe.get_doc(
		{
			"doctype": TASK,
			"application": application,
			"applicant": case.gdb_owner,
			"applicant_name": case.applicant_name,
			"kind": kind,
			"status": "Open",
			"region": region,
			"due_date": due_date or None,
			"instructions": instructions,
			"address": address,
			"requested_by": underwriter,
			"requested_on": now_datetime(),
			"checks": [{"item": item} for item in VISIT_CHECKLIST] if kind == SITE_VISIT else [],
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"field task {doc.name} ({kind}) raised on {application} by {underwriter}")
	return _task_dict(_task(doc.name))


def cancel_task(underwriter: str, name: str, reason) -> dict:
	reason = _note(reason)
	if not reason:
		frappe.throw(_("Say why it is cancelled."))
	doc = frappe.get_doc(TASK, name)
	if doc.status not in LIVE_TASK:
		frappe.throw(_("This task is already {0}.").format(doc.status.lower()))
	doc.update({"status": "Cancelled", "cancelled_on": now_datetime(), "cancel_reason": reason})
	doc.save(ignore_permissions=True)
	notify(doc.assigned_to, _("{0} on {1} was cancelled").format(doc.kind, doc.application), f"/field/tasks/{name}", underwriter)
	frappe.db.commit()
	_logger().info(f"field task {name} cancelled by {underwriter}")
	return _task_dict(_task(name))


def tasks_for(user: str, application: str) -> list[dict]:
	"""The field work on one case: every task for staff, an officer's own for them."""
	filters = {"application": application}
	if not _is_staff(user):
		filters["assigned_to"] = user
	names = frappe.get_all(TASK, filters=filters, pluck="name", order_by="creation desc")
	return [_task_dict(_task(n)) for n in names]


def field_task(officer: str, name: str) -> dict:
	"""One task. From the pool the officer sees what is asked and where, not who
	lives there: the address and the name follow the task once it is theirs."""
	row = _task(name)
	mine = row.assigned_to == officer
	if not (mine or (row.status == "Open" and _same_region(officer, row.region))):
		frappe.throw(_("This task is not in your region."), frappe.PermissionError)
	out = _task_dict(row)
	out["mine"] = mine
	out["phone"] = None
	if mine:
		out["phone"] = frappe.db.get_value("GDB Citizen Profile", {"user": row.applicant}, "phone")
	else:
		out.update({"applicant_name": masked_name(row.applicant_name), "address": None, "applicant_eid": None, "photos": []})
	return out


def accept_task(officer: str, name: str) -> dict:
	row = _task(name, lock=True)
	if row.assigned_to == officer:
		return field_task(officer, name)
	if row.status != "Open":
		frappe.throw(_("Another officer has already taken this task."))
	if not _same_region(officer, row.region):
		frappe.throw(_("This task is not in your region."), frappe.PermissionError)
	if is_same_person(officer, row.applicant):
		frappe.throw(_("You cannot work on your own application."), frappe.PermissionError)
	doc = frappe.get_doc(TASK, name)
	doc.update({"status": "Accepted", "assigned_to": officer, "accepted_on": now_datetime()})
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"field task {name} accepted by {officer}")
	return field_task(officer, name)


def _my_open_task(officer: str, name: str):
	doc = frappe.get_doc(TASK, name)
	if doc.assigned_to != officer:
		frappe.throw(_("This task is not assigned to you."), frappe.PermissionError)
	if doc.status != "Accepted":
		frappe.throw(_("This task is already {0}.").format(doc.status.lower()))
	return doc


def _coordinate(value, bound: float, label: str):
	if value in (None, ""):
		return None
	value = flt(value)
	if not -bound <= value <= bound:
		frappe.throw(_("{0} is out of range.").format(label))
	return value


def _apply_visit(doc, report: dict) -> None:
	answers = {(c.get("item") or ""): c for c in report.get("checks") or []}
	for check in doc.checks:
		answer = answers.get(check.item)
		if answer is None:
			continue
		result = _note(answer.get("result"))
		if result and result not in CHECK_RESULTS:
			frappe.throw(_("Answer each check Yes, No or N/A."))
		check.result = result
		check.note = _note(answer.get("note"))
	if "latitude" in report or "longitude" in report:
		doc.latitude = _coordinate(report.get("latitude"), 90, _("Latitude"))
		doc.longitude = _coordinate(report.get("longitude"), 180, _("Longitude"))
		doc.location_accuracy = flt(report.get("location_accuracy")) or None
		if doc.latitude is not None and not doc.visited_on:
			doc.visited_on = now_datetime()


def _apply_references(doc, report: dict) -> None:
	if "reference_calls" not in report:
		return
	doc.set("reference_calls", [])
	for call in report.get("reference_calls") or []:
		contact = _note(call.get("contact_name"))
		result = _note(call.get("result"))
		verdict = _note(call.get("verdict"))
		if not contact:
			frappe.throw(_("Name each reference."))
		if result not in CALL_RESULTS:
			frappe.throw(_("Choose how each call went."))
		if verdict and verdict not in VERDICTS:
			frappe.throw(_("Choose positive, neutral or negative."))
		doc.append(
			"reference_calls",
			{
				"attempted_on": call.get("attempted_on") or now_datetime(),
				"contact_name": contact,
				"phone": _note(call.get("phone")),
				"relationship": _note(call.get("relationship")),
				"result": result,
				"verdict": verdict if result == "Reached" else "",
				"note": _note(call.get("note")),
			},
		)


def _report_gaps(doc) -> list[str]:
	"""What stops this report being submitted. Empty when it is complete."""
	gaps = []
	if doc.kind == SITE_VISIT:
		if any(not c.result for c in doc.checks):
			gaps.append(_("Answer every check."))
		if doc.latitude is None or doc.longitude is None:
			gaps.append(_("Drop the map pin."))
		if not _photos(doc.name):
			gaps.append(_("Add at least one photo."))
		if not _note(doc.findings):
			gaps.append(_("Add your notes."))
	else:
		reached = {c.contact_name.strip().lower() for c in doc.reference_calls if c.result == "Reached"}
		called = {c.contact_name.strip().lower() for c in doc.reference_calls}
		if len(called) < REFERENCES_NEEDED:
			gaps.append(_("Call {0} references.").format(REFERENCES_NEEDED))
		if any(c.result == "Reached" and not c.verdict for c in doc.reference_calls):
			gaps.append(_("Give a verdict for each reference reached."))
		if not reached:
			gaps.append(_("Reach at least one reference."))
	return gaps


def save_report(officer: str, name: str, report, submit=False) -> dict:
	"""Save the report as it stands; with `submit`, file it on the case."""
	report = frappe.parse_json(report) if isinstance(report, str) else (report or {})
	doc = _my_open_task(officer, name)
	if doc.kind == SITE_VISIT:
		_apply_visit(doc, report)
	else:
		_apply_references(doc, report)
	if "findings" in report:
		doc.findings = _note(report.get("findings"))
	if cint(submit):
		gaps = _report_gaps(doc)
		if gaps:
			frappe.throw(" ".join(gaps))
		doc.status = "Submitted"
		doc.submitted_on = now_datetime()
	doc.save(ignore_permissions=True)
	if doc.status == "Submitted":
		notify(
			doc.requested_by,
			_("{0} report ready on {1}").format(doc.kind, doc.application),
			f"/loans/{doc.application}",
			officer,
		)
	frappe.db.commit()
	_logger().info(f"field task {name} report {'submitted' if doc.status == 'Submitted' else 'saved'} by {officer}")
	return field_task(officer, name)


def remove_photo(officer: str, name: str, file: str) -> dict:
	_my_open_task(officer, name)
	attached = frappe.db.get_value("File", file, ["attached_to_doctype", "attached_to_name"], as_dict=True)
	if not attached or attached.attached_to_doctype != TASK or attached.attached_to_name != name:
		frappe.throw(_("Photo not found."), frappe.DoesNotExistError)
	frappe.delete_doc("File", file, ignore_permissions=True)
	frappe.db.commit()
	return field_task(officer, name)


# -- the officer's desk ---------------------------------------------------------

DESK_TABS = ("assist", "assisted", "tasks")


def _assist_rows(officer: str) -> list[dict]:
	pool = [
		r
		for r in frappe.get_all(
			REQUEST, filters={"status": WAITING}, fields=REQUEST_FIELDS, order_by="requested_on asc", limit=DESK_SCAN
		)
		if _same_region(officer, r.region)
	]
	mine = frappe.get_all(
		REQUEST, filters={"assigned_to": officer}, fields=REQUEST_FIELDS, order_by="modified desc", limit=DESK_SCAN
	)
	return [
		{
			"name": r.name,
			"who": r.applicant_name,
			"what": " · ".join(p for p in (r.business_type, r.product, r.best_time) if p),
			"region": r.region,
			"status": r.status,
			"on": r.requested_on,
			"mine": r.assigned_to == officer,
		}
		for r in pool + mine
	]


def _assisted_status(row) -> str:
	if row.status == "Pending":
		return "Waiting for consent"
	if row.status == "Declined":
		return "Declined"
	if row.status == "Granted":
		return "In progress" if _is_live(row) else "Expired"
	if row.application:
		docstatus = cint(frappe.db.get_value("Loan Application", row.application, "docstatus"))
		return "Submitted" if docstatus == 1 else "Waiting for applicant"
	return "Ended"


def _assisted_rows(officer: str) -> list[dict]:
	rows = frappe.get_all(
		CONSENT, filters={"officer": officer}, fields=CONSENT_FIELDS, order_by="requested_on desc", limit=DESK_SCAN
	)
	return [
		{
			"name": r.name,
			"who": masked_name(_fullname(r.applicant)),
			"eid": r.applicant_eid,
			"what": r.application or "",
			"region": None,
			"status": _assisted_status(r),
			"on": r.requested_on,
			"mine": True,
		}
		for r in rows
	]


def _task_rows(officer: str) -> list[dict]:
	pool = [
		r
		for r in frappe.get_all(
			TASK, filters={"status": "Open"}, fields=TASK_FIELDS, order_by="requested_on asc", limit=DESK_SCAN
		)
		if _same_region(officer, r.region)
	]
	mine = frappe.get_all(
		TASK, filters={"assigned_to": officer}, fields=TASK_FIELDS, order_by="modified desc", limit=DESK_SCAN
	)
	return [
		{
			"name": r.name,
			"who": r.applicant_name if r.assigned_to == officer else masked_name(r.applicant_name),
			"what": f"{r.kind} · {r.application}",
			"region": r.region,
			"status": r.status,
			"on": r.requested_on,
			"due": r.due_date,
			"mine": r.assigned_to == officer,
		}
		for r in pool + mine
	]


# What needs the officer, per tab — the number on the tab.
_ACTIONABLE = {
	"assist": {WAITING, *WORKING},
	"assisted": {"Waiting for consent", "In progress", "Waiting for applicant"},
	"tasks": {"Open", "Accepted"},
}
_ROWS = {"assist": _assist_rows, "assisted": _assisted_rows, "tasks": _task_rows}


def desk(officer: str, tab: str = "assist", status: str | None = None, start=0, page_length=25) -> dict:
	"""The officer's one queue: three tabs, counts by status, filtered to their region."""
	tab = tab if tab in DESK_TABS else "assist"
	start = max(0, cint(start))
	page_length = max(1, min(cint(page_length) or 25, 100))
	lists = {key: fn(officer) for key, fn in _ROWS.items()}
	rows = lists[tab]
	statuses = Counter(r["status"] for r in rows)
	if status:
		rows = [r for r in rows if r["status"] == status]
	return {
		"region": region_of(officer),
		"rows": rows[start : start + page_length],
		"total": len(rows),
		"counts": {key: sum(1 for r in lst if r["status"] in _ACTIONABLE[key]) for key, lst in lists.items()},
		"statuses": dict(statuses),
	}


# -- the case, read-only, with its history ---------------------------------------


def holds_assignment(user: str, application: str) -> bool:
	"""Whether a field officer has a reason to read this case: a field task on it
	that is theirs, or the applicant's live consent (or the draft they handed back)."""
	if frappe.db.exists(TASK, {"application": application, "assigned_to": user, "status": ["!=", "Cancelled"]}):
		return True
	owner = frappe.db.get_value("Loan Application", application, "gdb_owner")
	for row in frappe.get_all(
		CONSENT, filters={"officer": user, "applicant": owner}, fields=CONSENT_FIELDS
	):
		if _is_live(row) or row.application == application:
			return True
	return False


def _submitted_on(application: str):
	"""When the draft became a submitted case, from Frappe's own version trail."""
	for version in frappe.get_all(
		"Version",
		filters={"ref_doctype": "Loan Application", "docname": application},
		fields=["data", "creation", "owner"],
		order_by="creation asc",
	):
		data = frappe.parse_json(version.data) or {}
		if any(change[0] == "docstatus" and cint(change[2]) == 1 for change in data.get("changed") or []):
			return version
	return None


def history(application: str) -> list[dict]:
	"""Everything that has happened to a case, newest first, from the records
	that hold each fact — nothing here is a second copy of any of them."""
	case = frappe.db.get_value(
		"Loan Application",
		application,
		[
			"creation",
			"owner",
			"gdb_owner",
			"gdb_assisted_by",
			"gdb_handed_off_on",
			"gdb_submitted_by",
			"gdb_submitted_on",
			"status",
			"gdb_reviewed_by",
			"gdb_reviewed_on",
		],
		as_dict=True,
	)
	if not case:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	events = [{"on": case.creation, "what": _("Application started"), "who": case.owner}]
	if case.gdb_handed_off_on:
		events.append({"on": case.gdb_handed_off_on, "what": _("Handed to the applicant"), "who": case.gdb_assisted_by})
	if case.gdb_submitted_on:
		events.append({"on": case.gdb_submitted_on, "what": _("Submitted to GDB"), "who": case.gdb_submitted_by})
	else:
		submitted = _submitted_on(application)
		if submitted:
			events.append({"on": submitted.creation, "what": _("Submitted to GDB"), "who": submitted.owner})
	if case.gdb_reviewed_on:
		events.append({"on": case.gdb_reviewed_on, "what": _("Decided: {0}").format(case.status), "who": case.gdb_reviewed_by})
	for r in frappe.get_all(
		"GDB Information Request",
		filters={"application": application},
		fields=["item", "status", "requested_by", "requested_on", "responded_on"],
	):
		events.append({"on": r.requested_on, "what": _("Information requested: {0}").format(r.item), "who": r.requested_by})
		if r.responded_on:
			events.append({"on": r.responded_on, "what": _("Request {0}: {1}").format(r.status.lower(), r.item), "who": None})
	for d in frappe.get_all(
		"GDB Applicant Document",
		filters={"application": application, "uploaded_on": ["is", "set"]},
		fields=["document_type", "uploaded_on", "uploaded_by", "applicant"],
	):
		events.append({"on": d.uploaded_on, "what": _("Document added: {0}").format(d.document_type), "who": d.uploaded_by or d.applicant})
	for t in frappe.get_all(TASK, filters={"application": application}, fields=TASK_FIELDS):
		events.append({"on": t.requested_on, "what": _("{0} requested").format(t.kind), "who": t.requested_by})
		if t.accepted_on:
			events.append({"on": t.accepted_on, "what": _("{0} accepted").format(t.kind), "who": t.assigned_to})
		if t.submitted_on:
			events.append({"on": t.submitted_on, "what": _("{0} report filed").format(t.kind), "who": t.assigned_to})
		if t.cancelled_on:
			events.append({"on": t.cancelled_on, "what": _("{0} cancelled").format(t.kind), "who": None})
	for e in events:
		e["who"] = _fullname(e["who"])
	return sorted((e for e in events if e["on"]), key=lambda e: get_datetime(e["on"]), reverse=True)


def case_view(user: str, application: str) -> dict:
	"""The case, read-only, for an officer with an assignment on it."""
	if not _is_staff(user) and not holds_assignment(user, application):
		frappe.throw(_("You have no assignment on this case."), frappe.PermissionError)
	row = frappe.db.get_value("Loan Application", application, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	return {"case": _portal_dict(row), "history": history(application), "tasks": tasks_for(user, application)}
