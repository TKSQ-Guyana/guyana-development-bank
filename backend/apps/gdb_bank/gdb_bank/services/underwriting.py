"""Underwriting: the Bank's review queue, the credit decision, lead conversion.

Callers have already checked the role; the rules here are about the case. The
one that matters most: nobody decides their own application.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from gdb_bank.security.conflict import is_same_person
from gdb_bank.services.evidence import missing_by_application
from gdb_bank.utils.constants import LOAN_FIELDS, STATUS_FROM_PORTAL, STATUS_TO_PORTAL
from gdb_bank.utils.formatters import _portal_dict, _portal_product, _stage_context, _stage_for
from gdb_bank.utils.session import _as_system, _eids, _logger


def _case(name: str) -> dict:
	return _portal_dict(frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True))


AWAITING_RELEASE = ("Sanctioned", "Partially Disbursed")

# The review queue's stage filter, and the disbursement officer's four lists.
STAGES = ("Review", "Approved", "Signing", "Disbursed", "Rejected")
QUEUES = ("quick", "booking", "release", "released")
SORTS = ("age_asc", "age_desc", "amount_desc", "amount_asc", "evidence_first")

DEFAULT_PAGE = 25
MAX_PAGE = 100

# The few columns the WHOLE queue is counted, filtered and ranked on. The full
# record — every section answer, the offer, the schedule, the evidence, what
# lending says is drawable — is built only for the page that is returned.
_QUEUE_FIELDS = [
	"name",
	"status",
	"creation",
	"gdb_reviewed_on",
	"loan_amount",
	"loan_product",
	"gdb_owner",
	"gdb_cluster",
	"gdb_business_stage",
	"applicant_name",
	"gdb_business_name",
	"gdb_submitted_on",
	"gdb_requires_loan_officer_review",
	"gdb_public_service_employed",
	"gdb_employer_category",
]


# The review queue's Employment filter -> the applicant's employer category
# (2026-10-05), or, for applications made before, the public-service answer.
EMPLOYMENT = {"public": ("Public Sector", "Yes"), "private": ("Private Sector", "No")}


def _queue_facts() -> dict:
	"""{application: its latest offer's status and its loan's state}.

	The two facts a case's stage and queue turn on, for every case at once in
	two queries — so placing a case costs nothing per row.
	"""
	facts: dict = {}
	# Oldest first, so a re-issued offer overwrites the one it replaced.
	for offer in frappe.get_all(
		"GDB Loan Offer",
		filters={"docstatus": ["<", 2]},
		fields=["application", "status"],
		order_by="creation asc",
	):
		facts.setdefault(offer.application, {})["offer_status"] = offer.status
	for loan in frappe.get_all(
		"Loan",
		filters={"loan_application": ["is", "set"], "docstatus": ["<", 2]},
		fields=["loan_application", "status", "disbursed_amount"],
	):
		facts.setdefault(loan.loan_application, {}).update(
			has_loan=True, loan_status=loan.status, disbursed_amount=flt(loan.disbursed_amount)
		)
	return facts


def _queue_of(row, fact: dict) -> str | None:
	"""Which of the disbursement officer's lists a case is on, if any."""
	# A Quick Loan is decided by the underwriter now (2026-10-02), so an open one
	# is on nobody's money list; the "quick" queue stays empty and is kept only
	# so a client asking for it is answered rather than refused.
	if row.status != "Approved":
		return None
	if not fact.get("has_loan"):
		return "booking"
	return "release" if fact.get("loan_status") in AWAITING_RELEASE else "released"


