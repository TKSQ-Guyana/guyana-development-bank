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

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, nowdate

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
