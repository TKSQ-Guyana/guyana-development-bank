"""Whitelisted REST endpoints for the GDB citizen portal.

All endpoints are called as POST /api/method/gdb_bank.api.<name> with a JSON
body. Authentication is the standard Frappe session cookie obtained from
POST /api/method/login.

Storage is the official frappe/lending app's **Loan Application** doctype;
this module maps the stable portal contract (loan_amount, purpose,
term_months, monthly_income, phone, status Submitted/Approved/Rejected) onto
it. Portal-only facts live in gdb_* custom fields (see install.CUSTOM_FIELDS).
"""

import logging
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money, now_datetime, nowdate

from gdb_bank.install import LOAN_PRODUCT_NAME

UNDERWRITER_ROLES = {"Loan Underwriter", "System Manager"}

# lending status <-> portal status (lending has no draft/review distinction:
# a fresh application is a submitted doc with status Open)
STATUS_TO_PORTAL = {"Open": "Submitted", "Approved": "Approved", "Rejected": "Rejected"}
STATUS_FROM_PORTAL = {v: k for k, v in STATUS_TO_PORTAL.items()}

LOAN_FIELDS = [
	"name",
	"gdb_owner",
	"gdb_cluster",
	"applicant_name",
	"loan_amount",
	"gdb_purpose",
	"repayment_periods",
	"gdb_monthly_income",
	"applicant_phone_number",
	"status",
	"gdb_remarks",
	"gdb_reviewed_by",
	"gdb_reviewed_on",
	"rate_of_interest",
	"repayment_amount",
	"creation",
	"modified",
]


def _logger() -> logging.Logger:
	"""Frappe-native logging: rotating logs/gdb_bank.log at bench and site
	level. Fetched lazily (frappe.logger caches per request-site) and pinned to
	INFO — frappe's process default is ERROR and site config has no say."""
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger


def _session_user() -> str:
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("Please log in."), frappe.AuthenticationError)
	return user


def _is_underwriter(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & UNDERWRITER_ROLES)


def _require_underwriter() -> str:
	user = _session_user()
	if not _is_underwriter(user):
		_logger().warning(f"denied underwriter endpoint to {user}")
		frappe.throw(_("Only GDB underwriters may do this."), frappe.PermissionError)
	return user


@contextmanager
def _as_system():
	"""Run a bank-side write as Administrator, handing the session back intact.

	Elevation is unavoidable for these writes: lending creates Loan Demand and
	repayment-schedule rows of its own downstream, so ignore_permissions on the
	outer doc would not reach them, and frappe.has_permission only
	short-circuits for Administrator.

	The catch is that frappe.set_user() overwrites local.session.sid with the
	username it is given (frappe/__init__.py), so set_user -> work ->
	set_user(caller) leaves the caller holding a sid that no longer resolves:
	their very next request is Guest and 403s. Capture the real sid and session
	data, and put them back.
	"""
	caller = frappe.session.user
	sid = frappe.session.sid
	data = frappe.session.data
	frappe.set_user("Administrator")
	try:
		yield caller
	finally:
		frappe.set_user(caller)
		frappe.local.session.sid = sid
		frappe.local.session.data = data


def _portal_dict(row) -> dict:
	"""Normalize a lending Loan Application row to the stable portal shape."""
	get = row.get if isinstance(row, dict) else lambda f: row.get(f)
	return {
		"name": get("name"),
		"applicant": get("gdb_owner"),
		"cluster": get("gdb_cluster"),
		"applicant_name": get("applicant_name"),
		"loan_amount": get("loan_amount"),
		"purpose": get("gdb_purpose"),
		"term_months": get("repayment_periods"),
		"monthly_income": get("gdb_monthly_income"),
		"phone": get("applicant_phone_number"),
		"status": STATUS_TO_PORTAL.get(get("status"), get("status")),
		"underwriter_remarks": get("gdb_remarks"),
		"reviewed_by": get("gdb_reviewed_by"),
		"reviewed_on": get("gdb_reviewed_on"),
		"rate_of_interest": get("rate_of_interest"),
		"monthly_repayment": get("repayment_amount"),
		"creation": get("creation"),
		"modified": get("modified"),
	}


