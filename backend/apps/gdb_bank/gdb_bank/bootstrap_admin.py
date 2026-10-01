"""The one account a new stack starts with: its first Platform Admin.

The ONLY account the system seeds (decided 2026-10-01). Everything else — every
underwriter, disbursement officer, facilitator — is created by this person in
Administration, and every citizen opens their own account on first e-ID
sign-in.

Nothing here is hard-coded. The address, name and first password come from the
environment (.env → docker-compose):

    GDB_PLATFORM_ADMIN_EMAIL     the work email it signs in with
    GDB_PLATFORM_ADMIN_NAME      shown in the portal (default below)
    GDB_PLATFORM_ADMIN_PASSWORD  its FIRST password — set TEMPORARY in Keycloak,
                                 so the first sign-in makes the person choose
                                 their own, and nobody keeps knowing this one

Idempotent: an account that already exists is left exactly as it is, so a
restart never resets a password or a role somebody has since changed. With no
email configured it does nothing at all.

Run by start-backend.sh after the site is up:
    bench --site <site> execute gdb_bank.bootstrap_admin.ensure_platform_admin
"""

import os
import time

import frappe

from gdb_bank.integrations import keycloak_admin
from gdb_bank.services import access_audit
from gdb_bank.utils.constants import PLATFORM_ADMIN_ROLE
from gdb_bank.utils.session import _logger

DEFAULT_NAME = "GDB Platform Administrator"
_REASON = "First platform administrator, created at start-up from the deployment's settings."


def _frappe_account(email: str, full_name: str) -> bool:
	"""Create the Frappe account if missing. True when it was created."""
	if frappe.db.exists("User", email):
		return False
	first, _, last = full_name.partition(" ")
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": first or full_name,
			"last_name": last,
			"user_type": "System User",
			"send_welcome_email": 0,
			# Platform Admin only: accounts, roles, health, integrations — and in
			# none of the credit or money authority sets.
			"roles": [{"role": PLATFORM_ADMIN_ROLE}],
		}
	).insert(ignore_permissions=True)
	access_audit.record(
		"Administrator",
		access_audit.ACCOUNT_CREATED,
		reason=_REASON,
		subject=email,
		subject_user=email,
		new=[PLATFORM_ADMIN_ROLE],
	)
	frappe.db.commit()
	return True


def _keycloak_account(email: str, full_name: str, password: str, attempts: int, wait: int) -> str:
	"""Make sure the staff-realm login exists. Keycloak may still be starting
	when the backend is, so it is retried rather than failed."""
	if not keycloak_admin.is_configured():
		return "keycloak admin client not configured — skipped"
	for attempt in range(1, attempts + 1):
		try:
			user_id, created = keycloak_admin.ensure_account(email, full_name)
			if not created:
				return "keycloak account already present — left unchanged"
			if not password:
				return "keycloak account created WITHOUT a password — set GDB_PLATFORM_ADMIN_PASSWORD"
			keycloak_admin.set_password(user_id, password, temporary=True)
			return "keycloak account created with a temporary password"
		except keycloak_admin.KeycloakAdminError as exc:
			if attempt == attempts:
				return f"keycloak not ready after {attempts} attempts: {exc}"
			time.sleep(wait)
	return "keycloak not ready"


def ensure_platform_admin(attempts: int = 36, wait: int = 5) -> dict:
	email = (os.environ.get("GDB_PLATFORM_ADMIN_EMAIL") or "").strip().lower()
	if not email:
		_logger().info("bootstrap admin: GDB_PLATFORM_ADMIN_EMAIL not set — nothing seeded")
		return {"seeded": False}
	full_name = (os.environ.get("GDB_PLATFORM_ADMIN_NAME") or DEFAULT_NAME).strip()
	password = os.environ.get("GDB_PLATFORM_ADMIN_PASSWORD") or ""

	frappe.set_user("Administrator")
	created = _frappe_account(email, full_name)
	keycloak = _keycloak_account(email, full_name, password, int(attempts), int(wait))
	# Never the password — only what happened.
	_logger().info(
		f"bootstrap admin {email}: frappe {'created' if created else 'already present'}; {keycloak}"
	)
	return {"email": email, "frappe_created": created, "keycloak": keycloak}
