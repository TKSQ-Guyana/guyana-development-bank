"""Turn lending rows into the stable portal shape the SPA reads.

`_portal_dict` is the one place a Loan Application row becomes the portal
contract, and `_stage_context`/`_stage_for` derive the applicant-facing stage
from the records that follow the credit decision. `_normalised_phone` coerces a
typed Guyanese number into the E.164 shape lending's Phone field will accept.

Depends only on constants and session (both in utils), never on api or
services, so the presentation shape has no path back up into the controllers.
"""

import frappe
from frappe.utils import cint, flt

from gdb_bank.utils.constants import (
	GUYANA_DIAL_CODE,
	SECTION_KEYS,
	STAGE_LABELS,
	STATUS_TO_PORTAL,
)
from gdb_bank.utils.session import _eids, _is_staff


def _normalised_phone(phone: str | None) -> str:
	"""A phone in the E.164 shape Frappe's Phone field will accept, or "".

	Never throws. A number this cannot make sense of is dropped rather than
	held against the applicant — it is an optional field, and an underwriter
	with no phone number is better off than an applicant who cannot apply.
	"""
	raw = (phone or "").strip()
	if not raw:
		return ""

	plus = raw.startswith("+")
	digits = "".join(c for c in raw if c.isdigit())
	if not digits:
		return ""
	if plus:
		return f"+{digits}"
	# Typed with the country code but no plus — the commonest shape by far.
	if digits.startswith("592"):
		return f"+{digits}"
	return f"{GUYANA_DIAL_CODE}{digits}"


def _stage_context(names: list[str]) -> dict:
	"""Offer, conditions and disbursement state for these applications.

	One batch per record type rather than per application, because the citizen
	dashboard and the staff queue both render whole lists. Read with get_all /
	get_value, which do not apply permissions — the caller has already been
	checked against the application itself, and these are facts about that same
	case.
	"""
	ctx = {n: {} for n in names if n}
	if not ctx:
		return ctx

	wanted = list(ctx)
	# Latest offer per application. Ordered oldest-first so a re-issued offer
	# overwrites the one it replaced.
	for offer in frappe.get_all(
		"GDB Loan Offer",
		filters={"application": ["in", wanted], "docstatus": ["<", 2]},
		fields=[
			"application",
			"status",
			"name",
			"valid_until",
			"offered_amount",
			"term_months",
			"monthly_instalment",
		],
		order_by="creation asc",
	):
		live = offer.status in ("Issued", "Accepted")
		ctx[offer.application].update(
			offer_status=offer.status,
			offer=offer.name,
			offer_valid_until=offer.valid_until,
			# The underwriter's decision on amount and term. Only a live offer
			# carries one: a declined or lapsed offer approved nothing.
			approved_amount=flt(offer.offered_amount) if live else None,
			approved_term=cint(offer.term_months) if live else None,
			offer_instalment=flt(offer.monthly_instalment) if live else None,
		)

	# Counted in Python rather than with a SQL aggregate: Frappe refuses a
	# function written as a string in `fields`, and the row count here is one
	# per outstanding condition on the cases already on screen.
	for cond in frappe.get_all(
		"GDB Loan Condition",
		filters={"application": ["in", wanted], "status": "Outstanding", "is_required": 1},
		fields=["application"],
	):
		entry = ctx[cond.application]
		entry["conditions_outstanding"] = cint(entry.get("conditions_outstanding")) + 1

	loans = frappe.get_all(
		"Loan",
		filters={"loan_application": ["in", wanted], "docstatus": ["<", 2]},
		fields=[
			"loan_application",
			"name",
			"status",
			"loan_amount",
			"repayment_periods",
			"disbursed_amount",
			"monthly_repayment_amount",
		],
	)
	instalments = _schedule_instalments([loan.name for loan in loans])
	for loan in loans:
		ctx[loan.loan_application].update(
			loan=loan.name,
			loan_status=loan.status,
			sanctioned_amount=flt(loan.loan_amount),
			sanctioned_term=cint(loan.repayment_periods),
			disbursed_amount=flt(loan.disbursed_amount),
			loan_instalment=flt(loan.monthly_repayment_amount),
			schedule_instalment=instalments.get(loan.name),
		)

	# Section C's use-of-funds lines, and what they come to — the total is
	# Frappe's own SUM, grouped per application in one query for the batch,
	# never an addition done here or in the client.
	lines = {
		"parent": ["in", wanted],
		"parenttype": "Loan Application",
		"parentfield": USE_OF_FUNDS_FIELD,
	}
	for line in frappe.get_all(
		USE_OF_FUNDS_LINE, filters=lines, fields=["parent", "item", "amount"], order_by="idx asc"
	):
		ctx[line.parent].setdefault("use_of_funds", []).append(
			{"item": line.item, "amount": flt(line.amount)}
		)
	for total in frappe.get_all(
		USE_OF_FUNDS_LINE,
		filters=lines,
		fields=["parent", {"SUM": "amount", "as": "total"}],
		group_by="parent",
	):
		ctx[total.parent]["use_of_funds_total"] = flt(total.total)

	# Section B's declared partners and shareholders, read back the same way —
	# so a half-finished application resumes with its co-owners still on it,
	# and an underwriter reading the case sees who else owns the business.
	for line in frappe.get_all(
		OWNERSHIP_LINE,
		filters={
			"parent": ["in", wanted],
			"parenttype": "Loan Application",
			"parentfield": OWNERSHIP_FIELD,
		},
		fields=["parent", "holder_eid", "holder_name", "share_percent"],
		order_by="idx asc",
	):
		ctx[line.parent].setdefault("ownership_lines", []).append(
			{"eid": line.holder_eid, "name": line.holder_name, "share": flt(line.share_percent)}
		)
	return ctx