def _get_or_create_customer(user: str) -> str:
	"""One lending Customer per portal user, linked via the gdb_user field."""
	customer = frappe.db.get_value("Customer", {"gdb_user": user})
	if customer:
		return customer

	full_name = frappe.utils.get_fullname(user)
	doc = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": full_name,
			"customer_type": "Individual",
			"customer_group": frappe.db.get_value("Customer Group", "Individual")
			or frappe.db.get_value("Customer Group", "All Customer Groups"),
			"territory": frappe.db.get_value("Territory", "All Territories"),
			"gdb_user": user,
		}
	).insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist(allow_guest=True)
def signup(full_name: str, email: str, password: str):
	"""Citizen self-registration: creates a Website User with the Citizen role."""
	from frappe.utils import validate_email_address

	full_name = (full_name or "").strip()
	email = (email or "").strip().lower()
	if not full_name:
		frappe.throw(_("Full name is required."))
	validate_email_address(email, throw=True)
	if frappe.db.exists("User", email):
		frappe.throw(_("An account with this email already exists. Please log in."))

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": full_name,
			"user_type": "Website User",
			"send_welcome_email": 0,
			"enabled": 1,
		}
	).insert(ignore_permissions=True)
	user.add_roles("Citizen")

	from frappe.utils.password import update_password

	update_password(user.name, password)
	frappe.db.commit()
	_logger().info(f"citizen signup: {user.name}")
	return {"user": user.name, "full_name": user.full_name}


@frappe.whitelist()
def whoami():
	user = _session_user()
	return {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		"roles": frappe.get_roles(user),
		"is_underwriter": _is_underwriter(user),
	}


