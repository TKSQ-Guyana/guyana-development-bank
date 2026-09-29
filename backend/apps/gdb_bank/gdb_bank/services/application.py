"""Loan-application banking rules: draft save, submission, discard, the one-shot
apply, and the read paths a borrower sees (their list, one case, the booked loan
account).

Storage is the official frappe/lending app's Loan Application doctype; this
layer maps the stable portal contract onto it and enforces what a draft may
hold and who may read a case. The whitelisted endpoints in gdb_bank.api are thin
wrappers that hand in the session user. Who shares a group's case is the
cluster service's rule.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from gdb_bank.install import APPLICATION_SECTIONS, LOAN_PRODUCT_NAME
from gdb_bank.utils.constants import (
	EXISTING_ONLY,
	LOAN_ACCOUNT_FIELDS,
	LOAN_FIELDS,
	NEW_ONLY,
	SECTION_KEYS,
)
from gdb_bank.utils.formatters import (
	_for_viewer,
	_normalised_phone,
	_portal_dict,
	_schedule_instalments,
	_stage_context,
)
from gdb_bank.utils.session import _as_system, _eids, _is_staff, _logger, _session_user
from gdb_bank.services.cluster import (
	_cluster_for,
	_clusters_of,
	_is_shared_with,
	notify_group_submitted,
)
from gdb_bank.services.evidence import missing_evidence
from gdb_bank.services.user import _get_or_create_customer


def _blanked(fieldnames) -> dict:
	"""Empty values for these fields, each of its own type."""
	by_name = {f[0]: f[2] for f in APPLICATION_SECTIONS}
	return {f: (0 if by_name.get(f) in ("Currency", "Int") else "") for f in fieldnames}


def _use_of_funds_lines(raw) -> list[dict]:
	"""The use-of-funds lines as child-table rows, from what the form sent.

	The form sends a list of {item, amount} — as a list, or JSON-encoded the way
	the portal always has. A line with no item is dropped, as the form drops it.
	Plain text that is not a list (a caller from before the table existed) is
	kept as one line with no amount rather than thrown away.
	"""
	if isinstance(raw, str):
		text = raw.strip()
		if not text:
			return []
		try:
			raw = frappe.parse_json(text)
		except Exception:
			return [{"item": text, "amount": 0}]
		if not isinstance(raw, list):
			return [{"item": text, "amount": 0}]
	if not isinstance(raw, list):
		return []
	lines = []
	for row in raw:
		if not isinstance(row, dict):
			continue
		item = (row.get("item") or "").strip() if isinstance(row.get("item"), str) else ""
		if not item:
			continue
		amount = flt(row.get("amount"))
		if amount < 0:
			frappe.throw(_("A use-of-funds amount cannot be negative."))
		lines.append({"item": item, "amount": amount})
	return lines


def _section_values(sections) -> dict:
	"""Section B-H answers, whitelisted against the table and coerced by type.

	Anything the table does not name is DROPPED rather than written. This is
	reached from a whitelisted endpoint, and handing an arbitrary dict to
	doc.update() would let any caller set any field on the Loan Application —
	including the permlevel-1 status this module is careful never to touch
	outside review_loan.
	"""
	if not sections:
		return {}
	if isinstance(sections, str):
		sections = frappe.parse_json(sections)
	if not isinstance(sections, dict):
		return {}

	values = {}
	# Partners and shareholders, as rows. Handled outside the SECTION_KEYS loop
	# because unlike use_of_funds there is no legacy text field to derive the
	# key from — the ownership table was a table from the start.
	if "ownership_lines" in sections:
		values["gdb_ownership_lines"] = _ownership_lines(sections.get("ownership_lines"))
	for key, (fieldname, fieldtype) in SECTION_KEYS.items():
		if key not in sections:
			continue
		raw = sections.get(key)
		if key == "use_of_funds":
			# Rows of the gdb_use_of_funds_lines child table, not text: each
			# amount is then a Currency column Frappe can SUM.
			values["gdb_use_of_funds_lines"] = _use_of_funds_lines(raw)
			continue
		if fieldtype in ("Currency", "Percent"):
			values[fieldname] = flt(raw)
		elif fieldtype == "Int":
			values[fieldname] = cint(raw)
		else:
			values[fieldname] = (raw or "").strip() if isinstance(raw, str) else (raw or "")
	return values


def _ownership_lines(raw) -> list[dict]:
	"""Declared partners and shareholders as child-table rows.

	Shaped exactly like `_use_of_funds_lines`: the form sends a list of
	{eid, name, share}, as a list or JSON-encoded. A row naming nobody is
	dropped, because a blank line in a form is not a co-owner.

	Nothing here checks that the e-ID belongs to a real person, and that is
	deliberate — these are DECLARED owners. Naming somebody is not the same as
	that person agreeing, and a co-owner who must consent does so through their
	own sign-in.
	"""
	if isinstance(raw, str):
		text = raw.strip()
		if not text:
			return []
		try:
			raw = frappe.parse_json(text)
		except Exception:
			return []
	if not isinstance(raw, list):
		return []

	rows = []
	for line in raw:
		if not isinstance(line, dict):
			continue
		eid = (line.get("eid") or "").strip()
		name = (line.get("name") or "").strip()
		if not eid and not name:
			continue
		rows.append(
			{"holder_eid": eid, "holder_name": name, "share_percent": flt(line.get("share"))}
		)
	return rows


def _check_shares(values: dict) -> None:
	"""The applicant's share plus everybody else's may not exceed 100.

	Checked on the SERVER because the form is not the enforcement boundary, and
	checked on the DRAFT as well as the submission because `_validated` is
	shared by both — a draft must not be able to hold what a submission would
	have refused.

	A total UNDER 100 is allowed and deliberately so: an applicant who does not
	know every shareholder of the company they work in should not be blocked
	from applying, and an underwriter reading 60% declared knows to ask about
	the rest. Only a total over 100, which cannot be true of anything, is
	refused.
	"""
	declared = flt(values.get("gdb_applicant_share"))
	declared += sum(flt(row.get("share_percent")) for row in values.get("gdb_ownership_lines") or [])
	if declared > 100:
		frappe.throw(
			_("The declared ownership shares add up to {0}%. They cannot exceed 100%.").format(
				flt(declared, 2)
			)
		)


def _validated(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	user: str | None = None,
) -> dict:
	"""Check what the applicant typed, and answer the fields to write.

	Shared by the draft save and the one-shot apply, so that a draft cannot hold
	anything a submitted application would have refused.
	"""
	user = user or _session_user()

	loan_amount = flt(loan_amount)
	term_months = cint(term_months)
	purpose = (purpose or "").strip()
	if loan_amount <= 0:
		frappe.throw(_("Loan amount must be greater than zero."))
	if not (1 <= term_months <= 360):
		frappe.throw(_("Term must be between 1 and 360 months."))
	if not purpose:
		frappe.throw(_("Purpose is required."))

	cluster = _cluster_for(user, cluster)

	# Existing vs new business is a real fork, not a label: an existing trading
	# business is expected to name its DCRA registration, a start-up has none
	# to give. Enforce that here so an underwriter never sees "Existing" with
	# nothing behind it.
	business_stage = (business_stage or "").strip().title()
	if business_stage and business_stage not in ("Existing", "New"):
		frappe.throw(_("Business stage must be Existing or New."))
	dcra_number = (dcra_number or "").strip().upper()
	business_name = (business_name or "").strip()
	if business_stage == "Existing" and not dcra_number:
		frappe.throw(_("Give the DCRA registration number of your existing business."))
	if business_stage == "New":
		# A start-up has no registration yet, so never carry one over.
		dcra_number = ""
	if business_stage and not business_name:
		frappe.throw(_("Business name is required."))

	product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	if not product:
		frappe.throw(_("Loan Product is not configured. Contact the administrator."))

	values = {
		"applicant_type": "Customer",
		"applicant": _get_or_create_customer(user),
		"applicant_name": frappe.utils.get_fullname(user),
		"applicant_email_address": user,
		"applicant_phone_number": _normalised_phone(phone),
		"company": frappe.db.get_value("Loan Product", product, "company"),
		"posting_date": nowdate(),
		"loan_product": product,
		"loan_amount": loan_amount,
		"is_term_loan": 1,
		"repayment_method": "Repay Over Number of Periods",
		"repayment_periods": term_months,
		"status": "Open",
		"gdb_owner": user,
		"gdb_purpose": purpose,
		"gdb_monthly_income": flt(monthly_income) if monthly_income else 0,
		"gdb_cluster": cluster,
		"gdb_business_stage": business_stage,
		"gdb_dcra_number": dcra_number,
		"gdb_business_name": business_name,
	}
	values.update(_section_values(sections))
	# The stage decides which financial block is meaningful, so switching it
	# clears the other one. Same reasoning as dropping the DCRA number above:
	# a start-up must never carry filed accounts, and a trading business must
	# never be decided on forecasts it did not make.
	if business_stage == "Existing":
		values.update(_blanked(NEW_ONLY))
	elif business_stage == "New":
		values.update(_blanked(EXISTING_ONLY))
	_check_shares(values)
	return values


def _own_draft(name: str, user: str):
	"""A draft the caller owns, or a clear refusal."""
	row = frappe.db.get_value(
		"Loan Application", name, ["name", "gdb_owner", "docstatus"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	if row.gdb_owner != user:
		frappe.throw(_("You may only edit your own application."), frappe.PermissionError)
	if cint(row.docstatus) != 0:
		frappe.throw(_("{0} has already been submitted to GDB.").format(name))
	return row


def save_application(
	user: str,
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	name: str | None = None,
):
	"""Create or update the applicant's own DRAFT application.

	A draft exists so evidence can be attached before the application is made:
	a document shelf needs something to hang off, and asking a citizen to
	submit first and substantiate afterwards inverts the order the Bank needs
	them in. It is the resume point too — a session that drops on a Region 9
	phone connection loses nothing already saved.

	Nothing here is before the Bank: all_loans excludes drafts, and only
	submit_application moves one across.
	"""
	values = _validated(
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
		user=user,
	)

	if name:
		_own_draft(name, user)
		doc = frappe.get_doc("Loan Application", name)
		doc.update(values)
	else:
		doc = frappe.get_doc(dict(doctype="Loan Application", **values))
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.db.commit()
	_logger().info(f"draft application {doc.name} saved by {user}")
	return _portal_dict(frappe.db.get_value("Loan Application", doc.name, LOAN_FIELDS, as_dict=True))


def submit_application(user: str, name: str):
	"""Put a draft before the Bank. Evidence is EXPECTED but never blocking.

	Documents used to gate this call. They no longer do: an applicant on a
	Region 9 phone connection who cannot scan a business plan today should
	still be able to put their case in front of the Bank, and asking for the
	paperwork is a conversation the underwriter can have — `request_information`
	exists for exactly that. The expected-document list is still computed and
	still shown on both sides of the desk, so nobody decides a thin file
	without knowing it is thin.

	What is outstanding at the moment of submission goes in the log, because a
	case that arrived incomplete is a fact about the case and not just about
	the screen it was typed on.
	"""
	_own_draft(name, user)
	outstanding = missing_evidence(name)

	doc = frappe.get_doc("Loan Application", name)
	doc.flags.ignore_permissions = True
	doc.submit()
	frappe.db.commit()
	# A group's application is the group's business. Until now nothing was sent
	# at submission at all, so an invitee who missed the one invitation
	# notification was never told again — and since only an ACTIVE member can
	# see the case, "I invited them and submitted it" and "I have never seen
	# anything" were both true at once. See notify_group_submitted.
	if doc.gdb_cluster:
		notify_group_submitted(user, doc.gdb_cluster, name)
	_logger().info(
		f"loan application {name} submitted by {user} for {doc.loan_amount}"
		+ (f" with documents outstanding: {', '.join(outstanding)}" if outstanding else "")
	)
	return _portal_dict(frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True))


def discard_application(user: str, name: str):
	"""Abandon a draft. Only ever a draft — once submitted it is the Bank record
	of what was asked for, and withdrawal is a decision rather than a delete."""
	_own_draft(name, user)
	frappe.delete_doc("Loan Application", name, ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"draft application {name} discarded by {user}")
	return {"discarded": name}


def apply_loan(
	user: str,
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
):
	"""Save and submit in one call, for an applicant with evidence already filed.

	Kept because it is the published contract (docs/openapi.yaml, the Postman
	collection), and because a returning applicant whose identity documents are
	already on their profile has nothing left to attach. It is the two steps
	back to back, gate included: it cannot submit what save_application would
	not have saved, or what submit_application would have refused.
	"""
	draft = save_application(
		user,
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
	)
	return submit_application(user, draft["name"])


def my_loans(user: str):
	"""The logged-in citizen's applications, newest first."""
	# Every cluster this citizen is in, not one: a member of two groups must
	# see both heads' applications, and `_is_shared_with` below decides which
	# of the rows fetched are actually theirs to read.
	heads = {
		frappe.db.get_value("GDB Cluster", cluster, "head") for cluster in _clusters_of(user)
	}
	owners = list({user} | {head for head in heads if head})
	rows = frappe.get_all(
		"Loan Application",
		filters={"gdb_owner": ["in", owners], "docstatus": ["<", 2]},
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)
	eids = _eids([r.gdb_owner for r in rows])
	mine = [r for r in rows if r.gdb_owner == user or _is_shared_with(r, user)]
	ctx = _stage_context([r.name for r in mine])
	return [_for_viewer(_portal_dict(r, eids, ctx), user) for r in mine]