USE_OF_FUNDS_LINE = "GDB Use Of Funds Line"
USE_OF_FUNDS_FIELD = "gdb_use_of_funds_lines"
OWNERSHIP_LINE = "GDB Ownership Line"
OWNERSHIP_FIELD = "gdb_ownership_lines"


def _schedule_instalments(loans: list[str]) -> dict:
	"""{loan: instalment} from each loan's current lending repayment schedule.

	The schedule is what lending actually bills: a disbursement generates it on
	the amount released, and lending regenerates it on a further tranche or an
	advance payment. The Loan's own monthly_repayment_amount is only the figure
	at booking and is never updated after that, so it is not the instalment
	once money has moved. The Active schedule when there is one; otherwise the
	latest submitted one (a closed loan keeps the instalment it ended on).
	"""
	current = {}
	if not loans:
		return current
	for sched in frappe.get_all(
		"Loan Repayment Schedule",
		filters={"loan": ["in", loans], "docstatus": 1},
		fields=["loan", "status", "monthly_repayment_amount"],
		order_by="creation asc",
	):
		if current.get(sched.loan, {}).get("status") != "Active":
			current[sched.loan] = sched
	return {loan: flt(s.monthly_repayment_amount) for loan, s in current.items()}


def _stage_for(status: str, ctx: dict) -> tuple:
	"""(stage, label) for one application, from its status and what follows it.

	Read top down: money that has moved outranks an accepted offer, which
	outranks the decision that produced it. Anything before the decision is the
	decision's own status.
	"""
	if status in ("Draft", "Rejected"):
		return ("Draft" if status == "Draft" else "Rejected", STAGE_LABELS[status])
	if status == "Submitted":
		return ("Review", STAGE_LABELS["Review"])

	# Approved from here on.
	if flt(ctx.get("disbursed_amount")) > 0:
		return ("Disbursed", STAGE_LABELS["Disbursed"])

	# An issued Letter of Offer IS the signing step; it stays there, with the
	# next thing to happen as its label, until money moves.
	offer_status = ctx.get("offer_status")
	if offer_status == "Issued":
		return ("Signing", STAGE_LABELS["Offer"])
	if offer_status == "Accepted":
		if cint(ctx.get("conditions_outstanding")):
			return ("Signing", STAGE_LABELS["Conditions"])
		return ("Signing", STAGE_LABELS["Release"])
	if offer_status in ("Declined", "Expired"):
		return ("Approved", STAGE_LABELS[offer_status])
	return ("Approved", STAGE_LABELS["Approved"])


# A group member reads the head's case, but not the head's own contact number
# or income; and no citizen is told which officer decided a case.
_APPLICANT_ONLY = ("phone", "monthly_income")
_STAFF_ONLY = ("reviewed_by",)


def _for_viewer(case: dict, user: str) -> dict:
	"""A portal case as `user` may see it: the same shape, private values blanked."""
	if _is_staff(user):
		return case
	hidden = _STAFF_ONLY + (() if case.get("applicant") == user else _APPLICANT_ONLY)
	return {key: (None if key in hidden else value) for key, value in case.items()}


