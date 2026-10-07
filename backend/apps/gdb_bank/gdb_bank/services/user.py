"""User-facing account logic: the session summary the SPA reads on load, and
the one-Customer-per-user provisioning that a loan application and a
bank-account nomination both need.

There is no self-registration here. Keycloak authenticates everybody: a
citizen's account is created by their first e-ID sign-in
(identity._resolve_user), and a staff account by the platform administrator
(services/accounts.py). A Frappe-password sign-up would be a way into the
portal that Keycloak never sees.

`whoami` is the business body behind the api.py endpoint of the same name; the
controller supplies the already-extracted session user.
"""

import frappe

from gdb_bank.utils.session import (
	_is_disbursement,
	_is_facilitator,
	_is_field_officer,
	_is_representative,
	_is_manager,
	_is_finance,
	_is_platform_admin,
	_is_underwriter,
)


def whoami(user: str) -> dict:
	"""The session summary the SPA gates its navigation on."""
	return {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		# The e-ID this login is bound to, when they signed in that way. The
		# portal shows it back so an applicant can see which identity the
		# application will be filed under before they submit it.
		"eid": frappe.db.get_value("User", user, "gdb_eid"),
		# The TIN, for a citizen who signed up with one (tin_auth.py) — shown in
		# place of the e-ID, and in place of the placeholder email such an
		# account carries when they gave none.
		"tin": frappe.db.get_value("User", user, "gdb_tin"),
		# The National ID an online sign-up opened their account with, and signs
		# in with (tin_auth.py).
		"national_id": frappe.db.get_value("User", user, "gdb_national_id"),
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
		# Accounts, roles, health and integration settings — and no case, no
		# credit decision, no money. See utils/constants.PLATFORM_ADMIN_ROLES.
		"is_platform_admin": _is_platform_admin(user),
		# Forms groups and files their applications; nothing else.
		"is_facilitator": _is_facilitator(user),
		# Assist requests, assisted applications and field tasks; nothing else.
		"is_field_officer": _is_field_officer(user),
		# The appointment queue; nothing else.
		"is_representative": _is_representative(user),
		# The GDB Team Report; nothing else.
		"is_manager": _is_manager(user),
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
