"""Which sign-in door each kind of account may use — enforced at on_login.

Keycloak authenticates everybody. The realm that vouched for a sign-in says
what kind of account it may land on:

  citizen realm, e-ID + password         -> citizen accounts only
  citizen realm, TIN + password + code   -> citizen accounts only (tin_auth.py)
  staff realm, work email + password     -> GDB staff and platform admin only
  Frappe's own /api/method/login         -> System Users only — the
                                            Administrator break-glass and the
                                            ERPNext desk until it has Keycloak
                                            SSO — and never a citizen, whose
                                            identity is their e-ID

Why it matters: without the first rule, anybody holding a citizen Keycloak
account whose email matched a staff mailbox would sign in AS that staff member
(identity._resolve_user links by email). Without the third, a Frappe password
would be a second way into a citizen account that skips Keycloak entirely.

gdb_bank.identity marks the vouching realm on frappe.flags immediately before
login_as(). Frappe runs on_login BEFORE it creates the session
(auth.LoginManager.post_login), so a refusal here means no sid is minted.
"""

import frappe
from frappe import _

from gdb_bank.utils.constants import (
	FACILITATOR_ROLES,
	FIELD_OFFICER_ROLES,
	PLATFORM_ADMIN_ROLES,
	MANAGER_ROLES,
	REPRESENTATIVE_ROLES,
	STAFF_ROLES,
)
from gdb_bank.utils.session import _logger

CHANNEL_FLAG = "gdb_sign_in_channel"
EID = "eid"
TIN = "tin"
STAFF = "staff"


def mark(channel: str) -> None:
	"""Record which realm vouched for the sign-in about to happen."""
	frappe.flags[CHANNEL_FLAG] = channel


def is_staff_account(user: str) -> bool:
	if user == "Administrator":
		return True
	return bool(
		set(frappe.get_roles(user))
		& (
			STAFF_ROLES
			| PLATFORM_ADMIN_ROLES
			| FACILITATOR_ROLES
			| FIELD_OFFICER_ROLES
			| REPRESENTATIVE_ROLES
			| MANAGER_ROLES
		)
	)


def refusal(user: str, channel: str | None) -> str | None:
	"""Why `user` may not sign in through `channel`, or None when they may."""
	user_type = frappe.db.get_value("User", user, "user_type")
	if channel == EID:
		if user_type == "System User" or is_staff_account(user):
			return _("This e-ID belongs to a GDB staff account. GDB staff sign in with their work email.")
		return None
	if channel == TIN:
		if user_type == "System User" or is_staff_account(user):
			return _("This TIN belongs to a GDB staff account. GDB staff sign in with their work email.")
		return None
	if channel == STAFF:
		if user_type != "System User" or not is_staff_account(user):
			return _("This account has not been granted access to the GDB staff portal. Please contact GDB.")
		return None
	if user_type == "Website User":
		return _("Citizens sign in with their e-ID or TIN.")
	return None


def enforce(login_manager) -> None:
	"""on_login hook."""
	user = login_manager.user
	channel = frappe.flags.get(CHANNEL_FLAG)
	message = refusal(user, channel)
	if message:
		_logger().warning(f"sign-in refused: {user} via {channel or 'frappe-password'}")
		frappe.throw(message, frappe.AuthenticationError)
