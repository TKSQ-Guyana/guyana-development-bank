"""Registry -> Frappe. Convergent, idempotent, run on every `bench migrate`.

CLAUDE.md section 4 is categorical: use Frappe's inbuilt Role Management, do not
reinvent authorization. This module is how the registry honours that. It does
not implement permissions - it *writes* them into Frappe's own Role, Role
Profile and Custom DocPerm records, so Permission Manager, the desk, reports
and `/api/resource` all obey them without knowing this app exists.

WHY CUSTOM DOCPERM AND NOT THE DOCTYPE JSON
    A DocType's own `permissions` array is static. Adding a persona would mean
    hand-editing eight JSON files and getting every row right. Custom DocPerm
    is Frappe's supported overlay (`Meta.set_custom_permissions`) and is what
    Permission Manager itself writes, so generating it from the registry keeps
    "add a persona" to one dataclass.

    The DocType JSONs therefore ship with a single System Manager row - enough
    to administer a fresh site - and everything else is reconciled from here.

CONVERGENCE
    Each run computes the desired set of (doctype, role, permlevel) triples and
    makes the database match: creating what is missing, updating flags that
    drift, and removing rows this app previously created but no longer
    declares. Rows for roles outside the registry are never touched.
"""

from __future__ import annotations

import frappe
from frappe.permissions import (
	add_permission,
	setup_custom_perms,
	update_permission_property,
)

from gdb_bank.rbac import personas as reg
from gdb_bank.rbac.personas import PersonaSpec


def _remove_permission(doctype: str, role: str, permlevel: int) -> bool:
	"""Delete the Custom DocPerm rows for one (doctype, role, permlevel).

	WHY THIS IS HAND-WRITTEN. `frappe.permissions` exports `add_permission` but
	no `remove_permission` - this module imported one anyway, so importing
	`rbac.provisioning` raised ImportError. Every path that reaches it does so
	through `install.py`, which means `after_migrate` never ran: `bench migrate`
	printed the traceback and carried on, and the reconcile that is supposed to
	converge every persona's DocType permissions silently did nothing.

	The revoke half of convergence is the half that matters for security. It is
	what withdraws a permission after a capability is taken away from a persona
	in the registry - so a role that should have lost access kept it, and the
	registry and the database drifted with nothing reporting it.

	Mirrors `add_permission`: touch only Custom DocPerm, then re-validate so
	Frappe rebuilds its permission cache for the doctype.
	"""
	from frappe.core.doctype.doctype.doctype import validate_permissions_for_doctype

	names = frappe.get_all(
		"Custom DocPerm",
		filters={"parent": doctype, "role": role, "permlevel": permlevel},
		pluck="name",
	)
	if not names:
		return False

	for name in names:
		frappe.delete_doc("Custom DocPerm", name, force=True, ignore_permissions=True)

	validate_permissions_for_doctype(doctype)
	frappe.clear_cache(doctype=doctype)
	return True


ROLE_DESCRIPTION_PREFIX = "GDB persona"

_DECLARED_PERM_FLAGS = (
	"read",
	"write",
	"create",
	"delete",
	"submit",
	"cancel",
	"amend",
	"report",
	"select",
	"print",
	"email",
	"export",
	"share",
	"set_user_permissions",
	"if_owner",
)
"""Every permission flag the registry knows how to express.

NOT every one of these exists on every Frappe. `set_user_permissions` was
dropped from `Custom DocPerm` by v16, and reconcile queried it by name -
MySQLdb answered `Unknown column 'set_user_permissions' in 'SELECT'`, which
aborted `after_migrate` and, with the entrypoint exiting on a failed migrate,
restarted the container. Use `_perm_flags()` rather than this tuple directly.
"""


def _perm_flags() -> tuple[str, ...]:
	"""The flags this Frappe's `Custom DocPerm` actually has, in declared order.

	Derived from the DocType's own meta rather than hardcoded, so a Frappe
	upgrade that adds or drops a permission flag cannot break migrate again.
	The intersection is deliberate: reconcile should keep working across
	versions, not assert a schema it does not own.

	The one thing it will NOT do quietly is drop a flag a persona actually
	asked for - see `_assert_flags_storable`.
	"""
	available = {df.fieldname for df in frappe.get_meta("Custom DocPerm").fields}
	return tuple(flag for flag in _DECLARED_PERM_FLAGS if flag in available)