def loan_detail(user: str, name: str):
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	# Staff of either kind may read a case; only their own endpoints let them
	# act on it. A draft, though, is nobody's but the applicant's — see
	# all_loans.
	if row.gdb_owner != user and not (_is_staff(user) and cint(row.docstatus) == 1):
		if not _is_shared_with(row, user):
			frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
	return _for_viewer(_portal_dict(row), user)


def _readable_application(name: str, user: str):
	"""The application row, if this user is allowed to see it."""
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	if row.gdb_owner != user and not _is_staff(user) and not _is_shared_with(row, user):
		frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
	return row


def _repayment_history(loan: str) -> list[dict]:
	"""Every payment received against this facility, newest first.

	`gdb_paid_by` has been stamped on each portal repayment since the endpoint
	was written, and until now nothing ever read it back. On a CLUSTER facility
	that omission mattered: one loan carries the whole group, several members
	may pay into it, and a single `total_amount_paid` cannot tell any of them —
	or the head answering for it — who has actually paid. The figure was there
	and the contributions behind it were not.

	Submitted repayments only (docstatus 1). A cancelled repayment is money
	that did not stay received, and showing it as a payment would overstate
	what the group has put in.

	Nothing here computes money: every figure is lending's own row.
	"""
	rows = frappe.get_all(
		"Loan Repayment",
		filters={"against_loan": loan, "docstatus": 1},
		fields=[
			"name",
			"posting_date",
			"amount_paid",
			"principal_amount_paid",
			"repayment_type",
			"gdb_paid_by",
		],
		order_by="posting_date desc, creation desc",
	)
	names = _eids([r.gdb_paid_by for r in rows if r.gdb_paid_by])
	for row in rows:
		payer = row.pop("gdb_paid_by", None)
		# Who paid, as a person rather than a mailbox — the e-ID is how GDB
		# names anybody else in this bank. A receipt applied from Collections
		# has no portal payer at all, and says so.
		row["paid_by_name"] = frappe.utils.get_fullname(payer) if payer else None
		row["paid_by_eid"] = names.get(payer) if payer else None
	return rows