def all_loans(
	status: str | None = None,
	stage: str | None = None,
	queue: str | None = None,
	sort: str | None = None,
	start=0,
	page_length=None,
	search: str | None = None,
	product: str | None = None,
	business_stage: str | None = None,
	evidence: str | None = None,
	min_amount=None,
	max_amount=None,
	from_date: str | None = None,
	to_date: str | None = None,
	officer_review=None,
	employment: str | None = None,
) -> dict:
	"""One page of the SUBMITTED applications, with the counts for all of them.

	The review queue's filters narrow everything, the stage counts included —
	so the tabs say how many of THESE cases sit in each stage:

	  search          applicant or business name, application ID, e-ID or TIN
	  product         "standard" (SME) or "quick"
	  business_stage  "Existing" or "New"
	  min/max_amount  the amount asked for, inclusive
	  from/to_date    when it was submitted, inclusive
	  evidence        "complete" or "missing" documents
	  officer_review  1: only the cases flagged for a Loan Officer's review
	  employment      "public" or "private": the applicant's declaration of
	                  employment in the public service (Yes / No). A case
	                  that never answered it matches neither.

	Drafts are never before the Bank, so they are never in the queue.

	Filter by portal `status`, by `stage` (the review queue) or by `queue` (the
	disbursement officer's lists). Answers
	{rows, total, start, page_length, counts, queues, totals}: `total` is how
	many match the filter, `counts` and `queues` are how many sit in every
	stage and every list regardless of it, so the tabs can show their numbers
	without a request each.
	"""
	if stage and stage not in STAGES:
		frappe.throw(_("Unknown stage: {0}").format(stage))
	if queue and queue not in QUEUES:
		frappe.throw(_("Unknown queue: {0}").format(queue))
	sort = sort if sort in SORTS else SORTS[0]
	start = max(0, cint(start))
	page_length = max(1, min(cint(page_length) or DEFAULT_PAGE, MAX_PAGE))

	filters = {"docstatus": 1}
	if status:
		filters["status"] = STATUS_FROM_PORTAL.get(status, status)
	light = _narrowed(
		frappe.get_all("Loan Application", filters=filters, fields=_QUEUE_FIELDS),
		search,
		product,
		business_stage,
		min_amount,
		max_amount,
		from_date,
		to_date,
	)
	if cint(officer_review):
		light = [r for r in light if cint(r.gdb_requires_loan_officer_review)]
	if employment in EMPLOYMENT:
		category, old = EMPLOYMENT[employment]
		light = [
			r
			for r in light
			if r.gdb_employer_category == category
			or (not r.gdb_employer_category and r.gdb_public_service_employed == old)
		]
	if evidence in ("complete", "missing"):
		gaps = missing_by_application(light)
		light = [r for r in light if bool(gaps.get(r.name)) == (evidence == "missing")]

	facts = _queue_facts()
	counts = {"All": len(light), **{s: 0 for s in STAGES}}
	queues = {q: 0 for q in QUEUES}
	totals = {"quick_requested": 0.0, "released_paid": 0.0}
	since, wanted = {}, []
	for row in light:
		fact = facts.get(row.name, {})
		row_stage = _stage_for(STATUS_TO_PORTAL.get(row.status, row.status), fact)[0]
		row_queue = _queue_of(row, fact)
		counts[row_stage] = counts.get(row_stage, 0) + 1
		if row_queue:
			queues[row_queue] += 1
		if row_queue == "quick":
			totals["quick_requested"] += flt(row.loan_amount)
		elif row_queue == "released":
			totals["released_paid"] += flt(fact.get("disbursed_amount"))
		# When the case entered the stage it is in: submission while it is in
		# Review, the decision for everything after it.
		since[row.name] = row.creation if row_stage == "Review" else (row.gdb_reviewed_on or row.creation)
		if (not stage or row_stage == stage) and (not queue or row_queue == queue):
			wanted.append(row)

	if sort == "amount_desc":
		wanted.sort(key=lambda r: flt(r.loan_amount), reverse=True)
	elif sort == "amount_asc":
		wanted.sort(key=lambda r: flt(r.loan_amount))
	elif sort == "evidence_first":
		gaps = missing_by_application(wanted)
		wanted.sort(key=lambda r: len(gaps.get(r.name, [])), reverse=True)
	else:
		# age_asc is newest in its stage first; age_desc is the stale end of
		# the queue — the one a bank should be worried about.
		wanted.sort(key=lambda r: str(since[r.name]), reverse=sort == "age_asc")

	names = [r.name for r in wanted[start : start + page_length]]
	by_name = {}
	if names:
		by_name = {
			r.name: r
			for r in frappe.get_all("Loan Application", filters={"name": ["in", names]}, fields=LOAN_FIELDS)
		}
	rows = [by_name[n] for n in names if n in by_name]

	eids = _eids([r.gdb_owner for r in rows])
	ctx = _stage_context(names)
	missing = missing_by_application(rows)
	drawable = _drawable(ctx)
	return {
		"rows": [
			dict(
				_portal_dict(r, eids, ctx),
				evidence_missing=missing.get(r.name, []),
				drawable=drawable.get(r.name),
			)
			for r in rows
		],
		"total": len(wanted),
		"start": start,
		"page_length": page_length,
		"counts": counts,
		"queues": queues,
		"totals": totals,
	}


def _narrowed(rows, search, product, business_stage, min_amount, max_amount, from_date, to_date):
	"""The queue's rows that pass the review queue's filters."""
	from frappe.utils import getdate

	text = (search or "").strip().lower()
	owners = set()
	if text:
		# An e-ID or a TIN is held on the user, with or without its dashes.
		digits = "".join(c for c in text if c.isdigit())
		like = [
			["gdb_eid", "like", f"%{text}%"],
			["gdb_tin", "like", f"%{text}%"],
			["gdb_national_id", "like", f"%{text}%"],
		]
		if len(digits) >= 3 and digits != text:
			like.append(["gdb_tin", "like", f"%{digits}%"])
		owners = set(frappe.get_all("User", or_filters=like, pluck="name"))
		if len(digits) >= 3:
			for user, eid in frappe.get_all("User", filters={"gdb_eid": ["is", "set"]}, fields=["name", "gdb_eid"], as_list=True):
				if digits in "".join(c for c in (eid or "") if c.isdigit()):
					owners.add(user)
	low = flt(min_amount) if min_amount not in (None, "") else None
	high = flt(max_amount) if max_amount not in (None, "") else None
	since = getdate(from_date) if from_date else None
	until = getdate(to_date) if to_date else None
	wanted_product = (product or "").strip().lower()
	wanted_stage = (business_stage or "").strip().title()

	out = []
	for r in rows:
		if text and not (
			text in (r.name or "").lower()
			or text in (r.applicant_name or "").lower()
			or text in (r.gdb_business_name or "").lower()
			or r.gdb_owner in owners
		):
			continue
		if wanted_product in ("standard", "quick") and _portal_product(r.loan_product) != wanted_product:
			continue
		if wanted_stage in ("Existing", "New") and (r.gdb_business_stage or "").title() != wanted_stage:
			continue
		amount = flt(r.loan_amount)
		if (low is not None and amount < low) or (high is not None and amount > high):
			continue
		submitted = getdate(r.gdb_submitted_on or r.creation)
		if (since and submitted < since) or (until and submitted > until):
			continue
		out.append(r)
	return out