def _portal_dict(row, eids: dict | None = None, ctx: dict | None = None) -> dict:
	"""Normalize a lending Loan Application row to the stable portal shape.

	`eids` is the batch from _eids() when this is one row of a list; a single
	row looks its own up. Either way the applicant's e-ID travels with the
	application, because that — not their mailbox — is who staff are looking at.

	`ctx` is the same arrangement for _stage_context: the batch when this is one
	row of a list, looked up per row otherwise.
	"""
	get = row.get if isinstance(row, dict) else lambda f: row.get(f)
	owner = get("gdb_owner")
	name = get("name")
	if eids is None:
		eids = _eids([owner])
	if ctx is None:
		ctx = _stage_context([name])
	# A draft is the applicant's own workspace: it exists so evidence can be
	# attached before submission, and lending has no status for it (a fresh
	# application is `Open` the moment it is submitted). docstatus is what
	# distinguishes them, so the portal reads that rather than inventing a
	# status field lending would not maintain.
	status = "Draft" if cint(get("docstatus")) == 0 else STATUS_TO_PORTAL.get(
		get("status"), get("status")
	)
	case = ctx.get(name) or {}
	stage, stage_label = _stage_for(status, case)
	return {
		"name": get("name"),
		"applicant": get("gdb_owner"),
		"applicant_eid": eids.get(owner),
		"cluster": get("gdb_cluster"),
		"business_stage": get("gdb_business_stage"),
		"dcra_number": get("gdb_dcra_number"),
		"business_name": get("gdb_business_name"),
		"applicant_name": get("applicant_name"),
		"loan_amount": get("loan_amount"),
		"purpose": get("gdb_purpose"),
		"term_months": get("repayment_periods"),
		"monthly_income": get("gdb_monthly_income"),
		"phone": get("applicant_phone_number"),
		"status": status,
		# Where the case actually is, and what to tell the applicant it means.
		# See PORTAL_STAGES — `status` stays exactly as it was for every caller
		# that already reads it.
		"stage": stage,
		"stage_label": stage_label,
		"offer_status": case.get("offer_status"),
		# Zero for the applicant, not merely hidden from their screen. The
		# conditions precedent are GDB's internal pre-release checks (see
		# conditions.list_conditions, staff-only), and a count served to a
		# client that does not render it is still the client's to read. The
		# stage above is computed from the real number before this line, so
		# the applicant still learns that GDB is finishing its checks.
		"conditions_outstanding": cint(case.get("conditions_outstanding")) if _is_staff() else 0,
		"loan": case.get("loan"),
		"loan_status": case.get("loan_status"),
		"disbursed_amount": flt(case.get("disbursed_amount")),
		# `loan_amount` and `term_months` above stay what was REQUESTED — the
		# draft form round-trips them. These are the figures that followed:
		#   approved_*   the live Letter of Offer (the underwriter's decision)
		#   sanctioned_* the booked Loan, as lending holds it
		#   facility_*   whichever of those stands now, for a one-line summary
		"approved_amount": case.get("approved_amount"),
		"approved_term": case.get("approved_term"),
		"sanctioned_amount": case.get("sanctioned_amount"),
		"facility_amount": case.get("sanctioned_amount")
		or case.get("approved_amount")
		or get("loan_amount"),
		"facility_term": case.get("sanctioned_term")
		or case.get("approved_term")
		or get("repayment_periods"),
		# False only for a Loan booked before book_loan took the offer's terms —
		# lending holds the requested amount, and release refuses it until it is
		# rebooked (services.disbursement.offer_mismatch). None when there is no
		# Loan or no live offer to compare.
		"booked_on_offer": None
		if case.get("sanctioned_amount") is None or case.get("approved_amount") is None
		else (
			case["sanctioned_amount"] == case["approved_amount"]
			and case.get("sanctioned_term") == case.get("approved_term")
		),
		# Sections B-H as one nested block, so the form round-trips exactly
		# what it sent and the underwriter's case view reads the same shape.
		# `sections.use_of_funds` is only the legacy text, for an application
		# from before the lines below existed.
		"sections": {key: get(fieldname) for key, (fieldname, _t) in SECTION_KEYS.items()},
		# Section C's use of funds as the child-table rows, and Frappe's SUM of
		# them. None, not 0, when there are no lines to total.
		"use_of_funds": case.get("use_of_funds") or [],
		"use_of_funds_total": case.get("use_of_funds_total"),
		# Declared co-owners, and the applicant's own share. Both travel on
		# every case so the wizard can resume them and the review screen can
		# show who else owns the business a loan is going to.
		"ownership_lines": case.get("ownership_lines") or [],
		"applicant_share": get("gdb_applicant_share"),
		"underwriter_remarks": get("gdb_remarks"),
		"reviewed_by": get("gdb_reviewed_by"),
		"reviewed_on": get("gdb_reviewed_on"),
		"rate_of_interest": get("rate_of_interest"),
		# The instalment as lending states it at this point in the case, never a
		# figure of GDB's: the repayment schedule once money has moved; the
		# booked Loan's before that; the offer's (lending's own function, see
		# GDBLoanOffer.set_repayment_figures) before booking; and the
		# application's indicative figure on the requested amount before that.
		"monthly_repayment": (
			(case.get("schedule_instalment") if flt(case.get("disbursed_amount")) > 0 else None)
			or case.get("loan_instalment")
			or case.get("offer_instalment")
			or get("repayment_amount")
		),
		"creation": get("creation"),
		"modified": get("modified"),
	}