# A statement line is lending's report row as it stands, less the loan and
# currency columns the portal already carries.
STATEMENT_LINE_FIELDS = (
	"transaction_type",
	"transaction_doctype",
	"transaction_name",
	"debit",
	"credit",
	"balance",
	"remarks",
)


def _statement_of_account(loan, to_date) -> list[dict]:
	"""Lending's Loan Statement of Account for this loan, from its booking to `to_date`.

	The report the ERPNext desk shows for a loan, run through Frappe's own report
	endpoint (frappe.desk.query_report.run), so every line and every running
	balance is lending's. It is run from the day the loan was booked, never from
	the period's start: the report's running balance starts at zero on its first
	line, so only a run from the beginning gives a balance that is what is owed.

	Elevated because the report belongs to Loan Manager, a role no portal user
	holds. Who may read this loan has already been settled by
	_readable_application, and the loan is fixed here, never taken from the
	client: the report's own queries skip row-level permissions, so it must not
	be handed a filter a citizen chose.
	"""
	from frappe.desk.query_report import run

	booked = frappe.db.get_value(
		"Loan", loan.name, ["applicant_type", "applicant", "posting_date"], as_dict=True
	)
	# A period that ends before the loan was booked has nothing on it, and the
	# report refuses a run whose start is after its end.
	if getdate(to_date) < getdate(booked.posting_date):
		return []
	with _as_system():
		report = run(
			"Loan Statement of Account",
			filters={
				"company": loan.company,
				"applicant_type": booked.applicant_type,
				"applicant": booked.applicant,
				"loan": loan.name,
				"from_date": str(getdate(booked.posting_date)),
				"to_date": str(getdate(to_date)),
			},
		)
	return [
		{
			"posting_date": str(getdate(line["posting_date"])),
			**{field: line.get(field) for field in STATEMENT_LINE_FIELDS},
		}
		for line in report["result"]
		if isinstance(line, dict)
	]


