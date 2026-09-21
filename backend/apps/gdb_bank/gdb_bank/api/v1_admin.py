"""Platform administration endpoints.

    POST /api/method/gdb_bank.api.v1_admin.users
    POST /api/method/gdb_bank.api.v1_admin.grant
    POST /api/method/gdb_bank.api.v1_admin.revoke
    POST /api/method/gdb_bank.api.v1_admin.set_enabled
    POST /api/method/gdb_bank.api.v1_admin.preview
    POST /api/method/gdb_bank.api.v1_admin.rbac_status

Thin by design: every one of these delegates straight to `services/admin.py`,
which holds the capability guard, the mandatory-reason rule and the audit
write. No authorization logic lives in this file.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, sbool

from gdb_bank.rbac import provisioning
from gdb_bank.services import admin


@frappe.whitelist()
def users(search: str | None = None, limit: int = 50):
	return admin.list_users(search=search, limit=cint(limit) or 50)


@frappe.whitelist()
def grant(user: str, persona: str, reason: str):
	return admin.grant_persona(user=user, persona_key=persona, reason=reason)


@frappe.whitelist()
def revoke(user: str, persona: str, reason: str):
	return admin.revoke_persona(user=user, persona_key=persona, reason=reason)


@frappe.whitelist()
def set_enabled(user: str, enabled, reason: str):
	return admin.set_enabled(user=user, enabled=sbool(enabled), reason=reason)


@frappe.whitelist()
def preview(user: str):
	return admin.preview(user=user)


@frappe.whitelist()
def rbac_status():
	"""What the registry declares vs what this site actually has.

	The operator's answer to "did my persona change reach production?" - run it
	after a deploy and `drift` should be empty.
	"""
	admin.list_users(limit=1)  # capability gate: same audience as the rest
	return {"declared": provisioning.describe(), "drift": provisioning.drift()}