@frappe.whitelist()
def apply_loan(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
):
	"""Create a lending Loan Application for the logged-in citizen."""
	user = _session_user()

	loan_amount = flt(loan_amount)
	term_months = cint(term_months)
	purpose = (purpose or "").strip()
	if loan_amount <= 0:
		frappe.throw(_("Loan amount must be greater than zero."))
	if not (1 <= term_months <= 360):
		frappe.throw(_("Term must be between 1 and 360 months."))
	if not purpose:
		frappe.throw(_("Purpose is required."))

	product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	if not product:
		frappe.throw(_("Loan Product is not configured. Contact the administrator."))

	doc = frappe.get_doc(
		{
			"doctype": "Loan Application",
			"applicant_type": "Customer",
			"applicant": _get_or_create_customer(user),
			"applicant_name": frappe.utils.get_fullname(user),
			"applicant_email_address": user,
			"applicant_phone_number": (phone or "").strip(),
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
			"gdb_cluster": cluster or _cluster_of(user),
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()
	frappe.db.commit()
	_logger().info(f"loan application {doc.name} submitted by {user} for {loan_amount}")
	return _portal_dict(frappe.db.get_value("Loan Application", doc.name, LOAN_FIELDS, as_dict=True))


def _is_shared_with(row, user: str) -> bool:
	"""True when this is the head's application for a cluster the user is on.

	The head applies for the whole cluster, so that one case is the group's —
	every member may open it. A member's own application stays their own.
	"""
	cluster = row.get("gdb_cluster")
	if not cluster or _cluster_of(user) != cluster:
		return False
	return frappe.db.get_value("GDB Cluster", cluster, "head") == row.get("gdb_owner")


@frappe.whitelist()
def my_loans():
	"""The logged-in citizen's applications, newest first."""
	user = _session_user()
	cluster = _cluster_of(user)
	head = frappe.db.get_value("GDB Cluster", cluster, "head") if cluster else None
	owners = [user, head] if head and head != user else [user]
	rows = frappe.get_all(
		"Loan Application",
		filters={"gdb_owner": ["in", owners]},
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)
	return [_portal_dict(r) for r in rows if r.gdb_owner == user or _is_shared_with(r, user)]


@frappe.whitelist()
def loan_detail(name: str):
	user = _session_user()
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	if row.gdb_owner != user and not _is_underwriter(user):
		if not _is_shared_with(row, user):
			frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
	return _portal_dict(row)


@frappe.whitelist()
def all_loans(status: str | None = None):
	"""Underwriter queue: every citizen application, optionally by status."""
	_require_underwriter()
	filters = {}
	if status:
		filters["status"] = STATUS_FROM_PORTAL.get(status, status)
	rows = frappe.get_all(
		"Loan Application",
		filters=filters,
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)
	return [_portal_dict(r) for r in rows]


@frappe.whitelist()
def review_loan(name: str, action: str, remarks: str | None = None):
	"""Underwriter decision on an application: approve | reject."""
	user = _require_underwriter()
	doc = frappe.get_doc("Loan Application", name)

	# SEGREGATION OF DUTIES. Holding the underwriter role says you may decide
	# OTHER people's applications, never your own — an underwriter is also a
	# citizen who may borrow, and one account can legitimately hold both
	# capacities (more so now that a government persona can sign in from the
	# staff realm and hold `Citizen` alongside their staff role). Without this
	# the same person could file and approve in two calls.
	if doc.gdb_owner == user:
		frappe.throw(
			_("You cannot review your own application. Ask another underwriter."),
			frappe.PermissionError,
		)

	new_status = {"approve": "Approved", "reject": "Rejected"}.get(action)
	if not new_status:
		frappe.throw(_("Unknown action: {0}").format(action))
	if doc.status != "Open":
		frappe.throw(_("Cannot {0} an application in status {1}.").format(action, doc.status))

	# db_set: the doc is submitted (docstatus 1); status is permlevel-guarded
	# and the review fields are allow_on_submit.
	doc.db_set("status", new_status)
	if remarks:
		doc.db_set("gdb_remarks", remarks.strip())
	doc.db_set("gdb_reviewed_by", user)
	doc.db_set("gdb_reviewed_on", now_datetime())
	frappe.db.commit()
	_logger().info(f"loan {doc.name}: {action} by {user} -> {new_status}")
	return _portal_dict(frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True))


# --------------------------------------------------------------------------
# Clusters (capability C4)
#
# A cluster groups applicants who share a project and a plan. It never
# borrows: every member holds their own Loan Application, decision and Loan.
# --------------------------------------------------------------------------


@frappe.whitelist()
def convert_lead(lead: str, cluster: str | None = None, purpose: str | None = None):
	"""Turn a submitted Loan Lead into a Loan Application.

	lending ships convert_to_loan_application but types its argument as a
	Document, so frappe's typing validation rejects any REST payload, and
	loan_lead.js adds no button — from a portal the function is unreachable.
	This wrapper hands it the real doc (it prefills the applicant fields and
	resolves Customer + company), then adds the facts only GDB knows.
	"""
	user = _require_underwriter()
	lead_doc = frappe.get_doc("Loan Lead", lead)
	if lead_doc.docstatus != 1:
		frappe.throw(_("Submit lead {0} before converting it.").format(lead))

	from lending.loan_origination.doctype.loan_lead.loan_lead import convert_to_loan_application

	# the converter returns nothing, so diff the table to find what it made
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
	return _portal_dict(frappe.db.get_value("Loan Application", doc.name, LOAN_FIELDS, as_dict=True))
def _cluster_of(user: str) -> str | None:
	"""The cluster this user is on the roster of, if any."""
	return frappe.db.get_value("GDB Cluster Member", {"member": user}, "parent")


def _require_head(user: str, cluster: str) -> None:
	if frappe.db.get_value("GDB Cluster", cluster, "head") != user:
		frappe.throw(_("Only the cluster head may do this."), frappe.PermissionError)


@frappe.whitelist()
def create_cluster(
	cluster_name: str,
	region: str | None = None,
	sector: str | None = None,
	loan_purpose: str | None = None,
	business_plan: str | None = None,
):
	"""A citizen starts a cluster and becomes its head."""
	user = _session_user()
	cluster_name = (cluster_name or "").strip()
	if not cluster_name:
		frappe.throw(_("Cluster name is required."))
	if frappe.db.exists("GDB Cluster", cluster_name):
		frappe.throw(_("A cluster called {0} already exists.").format(cluster_name))
	joined = _cluster_of(user)
	if joined:
		frappe.throw(_("You already belong to cluster {0}.").format(joined))

	doc = frappe.get_doc(
		{
			"doctype": "GDB Cluster",
			"cluster_name": cluster_name,
			"region": (region or "").strip(),
			"sector": (sector or "").strip(),
			"loan_purpose": (loan_purpose or "").strip(),
			"business_plan": (business_plan or "").strip(),
			"head": user,
			"status": "Active",
			"members": [
				{
					"member": user,
					"member_name": frappe.utils.get_fullname(user),
					"member_status": "Active",
					"is_head": 1,
					"joined_on": nowdate(),
				}
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"cluster {doc.name} created by {user}")
	return my_cluster()


@frappe.whitelist()
def invite_member(email: str, full_name: str, password: str | None = None):
	"""The head adds a member, who gets their own portal login.

	Demo-grade: the password is returned once so the head can pass it on. With
	e-ID this becomes an invitation the member accepts with their own identity.
	"""
	user = _session_user()
	cluster = _cluster_of(user)
	if not cluster:
		frappe.throw(_("You are not in a cluster."))
	_require_head(user, cluster)

	from frappe.utils import validate_email_address
	from frappe.utils.password import update_password

	email = (email or "").strip().lower()
	full_name = (full_name or "").strip()
	validate_email_address(email, throw=True)
	if not full_name:
		frappe.throw(_("Member name is required."))
	if _cluster_of(email):
		frappe.throw(_("{0} already belongs to a cluster.").format(email))

	created = False
	if not frappe.db.exists("User", email):
		member = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": full_name,
				"user_type": "Website User",
				"send_welcome_email": 0,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)
		member.add_roles("Citizen")
		created = True
		password = password or f"Gdb-{frappe.generate_hash(length=8)}"
		update_password(email, password)

	doc = frappe.get_doc("GDB Cluster", cluster)
	doc.append(
		"members",
		{
			"member": email,
			"member_name": full_name,
			"member_status": "Active",
			"invited_on": nowdate(),
			"joined_on": nowdate(),
		},
	)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"{user} added {email} to cluster {cluster}")
	return {"email": email, "full_name": full_name, "password": password if created else None}


@frappe.whitelist()
def save_plan(loan_purpose: str | None = None, business_plan: str | None = None):
	"""The head edits the shared purpose and business plan."""
	user = _session_user()
	cluster = _cluster_of(user)
	if not cluster:
		frappe.throw(_("You are not in a cluster."))
	_require_head(user, cluster)

	doc = frappe.get_doc("GDB Cluster", cluster)
	if loan_purpose is not None:
		doc.loan_purpose = loan_purpose.strip()
	if business_plan is not None:
		doc.business_plan = business_plan.strip()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return my_cluster()


@frappe.whitelist()
def my_cluster():
	"""The caller's cluster, or None. Safe to call for every logged-in user."""
	user = _session_user()
	cluster = _cluster_of(user)
	return cluster_view(cluster) if cluster else None


@frappe.whitelist()
def cluster_view(cluster: str):
	"""Plan, roster and the applications raised under a cluster.

	The head applies on behalf of the cluster, so that application is shared:
	every member sees it in full. An application a member raises on their own
	stays theirs — others see only that it exists and how far it has moved.
	"""
	user = _session_user()
	doc = frappe.get_doc("GDB Cluster", cluster)
	roster = [m.as_dict() for m in doc.get("members") or []]
	members = {m.get("member") for m in roster if m.get("member")}
	if not (_is_underwriter(user) or user in members):
		frappe.throw(_("You are not a member of this cluster."), frappe.PermissionError)

	cases = []
	for row in frappe.get_all(
		"Loan Application",
		filters={"gdb_cluster": cluster},
		fields=LOAN_FIELDS,
		order_by="creation asc",
	):
		shared = row.gdb_owner == doc.head
		if shared or row.gdb_owner == user or _is_underwriter(user):
			cases.append(dict(_portal_dict(row), shared=shared, private=False))
		else:
			cases.append(
				{
					"name": row.name,
					"applicant_name": row.applicant_name,
					"status": STATUS_TO_PORTAL.get(row.status, row.status),
					"shared": False,
					"private": True,
				}
			)

	return {
		"name": doc.name,
		"region": doc.region,
		"sector": doc.sector,
		"loan_purpose": doc.loan_purpose,
		"business_plan": doc.business_plan,
		"head": doc.head,
		"is_head": doc.head == user,
		"viewer": user,
		"members": [
			{
				"member": m.get("member"),
				"member_name": m.get("member_name"),
				"member_status": m.get("member_status"),
				"is_head": bool(m.get("is_head")),
				"is_you": m.get("member") == user,
			}
			for m in roster
		],
		"applications": cases,
	}


# --------------------------------------------------------------------------
# The loan account a borrower sees once the application is booked
# --------------------------------------------------------------------------


LOAN_ACCOUNT_FIELDS = [
	"name",
	"status",
	"loan_amount",
	"disbursed_amount",
	"total_payment",
	"total_amount_paid",
	"total_principal_paid",
	"monthly_repayment_amount",
	"rate_of_interest",
	"repayment_periods",
	"company",
]


def _readable_application(name: str, user: str):
	"""The application row, if this user is allowed to see it."""
	row = frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(name))
	if row.gdb_owner != user and not _is_underwriter(user) and not _is_shared_with(row, user):
		frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
	return row