def _statement(sched: str | None, schedule: list, loan, from_date, to_date) -> dict:
	"""A period's statement: lending's report cut to it, and what falls due in it.

	What happened is lending's Loan Statement of Account for this loan
	(_statement_of_account): every disbursement and payment with lending's
	running balance. The period only decides where it is cut. The opening
	balance is the report's balance on its last line before the period, and the
	closing balance its balance on the last line inside it. Cutting between
	days, never inside one, keeps both right whatever order lending lists one
	day's lines in.

	What is scheduled is kept apart, because a plan is not a receipt: the
	repayment schedule's rows falling due in the period, and their SUM, which
	Frappe's query builder runs over those same rows.
	"""
	start, end = getdate(from_date), getdate(to_date)
	lines = _statement_of_account(loan, end)
	before = [line for line in lines if getdate(line["posting_date"]) < start]
	transactions = [line for line in lines if getdate(line["posting_date"]) >= start]
	opening = flt(before[-1]["balance"]) if before else 0.0
	rows = [r for r in schedule if start <= getdate(r.payment_date) <= end]
	due = (
		frappe.get_all(
			"Repayment Schedule",
			filters={
				"parent": sched,
				"parenttype": "Loan Repayment Schedule",
				"payment_date": ["between", [start, end]],
			},
			fields=[{"SUM": "total_payment", "as": "instalments_due"}],
		)
		if sched
		else []
	)
	return {
		"from_date": str(start),
		"to_date": str(end),
		"transactions": transactions,
		"opening_balance": opening,
		"closing_balance": flt(transactions[-1]["balance"]) if transactions else opening,
		"rows": rows,
		"instalments_due": flt(due[0].instalments_due) if due else 0.0,
	}


