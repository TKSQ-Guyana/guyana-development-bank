"""Telling the applicant what GDB staff did on their loan application.

Every update staff make to a case — the Loan Officer's decision, a request,
a document or condition reviewed, the Letter of Offer, a site visit; the
Disbursement Officer booking and paying; a repayment received — is told to the
people the case belongs to (GDB, 2026-10-07):

  * an individual application: the applicant;
  * a group application: every ACTIVE member of the cluster, and the cluster's
    facilitator, who filed it.

Each gets the alert in their portal inbox, and outside the portal ONE of email
(a real address, mail configured) or a text (services/notification.notify).
The notice says WHAT happened, never the officer's remarks or notes: those are
written for staff, and "sign in for details" is the rule. Every event's wording
is in EVENTS below and nowhere else.

A notice is told after the action has committed and never undoes it: anything
that goes wrong here is logged and swallowed.
"""

import frappe
from frappe.utils import flt

from gdb_bank.services.notification import notify
from gdb_bank.utils.session import _logger

SIGN_IN = "Sign in at gdb.gov.gy for details."

# event -> (inbox / email subject, text). Both take the same {fields}; {app} is
# always the application's name. A text stays well under 160 characters.
EVENTS = {
	"approved": ("Your loan application {app} has been approved", "GDB: your loan application {app} has been approved."),
	"rejected": ("Your loan application {app} was not approved", "GDB: your loan application {app} was not approved."),
	"information_requested": (
		"GDB has asked for more information on your application {app}",
		"GDB: we need more information on your loan application {app}.",
	),
	"request_withdrawn": (
		"GDB has withdrawn a request on your application {app}",
		"GDB: a request on your loan application {app} was withdrawn.",
	),
	"document_accepted": ("Your {document} has been accepted", "GDB: your {document} has been accepted."),
	"document_rejected": (
		"Your {document} was not accepted — please upload it again",
		"GDB: your {document} was not accepted. Please upload it again.",
	),
	"condition_added": (
		"A condition was added to your loan {app}",
		"GDB: a condition was added to your loan {app}.",
	),
	"condition_updated": (
		"A condition on your loan {app} is now {status}",
		"GDB: a condition on your loan {app} is now {status}.",
	),
	"offer_ready": (
		"Your Letter of Offer for {app} is ready to sign",
		"GDB: your Letter of Offer for {app} is ready to sign.",
	),
	"site_visit_booked": (
		"GDB has arranged a {kind} for your application {app}",
		"GDB: we have arranged a {kind} for your loan application {app}.",
	),
	"site_visit_cancelled": (
		"The {kind} for your application {app} was cancelled",
		"GDB: the {kind} for your loan application {app} was cancelled.",
	),
	"loan_booked": ("Your loan {app} has been set up", "GDB: your loan {app} has been set up."),
	"disbursed": (
		"GDB has released {amount} on your loan {app}",
		"GDB: we have released {amount} on your loan {app}.",
	),
	"repayment_received": (
		"GDB has received your payment of {amount} on loan {app}",
		"GDB: we received your payment of {amount} on loan {app}.",
	),
}

CITIZEN_LINK = "/loans/{0}"
FACILITATOR_LINK = "/facilitator/groups/{0}"


def money(amount) -> str:
	return f"G${flt(amount):,.0f}"


def recipients(application: str) -> list[tuple[str, str]]:
	"""(user, portal link) for everyone a case's notice goes to, each once."""
	row = frappe.db.get_value("Loan Application", application, ["gdb_owner", "gdb_cluster"], as_dict=True)
	if not row:
		return []
	out = {}
	if row.gdb_owner:
		out[row.gdb_owner] = CITIZEN_LINK.format(application)
	if row.gdb_cluster:
		for member in frappe.get_all(
			"GDB Cluster Member",
			filters={"parent": row.gdb_cluster, "member_status": "Active", "member": ["is", "set"]},
			pluck="member",
		):
			out.setdefault(member, CITIZEN_LINK.format(application))
		facilitator = frappe.db.get_value("GDB Cluster", row.gdb_cluster, "facilitator")
		if facilitator:
			# The facilitator works the group from their own desk, not /loans.
			out[facilitator] = FACILITATOR_LINK.format(row.gdb_cluster)
	return list(out.items())


def _words(event: str, values: dict) -> tuple[str, str]:
	subject, text = EVENTS[event]
	return subject.format(**values), f"{text.format(**values)} {SIGN_IN}"


def tell(application: str, event: str, staff: str | None = None, **values) -> None:
	"""Tell everyone on `application` that `event` happened. Never raises."""
	try:
		subject, text = _words(event, {"app": application, **values})
		for user, link in recipients(application):
			if user == staff:
				continue
			notify(user, subject, link, from_user=staff, sms=text)
		frappe.db.commit()
	except Exception as exc:
		frappe.db.rollback()
		_logger().error(f"case notice {event} on {application} not sent: {type(exc).__name__}: {exc}")


def tell_person(user: str | None, event: str, link: str, staff: str | None = None, **values) -> None:
	"""The same, for something of one person's own — a document that follows
	the person rather than a case. Never raises."""
	if not user or user == staff:
		return
	try:
		subject, text = _words(event, {"app": "", **values})
		notify(user, subject, link, from_user=staff, sms=text)
		frappe.db.commit()
	except Exception as exc:
		frappe.db.rollback()
		_logger().error(f"notice {event} to {user} not sent: {type(exc).__name__}: {exc}")