def _assert_flags_storable(flags: tuple[str, ...]) -> None:
	"""Fail if a persona grants a permission this Frappe cannot store.

	Silently skipping an unsupported flag is fine when nobody wants it - which
	is the case for `set_user_permissions`, a privilege no GDB persona is meant
	to hold. It is NOT fine if a persona declares one: the registry would say
	the permission was granted, the database would not have it, and the two
	would disagree with nothing reporting it. Better to stop the migration.
	"""
	unsupported = set(_DECLARED_PERM_FLAGS) - set(flags)
	if not unsupported:
		return

	wanted: list[str] = []
	for persona in reg.ACTIVE_PERSONAS:
		for perm in persona.doctype_permissions:
			fields = perm.as_perm_fields()
			for flag in unsupported:
				if fields.get(flag):
					wanted.append(f"{persona.key}:{perm.doctype}:{flag}")

	if wanted:
		raise frappe.ValidationError(
			"gdb_bank: these personas grant permission flags this Frappe's Custom DocPerm "
			f"does not have: {sorted(wanted)}"
		)


def reconcile(verbose: bool = True) -> dict:
	"""Make Frappe match the registry. Safe to run repeatedly."""
	_assert_registry_invariants()

	report = {
		"roles": _reconcile_roles(verbose),
		"profiles": _reconcile_role_profiles(verbose),
		"permissions": _reconcile_permissions(verbose),
		"legacy": _migrate_legacy_roles(verbose),
	}
	frappe.db.commit()
	frappe.clear_cache()
	if verbose:
		print(f"[gdb_bank.rbac] reconciled: {report}")
	return report


# ---------------------------------------------------------------------------
# Invariants - fail the migration rather than ship a privacy hole
# ---------------------------------------------------------------------------


def _assert_registry_invariants() -> None:
	"""Checks that must hold before anything is written.

	The first is Phase 5's whole guarantee: a persona whose row scope is NONE
	must not hold a permission row on a DocType carrying applicant PII. If
	somebody later adds a convenient `DocPerm(APPLICATION, read=True)` to the
	Board spec "just for the dashboard", the migration fails loudly here
	instead of silently exposing every case.
	"""
	problems: list[str] = []

	for persona in reg.ACTIVE_PERSONAS:
		if persona.row_scope is reg.RowScope.NONE:
			leaks = [
				p.doctype
				for p in persona.doctype_permissions
				if p.doctype in reg.CASE_LEVEL_DOCTYPES
			]
			if leaks:
				problems.append(
					f"persona {persona.key!r} has row_scope NONE but holds permissions on "
					f"case-level doctypes {sorted(leaks)} - this would expose applicant PII"
				)

		for perm in persona.doctype_permissions:
			if perm.doctype in reg.CASE_LEVEL_DOCTYPES and perm.share:
				problems.append(
					f"persona {persona.key!r} may share {perm.doctype!r}; shared documents "
					"bypass permission_query_conditions and defeat e-ID scoping"
				)
			if perm.doctype in reg.CASE_LEVEL_DOCTYPES and perm.export:
				problems.append(
					f"persona {persona.key!r} may export {perm.doctype!r}; case-level export "
					"must go through a audited report endpoint, not the desk"
				)

	keys = [p.key for p in reg.PERSONAS]
	roles = [p.role for p in reg.PERSONAS]
	for label, values in (("key", keys), ("role", roles)):
		duplicates = {v for v in values if values.count(v) > 1}
		if duplicates:
			problems.append(f"duplicate persona {label}(s): {sorted(duplicates)}")

	if problems:
		raise frappe.ValidationError(
			"gdb_bank persona registry is invalid:\n  - " + "\n  - ".join(problems)
		)


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------


def _reconcile_roles(verbose: bool) -> list[str]:
	touched = []
	for persona in reg.PERSONAS:
		desired = {
			"desk_access": int(persona.desk_access),
			"disabled": int(persona.retired),
			"is_custom": 1,
		}

		if not frappe.db.exists("Role", persona.role):
			doc = frappe.get_doc({"doctype": "Role", "role_name": persona.role, **desired})
			doc.flags.ignore_permissions = True
			doc.insert()
			touched.append(f"+{persona.role}")
			if verbose:
				print(f"[gdb_bank.rbac] created Role {persona.role}")
			continue

		doc = frappe.get_doc("Role", persona.role)
		if any(doc.get(field) != value for field, value in desired.items()):
			doc.update(desired)
			doc.flags.ignore_permissions = True
			doc.save()
			touched.append(f"~{persona.role}")
	return touched


# ---------------------------------------------------------------------------
# Role Profiles - the bundle an admin actually assigns to a user
# ---------------------------------------------------------------------------