def loan_account(user: str, application: str, from_date=None, to_date=None):
	"""Booked loan, repayment schedule and what is left to pay.

	Returns loan: None while the application is still with the underwriter.
	"""
	row = _readable_application(application, user)

	loan = frappe.db.get_value(
		"Loan", {"loan_application": application}, LOAN_ACCOUNT_FIELDS, as_dict=True
	)
	case = _stage_context([application]).get(application) or {}
	approved_amount, approved_term = case.get("approved_amount"), case.get("approved_term")
	if not loan:
		# Before booking, the terms booking will put into lending: the offer's.
		return {
			"application": application,
			"loan": None,
			"schedule": [],
			"next_due": None,
			"approved_amount": approved_amount,
			"approved_term": approved_term,
		}

	# Whether this facility belongs to a group, said plainly rather than
	# inferred from how many people happen to have paid so far. The first
	# payment into a cluster loan needs attributing just as much as the tenth.
	cluster = row.get("gdb_cluster") or None

	schedule = []
	sched = frappe.db.get_value(
		"Loan Repayment Schedule", {"loan": loan.name, "status": "Active"}, "name"
	)
	if sched:
		schedule = frappe.get_all(
			"Repayment Schedule",
			filters={"parent": sched},
			fields=["payment_date", "principal_amount", "interest_amount", "total_payment", "balance_loan_amount"],
			order_by="idx asc",
		)

	# What is owed is lending's answer, never ours. lending.api.get_due_details
	# is the same computation, but it gates on a Loan role no citizen holds and
	# writes into frappe.response instead of returning — so call the function
	# underneath it and relay lending's own keys unchanged.
	from lending.loan_management.doctype.loan_repayment.loan_repayment import calculate_amounts

	amounts = calculate_amounts(loan.name, nowdate())
	dues = {
		"overdue_penalty_amount": amounts.get("penalty_amount"),
		"overdue_interest_amount": amounts.get("interest_amount"),
		"overdue_principal_amount": amounts.get("payable_principal_amount"),
		"principal_outstanding": amounts.get("pending_principal_amount"),
		"overdue_total_amount": amounts.get("payable_amount"),
		"applicable_future_interest": amounts.get("unaccrued_interest"),
		"unbooked_interest": amounts.get("unbooked_interest"),
		"oldest_due_date": amounts.get("due_date"),
		"overdue_charges": amounts.get("total_charges_payable"),
		"written_off_amount": amounts.get("written_off_amount"),
		"excess_amount_paid": amounts.get("excess_amount_paid"),
	}

	# What is still drawable is lending's answer too, and only the bank is shown
	# it. get_disbursal_amount nets off adjustments, refunds and write-offs,
	# honours a Line of Credit limit and returns 0 while a secured loan is in
	# security shortfall - none of which a loan_amount - disbursed_amount
	# subtraction would catch. Elevated because it gates on a Loan permission
	# portal roles do not hold, and it takes a row lock (for_update), so it is
	# computed only for the underwriter who is about to act on it.
	disbursable = None
	if _is_staff(user):
		from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
			get_disbursal_amount,
		)

		with _as_system():
			# Returns (disbursal_amount, pending_principal_amount) — unpack it;
			# flt() on the raw tuple silently yields 0.0.
			disbursable = flt(get_disbursal_amount(loan.name)[0])

	return {
		"application": application,
		"loan": loan,
		"schedule": schedule,
		"dues": dues,
		"disbursable": disbursable,
		# The instalment lending bills is the current schedule's; the Loan's own
		# monthly_repayment_amount is the figure at booking, which lending never
		# revises when a smaller amount is released or a tranche is added.
		"instalment": _schedule_instalments([loan.name]).get(loan.name)
		or flt(loan.monthly_repayment_amount),
		# The underwriter's decision, and whether lending was booked on it. False
		# only for a Loan booked before book_loan took the offer's terms: its
		# drawable ceiling is the requested amount, and release refuses it.
		"approved_amount": approved_amount,
		"approved_term": approved_term,
		"booked_on_offer": None
		if approved_amount is None
		else (
			flt(loan.loan_amount) == flt(approved_amount)
			and cint(loan.repayment_periods) == cint(approved_term)
		),
		"statement": _statement(sched, schedule, loan, from_date, to_date)
		if from_date and to_date
		else None,
		"cluster": cluster,
		"payments": _repayment_history(loan.name),
	}