@frappe.whitelist()
def loan_account(application: str):
	"""Booked loan, repayment schedule and what is left to pay.

	Returns loan: None while the application is still with the underwriter.
	"""
	user = _session_user()
	_readable_application(application, user)

	loan = frappe.db.get_value(
		"Loan", {"loan_application": application}, LOAN_ACCOUNT_FIELDS, as_dict=True
	)
	if not loan:
		return {"application": application, "loan": None, "schedule": [], "next_due": None}

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
	if _is_underwriter(user):
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
	}


@frappe.whitelist()
def make_repayment(application: str, amount):
	"""Record a repayment against the loan booked from this application.

	Any member of the cluster may pay the group's facility — the ledger records
	who made the payment, not only whose facility it is.
	"""
	user = _session_user()
	_readable_application(application, user)

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Enter an amount greater than zero."))

	loan = frappe.db.get_value(
		"Loan", {"loan_application": application}, ["name", "company", "status"], as_dict=True
	)
	if not loan:
		frappe.throw(_("No loan has been booked for {0} yet.").format(application))
	if loan.status not in ("Disbursed", "Partially Disbursed", "Active"):
		frappe.throw(_("Loan {0} is not open for repayment (status {1}).").format(loan.name, loan.status))

	# Which of lending's twenty repayment types this is depends on what is
	# currently due, and lending is the one that knows. A Normal Repayment is
	# capped at the amount demanded so far (validate_normal_repayment on the
	# product), so paying ahead of the schedule has to go in as an Advance
	# Payment or lending rejects it. Nothing here computes money: the due
	# figures and the ceiling are all lending's own numbers.
	from lending.loan_management.doctype.loan_repayment.loan_repayment import calculate_amounts

	amounts = calculate_amounts(loan.name, nowdate(), "Normal Repayment") or {}
	due_now = flt(amounts.get("payable_amount"))
	outstanding = (
		flt(amounts.get("pending_principal_amount"))
		+ flt(amounts.get("interest_amount"))
		+ flt(amounts.get("penalty_amount"))
	)

	if amount > outstanding > 0:
		frappe.throw(
			_("Amount exceeds the {0} outstanding on this loan.").format(fmt_money(outstanding))
		)

	repayment_type = "Normal Repayment" if due_now and amount <= due_now else "Advance Payment"

	# Posting a repayment is a bank operation: lending's path writes Loan Demand
	# and the repayment schedule, which no citizen may touch. This endpoint has
	# already established who is allowed to pay this loan, so the ledger write
	# runs as the system and the record keeps the name of whoever asked.
	with _as_system() as caller:
		doc = frappe.get_doc(
			{
				"doctype": "Loan Repayment",
				"against_loan": loan.name,
				"company": loan.company,
				"posting_date": nowdate(),
				"repayment_type": repayment_type,
				"amount_paid": amount,
				"gdb_paid_by": caller,
			}
		)
		doc.insert()
		doc.submit()
		frappe.db.commit()

	_logger().info(f"repayment {doc.name}: {amount} ({repayment_type}) on {loan.name} by {user}")
	return loan_account(application)


