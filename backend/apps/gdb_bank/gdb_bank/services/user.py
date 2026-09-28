"""User-facing account logic: citizen self-registration, the session summary
the SPA reads on load, and the one-Customer-per-user provisioning that a loan
application and a bank-account nomination both need.

`signup` and `whoami` are the business bodies behind the api.py endpoints of the
same name; the controller supplies the already-extracted session user.
"""

import frappe
from frappe import _

from gdb_bank.utils.session import (
	_is_disbursement,
	_is_finance,
	_is_underwriter,
	_logger,
)


def signup(full_name: str, email: str, password: str) -> dict:
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


def whoami(user: str) -> dict:
	"""The session summary the SPA gates its navigation on."""
	return {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		# The e-ID this login is bound to, when they signed in that way. The
		# portal shows it back so an applicant can see which identity the
		# application will be filed under before they submit it.
		"eid": frappe.db.get_value("User", user, "gdb_eid"),
		"roles": frappe.get_roles(user),
		"is_underwriter": _is_underwriter(user),
		# Separate capability, separate flag. The SPA gates the money pages on
		# this, and the server gates the endpoints behind them on the same role
		# — neither trusts the other's answer.
		"is_finance": _is_finance(user),
		# Release authority, split out from is_finance: finance manages the
		# books and proposes rules, the disbursement officer pays. See
		# DISBURSEMENT_ROLES and disburse_loan's second, per-case gate.
		"is_disbursement": _is_disbursement(user),
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