def _drawable(ctx: dict) -> dict:
	"""{application: what lending says is still drawable} for loans awaiting release.

	lending's get_disbursal_amount — the same figure the release panel offers
	and Loan Disbursement validates against — so the queue never works out
	"sanctioned minus disbursed" for itself. Only for loans still awaiting a
	draw: it takes a row lock, and a closed or fully drawn loan has nothing to
	release. Elevated because it gates on a Loan permission portal roles lack.
	"""
	from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
		get_disbursal_amount,
	)

	out = {}
	with _as_system():
		for application, case in ctx.items():
			if case.get("loan") and case.get("loan_status") in AWAITING_RELEASE:
				out[application] = flt(get_disbursal_amount(case["loan"])[0])
	return out


def review_loan(user: str, name: str, action: str, remarks: str | None = None) -> dict:
	"""Approve or reject an open application."""
	doc = frappe.get_doc("Loan Application", name)

	# A Quick Loan is decided here too, like every GDB loan (2026-10-02): the
	# underwriter decides, a Letter of Offer is signed, a different officer pays.

	# Segregation of duties: an underwriter may also be a borrower, and must
	# never decide their own case — not from the same account, and not from a
	# staff account belonging to the same person (security/conflict.py).
	if is_same_person(user, doc.gdb_owner):
		frappe.throw(
			_("You cannot review your own application. Ask another loan officer."), frappe.PermissionError
		)

	new_status = {"approve": "Approved", "reject": "Rejected"}.get(action)
	if not new_status:
		frappe.throw(_("Unknown action: {0}").format(action))
	if doc.status != "Open":
		frappe.throw(_("Cannot {0} an application in status {1}.").format(action, doc.status))
	if action == "approve":
		# The loan officer's checklist — e-ID (asked for is enough), National ID,
		# bank account, payslip — comes before approval (services/checklist).
		from gdb_bank.services.checklist import require_ready

		require_ready(name)

	# db_set: the doc is submitted; status is permlevel-guarded and the review
	# fields are allow_on_submit.
	doc.db_set("status", new_status)
	if remarks:
		doc.db_set("gdb_remarks", remarks.strip())
	doc.db_set("gdb_reviewed_by", user)
	doc.db_set("gdb_reviewed_on", now_datetime())
	frappe.db.commit()
	_logger().info(f"loan {name}: {action} by {user} -> {new_status}")
	from gdb_bank.services import case_notice

	case_notice.tell(name, "approved" if action == "approve" else "rejected", user)
	return _case(name)


def convert_lead(user: str, lead: str, cluster: str | None = None, purpose: str | None = None) -> dict:
	"""Turn a submitted Loan Lead into a Loan Application.

	lending's converter types its argument as a Document, so REST cannot reach
	it; this hands it the real doc, then adds the facts only GDB knows.
	"""
	lead_doc = frappe.get_doc("Loan Lead", lead)
	if lead_doc.docstatus != 1:
		frappe.throw(_("Submit lead {0} before converting it.").format(lead))

	from lending.loan_origination.doctype.loan_lead.loan_lead import convert_to_loan_application

	# The converter returns nothing, so diff the table to find what it made.
	before = set(frappe.get_all("Loan Application", pluck="name"))
	convert_to_loan_application(lead_doc)
	created = set(frappe.get_all("Loan Application", pluck="name")) - before
	if not created:
		frappe.throw(_("Lead {0} produced no application.").format(lead))

	doc = frappe.get_doc("Loan Application", created.pop())
	doc.is_term_loan = 1
	doc.repayment_method = "Repay Over Number of Periods"
	doc.gdb_owner = frappe.db.get_value("User", {"email": lead_doc.email}) or user
	doc.gdb_purpose = (purpose or "").strip()
	doc.gdb_monthly_income = flt(lead_doc.income)
	if cluster:
		doc.gdb_cluster = cluster
	doc.save()
	frappe.db.commit()
	_logger().info(f"lead {lead} -> application {doc.name} by {user}")
	return _case(doc.name)
