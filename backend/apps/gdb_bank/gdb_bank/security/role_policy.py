"""What a platform administrator may do to an account — one policy, asked twice.

services/accounts.py asks it before changing anything, so the admin gets a
plain refusal up front. The User `validate` hook (hooks.py doc_events) asks it
again on every save, so no other path — the desk, /api/resource/User,
frappe.client.save — reaches past it.

WHY THE LINES ARE WHERE THEY ARE. The admin persona must not be able to decide
credit or move money. An admin who could grant themselves Disbursement Officer,
mint another administrator, or set the disbursement officer's password could do
both by proxy. So: only the three portal roles are grantable, never to your own
account, never on an account holding administrator rights, and no Frappe
password is ever set here — every password lives in Keycloak. The one password
an administrator ever sees is a ONE-TIME Keycloak password (services/accounts.py):
it opens nothing but the screen where its owner replaces it, and that
replacement is recorded in the access trail as the owner's own act.

The hook binds a Platform Admin acting WITHOUT System Manager. Install and
migrate (Administrator), e-ID provisioning (Guest) and the break-glass
superuser pass through untouched — the superuser is the known gap features.md
records, and closing it is a separate decision.
"""

import frappe
from frappe import _

from gdb_bank.utils.constants import PLATFORM_ADMIN_ROLE

# The only roles the portal grants. Each is one side of a control that
# utils/constants.py's authority sets enforce.
GRANTABLE_ROLES = ("Loan Underwriter", "Disbursement Officer", "Finance Officer", "Facilitator")

# Held alone or not at all. A facilitator prepares a group's case; an account
# that could also decide or pay it would be its own checker.
EXCLUSIVE_ROLES = ("Facilitator",)

# An account holding any of these is out of an administrator's reach: the
# superuser, and other administrators — minting or removing an administrator is
# a System Manager act.
PROTECTED_ROLES = frozenset({"System Manager", "Administrator", PLATFORM_ADMIN_ROLE})

STANDARD_USERS = ("Administrator", "Guest")

# Frappe's implicit roles. They are never a decision anybody made, so they never
# count as a grant or a revocation.
_AUTOMATIC_ROLES = frozenset({"All", "Guest", "Desk User"})

# The User fields whose change is an access decision. Anything else on the
# record (last_active, theme, ...) is not this policy's business.
_ACCESS_FIELDS = ("enabled", "user_type", "email")


def binds(actor: str) -> bool:
	"""Whether this policy constrains `actor` at all."""
	if actor in STANDARD_USERS:
		return False
	roles = set(frappe.get_roles(actor))
	return PLATFORM_ADMIN_ROLE in roles and "System Manager" not in roles


def refusal_to_manage(actor: str, target: str, target_roles=None) -> str | None:
	"""Why `actor` may not change `target` at all, or None when they may."""
	if target in STANDARD_USERS:
		return _("{0} is a system account and cannot be managed here.").format(target)
	if target == actor:
		return _("You cannot change your own account. Ask another administrator.")
	roles = set(target_roles) if target_roles is not None else set(frappe.get_roles(target))
	if roles & PROTECTED_ROLES:
		return _("This account holds administrator rights. Only a System Manager can change it.")
	return None


def refusal_to_grant(roles) -> str | None:
	"""Why these roles may not be granted or revoked here, or None."""
	outside = sorted(set(roles) - set(GRANTABLE_ROLES) - _AUTOMATIC_ROLES)
	if outside:
		return _("Only {0} can be granted here, not {1}.").format(
			", ".join(GRANTABLE_ROLES), ", ".join(outside)
		)
	return None


def refusal_to_combine(roles) -> str | None:
	"""Why this full set of roles may not be held together, or None."""
	held = set(roles) & set(GRANTABLE_ROLES)
	for role in EXCLUSIVE_ROLES:
		if role in held and len(held) > 1:
			return _("{0} cannot be combined with another role.").format(role)
	return None


def _role_set(rows) -> set:
	return {r.role for r in rows or []} - _AUTOMATIC_ROLES


def validate_user_change(doc, method=None):
	"""User.validate — the backstop behind services/accounts.py."""
	actor = frappe.session.user
	if not binds(actor):
		return

	before = None if doc.is_new() else doc.get_doc_before_save()
	if doc.is_new():
		before_roles = set()
	elif before is not None:
		before_roles = _role_set(before.roles)
	else:
		before_roles = set(frappe.get_roles(doc.name)) - _AUTOMATIC_ROLES
	after_roles = _role_set(doc.roles)

	roles_changed = before_roles ^ after_roles
	fields_changed = before is not None and any(
		doc.get(field) != before.get(field) for field in _ACCESS_FIELDS
	)
	password_set = bool(doc.get("new_password"))
	if not (doc.is_new() or roles_changed or fields_changed or password_set):
		return

	refusal = (
		(None if doc.is_new() else refusal_to_manage(actor, doc.name, before_roles))
		or refusal_to_grant(roles_changed)
		or refusal_to_combine(after_roles)
		or (
			_("An administrator never sets a password. Passwords are managed in Keycloak.")
			if password_set
			else None
		)
	)
	if refusal:
		frappe.throw(refusal, frappe.PermissionError)
