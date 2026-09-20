"""Conditions precedent — the checklist between an accepted offer and money.

The Letter of Offer states what must be true before GDB will release funds.
Those statements only mean something if a person has to tick each one off and
the system refuses to disburse until they have. That is what this module does:

    Offer accepted -> conditions raised -> each verified by staff
                   -> only then may disburse_loan run

Conditions are raised from the accepted offer's own wording, so the checklist
and the agreement can never disagree. Verification records who and when, which
is the audit line an examiner asks for first.

Endpoints: POST /api/method/gdb_bank.conditions.<name>
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from gdb_bank.api import (
	_as_system,
	_logger,
	_readable_application,
	_require_underwriter,
	_session_user,
)

CONDITION_FIELDS = [
	"name",
	"application",
	"offer",
	"description",
	"status",
	"is_required",
	"verified_by",
	"verified_on",
	"note",
]

OPEN = "Outstanding"
SETTLED = ("Met", "Waived")


def raise_for_offer(offer) -> int:
	"""Create the checklist from an accepted offer. Idempotent per offer."""
	if frappe.db.exists("GDB Loan Condition", {"offer": offer.name}):
		return 0

	lines = [c.strip() for c in (offer.conditions or "").splitlines() if c.strip()]
	for line in lines:
		frappe.get_doc(
			{
				"doctype": "GDB Loan Condition",
				"application": offer.application,
				"offer": offer.name,
				"description": line,
				"status": OPEN,
				"is_required": 1,
			}
		).insert(ignore_permissions=True)
	_logger().info(f"raised {len(lines)} conditions for {offer.name}")
	return len(lines)


def outstanding(application: str) -> list[str]:
	"""Required conditions still blocking release."""
	return frappe.get_all(
		"GDB Loan Condition",
		filters={"application": application, "is_required": 1, "status": OPEN},
		pluck="description",
	)


@frappe.whitelist()
def list_conditions(application: str):
	"""The checklist for an application — applicant-visible by design.

	The SOW wants the borrower to see exactly what is holding their money up,
	so this is readable by whoever may read the case, not staff only.
	"""
	user = _session_user()
	_readable_application(application, user)
	rows = frappe.get_all(
		"GDB Loan Condition",
		filters={"application": application},
		fields=CONDITION_FIELDS,
		order_by="creation asc",
	)
	return {
		"conditions": rows,
		"outstanding": len([r for r in rows if r.is_required and r.status == OPEN]),
		"total": len(rows),
	}


@frappe.whitelist()
def add_condition(application: str, description: str, is_required=1):
	"""Add a case-specific condition after the offer has gone out. Staff only.

	The standard conditions are raised from the Letter of Offer when it is
	accepted, and that is right for what the offer says. It is not enough for
	what a case turns out to need: a valuation that has to be re-done, a lease
	assignment nobody knew about until the site visit. Without this, an
	underwriter who learned something after issue had two options — release
	anyway, or reissue the whole offer.

	A condition added here blocks release exactly like one raised from the
	offer (api.disburse_loan reads `outstanding`, which does not care where a
	condition came from), and the applicant sees it in the same checklist.
	"""
	staff = _require_underwriter()
	description = (description or "").strip()
	if not description:
		frappe.throw(_("A condition needs wording."))

	row = frappe.db.get_value("Loan Application", application, ["name", "status"], as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))

	# Same wording twice on one case reads as a mistake, not two conditions —
	# an underwriter who wants a second bank-statement request, say, should
	# say what makes it different, not repeat the sentence.
	if frappe.db.exists(
		"GDB Loan Condition", {"application": application, "description": description}
	):
		frappe.throw(_("This case already has a condition with that exact wording."))

	# Tie it to the agreement when there is one, so the checklist still reads as
	# one list against one offer.
	from gdb_bank.offers import accepted_offer

	agreement = accepted_offer(application)

	doc = frappe.get_doc(
		{
			"doctype": "GDB Loan Condition",
			"application": application,
			"offer": agreement.name if agreement else None,
			"description": description,
			"status": OPEN,
			"is_required": 1 if frappe.utils.cint(is_required) else 0,
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"condition {doc.name} added to {application} by {staff}")
	return frappe.db.get_value("GDB Loan Condition", doc.name, CONDITION_FIELDS, as_dict=True)


@frappe.whitelist()
def verify_condition(name: str, status: str, note: str | None = None):
	"""Staff mark a condition met or waived. Underwriter/officer only.

	A waiver is deliberately as visible as a pass: same record, same
	attribution, different word. Nobody should be able to make a condition
	disappear quietly.
	"""
	staff = _require_underwriter()
	status = (status or "").strip().title()
	if status not in (OPEN, *SETTLED):
		frappe.throw(_("Status must be Outstanding, Met or Waived."))

	doc = frappe.get_doc("GDB Loan Condition", name)
	with _as_system():
		doc.status = status
		doc.note = (note or "").strip()
		if status in SETTLED:
			doc.verified_by = staff
			doc.verified_on = now_datetime()
		else:
			# Reopening clears the attribution — a stale signature on an open
			# item is worse than none.
			doc.verified_by = None
			doc.verified_on = None
		doc.save()
		frappe.db.commit()

	_logger().info(f"condition {name} -> {status} by {staff}")
	return frappe.db.get_value("GDB Loan Condition", name, CONDITION_FIELDS, as_dict=True)
