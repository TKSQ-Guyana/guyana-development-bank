"""Platform administration: accounts, role grants, and the kill switch.

This is the persona-management service - the thing an operator uses when the
answer to "we're adding a Recovery Officer" arrives. It never invents its own
notion of a role: every grant is a `PersonaSpec` from the registry, applied as
a Frappe Role Profile, so a persona that does not exist in code cannot be
granted by hand through this API.

By policy the Platform Admin decides no credit and moves no money; features.md
notes the residual gap that a System Manager technically still could. This
service closes the part that is ours to close - it grants personas, it does not
grant itself credit capabilities - and records every grant in the audit trail.
"""

from __future__ import annotations

import frappe

from gdb_bank.domain import events as ev
from gdb_bank.rbac import capabilities as cap
from gdb_bank.rbac import personas as reg
from gdb_bank.rbac.guards import require
from gdb_bank.security import errors
from gdb_bank.security.session import Actor, actor_for
from gdb_bank.services import audit


@require(cap.ADMIN_MANAGE_USERS)
def list_users(search: str | None = None, limit: int = 50, actor: Actor = None) -> list[dict]:
	"""Accounts and the personas they hold."""
	filters = {}
	if search:
		filters["full_name"] = ("like", f"%{search}%")

	rows = frappe.get_all(
		"User",
		filters=filters,
		fields=["name", "full_name", "enabled", "user_type", "gdb_eid"],
		order_by="full_name asc",
		limit=min(int(limit), 200),
	)
	for row in rows:
		personas = reg.personas_for_roles(frappe.get_roles(row["name"]))
		row["personas"] = [p.key for p in personas]
		row["row_scope"] = reg.widest_row_scope(frappe.get_roles(row["name"])).value
	return rows


@require(cap.ADMIN_GRANT_ROLES)
def grant_persona(user: str, persona_key: str, reason: str, actor: Actor = None) -> dict:
	"""Give a user a persona, as a Role Profile.

	A reason is mandatory. A role grant is a privilege change on a lending
	system; "who widened this person's access, and why" has to be answerable
	from the trail alone.
	"""
	persona = _persona_or_404(persona_key)
	target = _user_or_404(user)

	if persona.retired:
		errors.throw(
			errors.ValidationFailed,
			"That persona has been retired and can no longer be granted.",
			persona=persona.key,
		)
	if not (reason or "").strip():
		errors.throw(errors.ValidationFailed, "A reason is required for a role change.")

	before = _personas_of(target)
	if persona.key in before:
		return {"user": target, "personas": before, "changed": False}

	doc = frappe.get_doc("User", target)
	if frappe.db.exists("Role Profile", persona.profile_name):
		doc.role_profile_name = persona.profile_name
	else:
		doc.add_roles(persona.role)
	doc.flags.ignore_permissions = True
	doc.save()

	after = _personas_of(target)
	audit.record(
		actor,
		ev.ROLES_CHANGED,
		subject_doctype="User",
		subject_name=target,
		reason=reason.strip(),
		old_value=before,
		new_value=after,
	)
	return {"user": target, "personas": after, "changed": True}


@require(cap.ADMIN_GRANT_ROLES)
def revoke_persona(user: str, persona_key: str, reason: str, actor: Actor = None) -> dict:
	"""Remove a persona from a user."""
	persona = _persona_or_404(persona_key)
	target = _user_or_404(user)

	if not (reason or "").strip():
		errors.throw(errors.ValidationFailed, "A reason is required for a role change.")

	before = _personas_of(target)
	if persona.key not in before:
		return {"user": target, "personas": before, "changed": False}

	doc = frappe.get_doc("User", target)
	doc.remove_roles(persona.role)
	doc.flags.ignore_permissions = True
	doc.save()

	after = _personas_of(target)
	audit.record(
		actor,
		ev.ROLES_CHANGED,
		subject_doctype="User",
		subject_name=target,
		reason=reason.strip(),
		old_value=before,
		new_value=after,
	)
	return {"user": target, "personas": after, "changed": True}


@require(cap.ADMIN_DISABLE_USER)
def set_enabled(user: str, enabled: bool, reason: str, actor: Actor = None) -> dict:
	"""The kill switch.

	features.md: disabling must work "even if their e-ID still authenticates
	elsewhere". Disabling here is therefore independent of Keycloak - Frappe
	refuses the session regardless of what the identity provider says. The
	converse direction (Keycloak disabled -> Frappe disabled) is handled at
	login by `security/keycloak.enforce_kill_switch`.
	"""
	target = _user_or_404(user)
	if not (reason or "").strip():
		errors.throw(errors.ValidationFailed, "A reason is required to enable or disable an account.")

	if target == actor.user:
		errors.throw(errors.ValidationFailed, "You cannot disable your own account.")
	if target == "Administrator":
		errors.throw(errors.ValidationFailed, "The Administrator account cannot be disabled here.")

	was = bool(frappe.db.get_value("User", target, "enabled"))
	now = bool(enabled)
	if was == now:
		return {"user": target, "enabled": now, "changed": False}

	doc = frappe.get_doc("User", target)
	doc.enabled = int(now)
	doc.flags.ignore_permissions = True
	doc.save()

	# Kill the sessions too: leaving them live would mean "disabled" took
	# effect only at the next login, which is not a kill switch.
	if not now:
		frappe.db.delete("Sessions", {"user": target})
		frappe.cache().delete_value(f"user_roles:{target}")

	audit.record(
		actor,
		ev.USER_ENABLED if now else ev.USER_DISABLED,
		subject_doctype="User",
		subject_name=target,
		reason=reason.strip(),
		old_value={"enabled": was},
		new_value={"enabled": now},
	)
	return {"user": target, "enabled": now, "changed": True}


@require(cap.ADMIN_GRANT_ROLES)
def preview(user: str, actor: Actor = None) -> dict:
	"""What a user can actually do right now - the answer to "why can they see
	this?" without reading the code."""
	target = _user_or_404(user)
	subject = actor_for(target)
	return {
		"user": subject.user,
		"eid": subject.eid,
		"personas": list(subject.persona_keys),
		"row_scope": subject.row_scope.value,
		"capabilities": sorted(subject.capabilities),
	}


# ---------------------------------------------------------------------------


def _persona_or_404(persona_key: str):
	persona = reg.BY_KEY.get(persona_key)
	if not persona:
		errors.throw(errors.ResourceNotFound, "No such persona.", persona=persona_key)
	return persona


def _user_or_404(user: str) -> str:
	if not user or not frappe.db.exists("User", user):
		errors.throw(errors.ResourceNotFound, "No such user.")
	return user


def _personas_of(user: str) -> list[str]:
	return [p.key for p in reg.personas_for_roles(frappe.get_roles(user))]
