"""Platform administration — the portal surface for the Platform Admin persona.

Endpoints: POST /api/method/gdb_bank.platform_admin.<name>

Accounts and roles, the kill switch, the access trail, system health and the
integration settings. Every endpoint is behind _require_platform_admin, and
this role is in none of the credit or money authority sets, so the reverse
holds as well: every underwriting, booking, disbursement and finance endpoint
refuses a platform administrator.

A thin controller, like rules.py: it checks who is calling and hands over.
The rules live in services/accounts.py, services/integration_settings.py,
services/system_health.py and security/role_policy.py. State-changing calls
take POST only and every one of them requires a reason, which the access
trail keeps.
"""

import frappe

from gdb_bank.services import (
	access_audit as audit_service,
	accounts as accounts_service,
	integration_settings as settings_service,
	system_health as health_service,
)
from gdb_bank.utils.session import _require_platform_admin

# -- accounts -----------------------------------------------------------------


@frappe.whitelist()
def list_users(kind: str = accounts_service.STAFF, search: str | None = None, start=0, page_length=50):
	return accounts_service.list_users(_require_platform_admin(), kind, search, start, page_length)


@frappe.whitelist()
def get_user(user: str):
	return accounts_service.get_user(_require_platform_admin(), user)


@frappe.whitelist(methods=["POST"])
def create_staff_user(full_name: str, email: str, roles, reason: str, eid: str | None = None):
	return accounts_service.create_staff_user(
		_require_platform_admin(), full_name, email, roles, reason, eid=eid
	)


@frappe.whitelist(methods=["POST"])
def set_user_roles(user: str, roles, reason: str):
	return accounts_service.set_user_roles(_require_platform_admin(), user, roles, reason)


@frappe.whitelist(methods=["POST"])
def set_user_enabled(user: str, enabled, reason: str):
	"""The kill switch. Disabling ends the account's open sessions too."""
	return accounts_service.set_user_enabled(_require_platform_admin(), user, enabled, reason)


@frappe.whitelist(methods=["POST"])
def reset_password(user: str, reason: str):
	"""Issue a staff member a new ONE-TIME password, returned in this response
	only. It works for one sign-in, at which they must choose their own, so the
	administrator never knows the password the person actually uses."""
	return accounts_service.reset_password(_require_platform_admin(), user, reason)


@frappe.whitelist()
def access_history(user: str | None = None, start=0, page_length=50):
	_require_platform_admin()
	return audit_service.history(user, start, page_length)


# -- the platform ---------------------------------------------------------------


@frappe.whitelist()
def system_health():
	_require_platform_admin()
	return health_service.report()


@frappe.whitelist()
def integration_settings():
	_require_platform_admin()
	return settings_service.read()


@frappe.whitelist(methods=["POST"])
def save_integration_settings(group: str, values, reason: str):
	return settings_service.save(_require_platform_admin(), group, values, reason)


@frappe.whitelist(methods=["POST"])
def test_integration(group: str, values=None):
	_require_platform_admin()
	return settings_service.test(group, values)