# --------------------------------------------------------------------------
# Booking and disbursement — the bank's side of an approved application
#
# Both steps are lending's own. `create_loan` is lending's mapper from a
# submitted Loan Application onto a Loan; disbursement is lending's Loan
# Disbursement doctype, whose submit is what generates the repayment schedule.
# Nothing here computes money: the schedule, the interest and the balances are
# lending's answer, exactly as they are in loan_account. What this module adds
# is who may ask, and when.
# --------------------------------------------------------------------------


BOOKED_LOAN_FIELDS = [
	"name",
	"status",
	"company",
	"applicant",
	"applicant_type",
	"loan_amount",
	"disbursed_amount",
]


def _booked_loan(application: str):
	"""The Loan booked from this application, if one exists yet."""
	return frappe.db.get_value(
		"Loan", {"loan_application": application}, BOOKED_LOAN_FIELDS, as_dict=True
	)


@frappe.whitelist()
def book_loan(application: str):
	"""Create the Loan for an approved application. Underwriter only.

	Booking is a decision the bank makes after approval, not a consequence of
	it — which is why this is a separate act with its own audit line rather
	than a hook on review_loan.
	"""
	user = _require_underwriter()

	row = frappe.db.get_value(
		"Loan Application", application, ["name", "status", "gdb_owner"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.status != "Approved":
		frappe.throw(
			_("Only an approved application can be booked ({0} is {1}).").format(
				application, STATUS_TO_PORTAL.get(row.status, row.status)
			)
		)

	existing = _booked_loan(application)
	if existing:
		frappe.throw(_("Loan {0} is already booked for {1}.").format(existing.name, application))

	# lending guards its own mapper with has_permission("Loan", "create"), a
	# permission no portal role holds. Who may ask has been settled above, so
	# the write runs as the system — the same shape as make_repayment.
	from lending.loan_management.doctype.loan_application.loan_application import create_loan

	with _as_system():
		loan = create_loan(application, submit=1)
		frappe.db.commit()

	_logger().info(f"loan {loan.name} booked from {application} by {user}")
	return loan_account(application)


@frappe.whitelist()
def disburse_loan(application: str, amount=None):
	"""Disburse a booked loan. Underwriter only.

	Omit `amount` to disburse everything lending says is still drawable. Both
	the default and the ceiling are lending's: get_disbursal_amount decides what
	is available, validate_disbursal_amount rules on whatever is asked for, so
	neither number is computed here.
	"""
	user = _require_underwriter()

	loan = _booked_loan(application)
	if not loan:
		frappe.throw(_("No loan has been booked for {0} yet.").format(application))
	if loan.status not in ("Sanctioned", "Partially Disbursed"):
		frappe.throw(
			_("Loan {0} is not awaiting disbursement (status {1}).").format(loan.name, loan.status)
		)

	from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
		get_disbursal_amount,
	)

	with _as_system() as caller:
		amount = flt(amount) if amount else flt(get_disbursal_amount(loan.name)[0])
		if amount <= 0:
			frappe.throw(
				_("Nothing is available to disburse on {0} right now.").format(loan.name)
			)
		doc = frappe.get_doc(
			{
				"doctype": "Loan Disbursement",
				"against_loan": loan.name,
				"company": loan.company,
				"applicant_type": loan.applicant_type,
				"applicant": loan.applicant,
				"posting_date": nowdate(),
				"disbursement_date": nowdate(),
				"disbursed_amount": amount,
				"gdb_disbursed_by": caller,
			}
		)
		doc.insert()
		doc.submit()
		frappe.db.commit()

	_logger().info(f"disbursement {doc.name}: {amount} on {loan.name} by {user}")
	return loan_account(application)


# --------------------------------------------------------------------------
# Where the money goes — the citizen's own bank account
#
# GDB pays out through the commercial banks citizens already hold accounts
# with, so a disbursement needs a destination and the applicant is the only
# one who knows it. This is ERPNext's stock Bank Account doctype, linked to
# the citizen's Customer by party — the same record ERPNext's Payment Order
# reads when a payment run is assembled. No doctype of our own, and nothing
# here formats a payment file: this only captures the destination.
#
# Citizens hold no permission on Bank or Bank Account (deliberately — the
# generic REST surface would expose every other citizen's account), so the
# portal brokers both the list of banks and the write.
# --------------------------------------------------------------------------

BANK_ACCOUNT_FIELDS = ["name", "bank", "bank_account_no", "branch_code", "account_name"]


@frappe.whitelist()
def bank_options():
	"""Banks a citizen may nominate. Names only — nothing else is theirs to see."""
	_session_user()
	return frappe.get_all("Bank", fields=["name"], order_by="name asc", pluck="name")


@frappe.whitelist()
def my_bank_details():
	"""The nominated account for the logged-in citizen, or None."""
	user = _session_user()
	customer = frappe.db.get_value("Customer", {"gdb_user": user})
	if not customer:
		return None
	row = frappe.db.get_value(
		"Bank Account", {"party_type": "Customer", "party": customer}, BANK_ACCOUNT_FIELDS, as_dict=True
	)
	return row or None


@frappe.whitelist()
def save_bank_details(bank: str, bank_account_no: str, branch_code: str | None = None):
	"""Record (or update) where this citizen should be paid.

	One account per citizen: a second call replaces the first rather than
	adding another, so a payment run can never find two destinations for the
	same person and have to guess.
	"""
	user = _session_user()
	bank = (bank or "").strip()
	bank_account_no = (bank_account_no or "").strip()
	branch_code = (branch_code or "").strip()

	if not bank or not frappe.db.exists("Bank", bank):
		frappe.throw(_("Choose a bank from the list."))
	if not bank_account_no:
		frappe.throw(_("Account number is required."))
	if not bank_account_no.isdigit():
		frappe.throw(_("Account number should contain digits only."))

	customer = _get_or_create_customer(user)
	full_name = frappe.utils.get_fullname(user)

	# Writing a Bank Account is a bank-side operation; the citizen has no
	# permission on the doctype, and this endpoint has already established
	# that they are only ever touching their own.
	with _as_system():
		existing = frappe.db.get_value(
			"Bank Account", {"party_type": "Customer", "party": customer}, "name"
		)
		if existing:
			doc = frappe.get_doc("Bank Account", existing)
			doc.update({"bank": bank, "bank_account_no": bank_account_no, "branch_code": branch_code})
			doc.save()
		else:
			# Named for the person, never "<name> — <bank>": a citizen may switch
			# banks, and ERPNext derives the record id from this at creation and
			# never revisits it. A label naming the old bank next to a field
			# naming the new one is how a payment gets misrouted.
			doc = frappe.get_doc(
				{
					"doctype": "Bank Account",
					"account_name": full_name,
					"bank": bank,
					"party_type": "Customer",
					"party": customer,
					"bank_account_no": bank_account_no,
					"branch_code": branch_code,
					"is_company_account": 0,
				}
			)
			doc.insert()
		frappe.db.commit()

	_logger().info(f"bank details saved for {user}: {bank} ****{bank_account_no[-4:]}")
	return frappe.db.get_value("Bank Account", doc.name, BANK_ACCOUNT_FIELDS, as_dict=True)