def _reconcile_role_profiles(verbose: bool) -> list[str]:
	"""Create or converge one Role Profile per persona.

	THE DEADLOCK THIS GUARDS AGAINST - it crash-looped the container 33 times.

	Frappe's `RoleProfile.on_update` ends with

	    self.queue_action("update_all_users",
	                      now=frappe.in_test or frappe.flags.in_install, ...)

	and `queue_action` calls `self.lock()` before enqueuing. During
	`after_migrate` neither flag is set, so `now` is False: saving a Role
	Profile LOCKS it and enqueues a background job to do the real work.

	But the background worker does not exist yet. `start-backend.sh` runs
	`bench migrate` first and only starts gunicorn and the worker once it
	SUCCEEDS. So the job never runs, the lock is never released, and the next
	`bench migrate` hits `check_if_locked()` -> DocumentLockedError -> migrate
	fails -> the entrypoint exits -> the container restarts -> migrate again.
	The site never finishes coming up, and the logs read like a slow migration
	rather than a loop.

	Two things fix it, and both are needed:

	  * `in_install` does NOT stop the lock being taken - `queue_action` locks
	    unconditionally, before it looks at `now`. What it changes is that
	    `enqueue` runs INLINE, and `frappe.model.document.execute_action`
	    begins with `doc.unlock()`. So the lock is taken and released inside
	    the same call, leaving nothing for the next migrate to trip over. It is
	    also the flag Frappe itself uses to mean "we are bootstrapping, there
	    is no worker", which is exactly our situation.
	  * Clearing the lock before saving releases one left behind by a previous
	    run that already died this way. Without it, a site that has hit the bug
	    stays wedged even once the code is fixed.

	    AND IT MUST HAPPEN ON THE INSERT PATH TOO, which is the part that is
	    easy to get wrong. The lock is a FILE, keyed `sha224("<doctype>:<name>")`
	    - see `Document.get_signature` - so it survives on the sites volume
	    while the failed migrate's transaction rolls the database row back. The
	    profile therefore does not exist on the next run, `reconcile` takes the
	    `new_doc` branch, and a lock cleared only on the update branch is never
	    reached. The profile names are deterministic, so the stale file matches
	    the new document exactly.
	"""
	touched = []
	previous_in_install = frappe.flags.in_install

	try:
		frappe.flags.in_install = True

		for persona in reg.ACTIVE_PERSONAS:
			wanted = [persona.role, *_existing(persona.bundled_roles)]
			name = persona.profile_name

			# Before either branch: a lock file from a run that died between
			# `lock()` and the job that would have released it.
			_clear_document_lock("Role Profile", name)

			if frappe.db.exists("Role Profile", name):
				doc = frappe.get_doc("Role Profile", name)
				current = {r.role for r in doc.roles}
				if current == set(wanted):
					continue
				doc.set("roles", [])
			else:
				doc = frappe.new_doc("Role Profile")
				doc.role_profile = name

			for role in wanted:
				doc.append("roles", {"role": role})
			doc.flags.ignore_permissions = True
			doc.save()
			touched.append(name)
			if verbose:
				print(f"[gdb_bank.rbac] Role Profile {name} -> {wanted}")
	finally:
		frappe.flags.in_install = previous_in_install

	return touched


def _clear_document_lock(doctype: str, name: str) -> None:
	"""Release a document lock file, whether or not the document exists.

	Frappe's own `Document.unlock()` needs a loaded document, and the case that
	wedges the site is precisely the one where there is no row to load. So the
	signature is taken from an unsaved document with the name set - the lock is
	keyed on `"<doctype>:<name>"` and nothing else, so that is sufficient and
	keeps Frappe's hashing formula the single definition of it rather than
	copying the `sha224` here to drift later.

	`delete_lock` is a no-op when no lock exists (it swallows OSError), so this
	is safe to call unconditionally.
	"""
	placeholder = frappe.new_doc(doctype)
	placeholder.name = name
	placeholder.unlock()


def _existing(roles) -> list[str]:
	"""Bundled roles come from apps that may not be installed (lending's "Loan
	Manager" on a bare Frappe site). Skip silently rather than fail migrate."""
	return [r for r in roles if frappe.db.exists("Role", r)]


# ---------------------------------------------------------------------------
# DocType permissions
# ---------------------------------------------------------------------------


