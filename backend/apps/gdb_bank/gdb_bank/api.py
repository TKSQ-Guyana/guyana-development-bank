"""Whitelisted REST endpoints for the GDB citizen portal.

All endpoints are called as POST /api/method/gdb_bank.api.<name> with a JSON
body. Authentication is the standard Frappe session cookie obtained from
POST /api/method/login.
"""

import logging

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

UNDERWRITER_ROLES = {"Loan Underwriter", "System Manager"}


def _logger() -> logging.Logger:
	"""Frappe-native logging: rotating logs/gdb_bank.log at bench and site
	level. Fetched lazily (frappe.logger caches per request-site) and pinned to
	INFO — frappe's process default is ERROR and site config has no say."""
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger

LOAN_FIELDS = [
	"name",
	"applicant",
	"applicant_name",
	"loan_amount",
	"purpose",
	"term_months",
	"monthly_income",
	"phone",
	"status",
	"underwriter_remarks",
	"reviewed_by",
	"reviewed_on",
	"creation",
	"modified",
]


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
):
	"""Create a Loan Application for the logged-in citizen."""
	user = _session_user()
	doc = frappe.get_doc(
		{
			"doctype": "Loan Application",
			"applicant": user,
			"applicant_name": frappe.utils.get_fullname(user),
			"loan_amount": flt(loan_amount),
			"purpose": (purpose or "").strip(),
			"term_months": cint(term_months),
			"monthly_income": flt(monthly_income) if monthly_income else 0,
			"phone": (phone or "").strip(),
			"status": "Submitted",
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"loan application {doc.name} submitted by {user} for {doc.loan_amount}")
	return _loan_dict(doc.name)


@frappe.whitelist()
def my_loans():
	"""The logged-in citizen's applications, newest first."""
	user = _session_user()
	return frappe.get_all(
		"Loan Application",
		filters={"applicant": user},
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)


@frappe.whitelist()
def loan_detail(name: str):
	user = _session_user()
	doc = _loan_dict(name)
	if doc["applicant"] != user and not _is_underwriter(user):
		frappe.throw(_("You may only view your own applications."), frappe.PermissionError)
	return doc


@frappe.whitelist()
def all_loans(status: str | None = None):
	"""Underwriter queue: every citizen application, optionally by status."""
	_require_underwriter()
	filters = {"status": status} if status else {}
	return frappe.get_all(
		"Loan Application",
		filters=filters,
		fields=LOAN_FIELDS,
		order_by="creation desc",
	)


@frappe.whitelist()
def review_loan(name: str, action: str, remarks: str | None = None):
	"""Underwriter action on an application.

	action: start_review | approve | reject
	"""
	user = _require_underwriter()
	doc = frappe.get_doc("Loan Application", name)

	transitions = {
		"start_review": ({"Submitted"}, "Under Review"),
		"approve": ({"Submitted", "Under Review"}, "Approved"),
		"reject": ({"Submitted", "Under Review"}, "Rejected"),
	}
	if action not in transitions:
		frappe.throw(_("Unknown action: {0}").format(action))
	allowed_from, new_status = transitions[action]
	if doc.status not in allowed_from:
		frappe.throw(
			_("Cannot {0} an application in status {1}.").format(action, doc.status)
		)

	doc.status = new_status
	if remarks:
		doc.underwriter_remarks = remarks.strip()
	doc.reviewed_by = user
	doc.reviewed_on = now_datetime()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"loan {doc.name}: {action} by {user} -> {new_status}")
	return _loan_dict(doc.name)


def _loan_dict(name: str) -> dict:
	doc = frappe.get_doc("Loan Application", name)
	return {f: doc.get(f) for f in LOAN_FIELDS}