def _reconcile_permissions(verbose: bool) -> dict:
	flags = _perm_flags()
	_assert_flags_storable(flags)

	desired: dict[tuple[str, str, int], dict] = {}
	for persona in reg.ACTIVE_PERSONAS:
		for perm in persona.doctype_permissions:
			desired[(perm.doctype, persona.role, perm.permlevel)] = perm.as_perm_fields()

	doctypes = {doctype for doctype, _, _ in desired} | reg.CASE_LEVEL_DOCTYPES
	doctypes = {d for d in doctypes if frappe.db.exists("DocType", d)}

	added, updated, removed = [], [], []

	for doctype in sorted(doctypes):
		# Copy the DocType's standard rows into Custom DocPerm once, so that
		# editing ours never mutates the shipped JSON definition.
		setup_custom_perms(doctype)

	for (doctype, role, permlevel), fields in sorted(desired.items()):
		if doctype not in doctypes:
			if verbose:
				print(f"[gdb_bank.rbac] skipped {doctype} for {role} - doctype not installed")
			continue

		existing = frappe.db.get_value(
			"Custom DocPerm",
			{"parent": doctype, "role": role, "permlevel": permlevel},
			"name",
		)
		if not existing:
			add_permission(doctype, role, permlevel)
			added.append(f"{doctype}:{role}:{permlevel}")

		for flag in flags:
			value = fields.get(flag, 0)
			current = frappe.db.get_value(
				"Custom DocPerm",
				{"parent": doctype, "role": role, "permlevel": permlevel},
				flag,
			)
			if int(current or 0) != int(value):
				update_permission_property(doctype, role, permlevel, flag, value, validate=False)
				updated.append(f"{doctype}:{role}:{flag}={value}")

	removed = _revoke_undeclared(desired, doctypes, verbose)
	return {"added": added, "updated": updated, "removed": removed}


def _revoke_undeclared(desired, doctypes, verbose: bool) -> list[str]:
	"""Drop Custom DocPerm rows for GDB roles that the registry no longer
	declares - how `retired=True` and a shrunk permission set actually take
	effect. Rows for non-GDB roles are left completely alone.
	"""
	gdb_roles = {p.role for p in reg.PERSONAS}
	removed = []

	rows = frappe.get_all(
		"Custom DocPerm",
		filters={"role": ("in", list(gdb_roles)), "parent": ("in", list(doctypes))},
		fields=["parent", "role", "permlevel"],
	)
	for row in rows:
		key = (row.parent, row.role, row.permlevel)
		if key in desired:
			continue
		if not _remove_permission(row.parent, row.role, row.permlevel):
			continue
		removed.append(f"{row.parent}:{row.role}:{row.permlevel}")
		if verbose:
			print(f"[gdb_bank.rbac] revoked {row.role} on {row.parent}")
	return removed


# ---------------------------------------------------------------------------
# Legacy roles
# ---------------------------------------------------------------------------


def _migrate_legacy_roles(verbose: bool) -> list[str]:
	"""Users carrying a pre-registry role ("Citizen", "Loan Underwriter") gain
	the equivalent new role. The old role is left on the account: removing it
	is a separate, reversible decision for an operator, not a migration's.
	"""
	migrated = []
	for legacy, current in reg.LEGACY_ROLE_ALIASES.items():
		if not frappe.db.exists("Role", legacy) or not frappe.db.exists("Role", current):
			continue

		users = frappe.get_all("Has Role", filters={"role": legacy}, pluck="parent")
		for user in set(users):
			if not frappe.db.exists("User", user):
				continue
			if frappe.db.exists("Has Role", {"parent": user, "role": current}):
				continue
			doc = frappe.get_doc("User", user)
			doc.add_roles(current)
			migrated.append(f"{user}:{legacy}->{current}")
			if verbose:
				print(f"[gdb_bank.rbac] {user}: granted {current} (had {legacy})")
	return migrated


# ---------------------------------------------------------------------------
# Introspection - used by the admin API and by operators via bench execute
# ---------------------------------------------------------------------------


def describe() -> dict:
	"""What the registry currently declares. `bench --site <s> execute
	gdb_bank.rbac.provisioning.describe` prints the whole role model."""
	return {
		"personas": [
			{
				"key": p.key,
				"role": p.role,
				"title": p.title,
				"description": p.description,
				"row_scope": p.row_scope.value,
				"desk_access": p.desk_access,
				"keycloak_roles": list(p.keycloak_roles),
				"role_profile": p.profile_name,
				"portal_home": p.portal_home,
				"revision": p.revision,
				"retired": p.retired,
				"capabilities": sorted(p.capabilities),
				"doctype_permissions": [
					{"doctype": d.doctype, **d.as_perm_fields()} for d in p.doctype_permissions
				],
			}
			for p in reg.PERSONAS
		],
		"keycloak_role_map": {k: list(v) for k, v in reg.keycloak_role_map().items()},
		"capability_catalogue": reg.capability_catalogue(),
	}


def drift() -> dict:
	"""What the live site has that the registry does not, and vice versa.
	Read-only - run it before a migrate to see what reconcile would change."""
	expected_roles = {p.role for p in reg.ACTIVE_PERSONAS}
	live_roles = set(frappe.get_all("Role", filters={"is_custom": 1}, pluck="name"))
	return {
		"missing_roles": sorted(expected_roles - live_roles),
		"unexpected_gdb_roles": sorted(
			r for r in live_roles - expected_roles if r.startswith("GDB ")
		),
	}
