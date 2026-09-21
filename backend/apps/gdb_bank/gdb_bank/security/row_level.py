"""Row-level security: the `permission_query_conditions` and `has_permission`
hooks that Frappe applies to EVERY read, including ones that never touch this
app's service layer.

WHY THIS EXISTS SEPARATELY FROM `rbac/guards.py`
    Guards protect `gdb_bank.api.*`. They do nothing for `/api/resource/GDB
    Loan Application`, for a desk list view, for a report, or for a Frappe
    `get_list` inside some other app. Those all go through the permission
    engine instead. Enforcing the e-ID scope in only one of the two places
    leaves a BOLA hole wide enough to enumerate every citizen's case, so both
    are wired and both are derived from the same registry.

HOW FRAPPE COMBINES THEM  (frappe/database/query.py, v16)
    * No role permission with read/select on the DocType -> only *shared*
      documents are visible, and an unshared `get_list` raises. This is the
      Phase 5 Board/CEO guarantee: that persona simply has no permission row.
    * With a role permission:
          (if_owner constraint OR User Permissions)
          AND permission_query_conditions        <- this module
          OR  shared documents
      Note the trailing OR: an explicitly *shared* document trumps these
      conditions. `install.py` therefore denies `share` to every persona on the
      case-level DocTypes, so nothing can be shared around the e-ID scope.

v16 BREAKING CHANGE
    `has_permission` hooks must return **True** to grant. In v15 returning
    `None` implicitly granted; in v16 that denies. Every return path below is
    explicit.
"""

from __future__ import annotations

import frappe

from gdb_bank.rbac import personas as reg
from gdb_bank.rbac import scoping
from gdb_bank.rbac.personas import RowScope
from gdb_bank.security import eid as eid_mod

_NO_ROWS = "1=0"


def _scope_for_user(user: str) -> tuple[RowScope, str | None]:
	roles = frappe.get_roles(user)
	return reg.widest_row_scope(roles), eid_mod.for_user(user)


# ---------------------------------------------------------------------------
# LIST reads
# ---------------------------------------------------------------------------


def permission_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	"""SQL predicate AND-ed into every list query on a scoped DocType.

	Returns a string; Frappe wraps it in a RawCriterion. Every value is passed
	through `frappe.db.escape` - never interpolate a session value raw.
	"""
	user = user or frappe.session.user
	if not doctype:
		return ""

	spec = scoping.spec_for(doctype)
	if not spec:
		return ""

	# Administrator keeps the break-glass path; it is a named account, its use
	# is visible in the technical log, and locking it out would make a broken
	# permission table unrecoverable.
	if user == "Administrator":
		return ""

	scope, eid = _scope_for_user(user)

	if scope is RowScope.ALL:
		return ""

	if scope is RowScope.NONE:
		# Belt and braces: such a persona should hold no read permission on a
		# case-level DocType at all (provisioning asserts it), but if a DocPerm
		# is ever added by hand, this still returns nothing.
		return _NO_ROWS

	if not eid:
		# A scoped persona with no e-ID bound yet cannot be matched to any row.
		# Denying is the safe direction: the alternative is showing everything.
		return _NO_ROWS

	table = f"`tab{doctype}`"
	escaped = frappe.db.escape(eid)

	if spec.parent_field and spec.parent_doctype:
		return _inherited_condition(table, spec, scope, escaped)

	clauses = [f"{table}.`{spec.subject_eid_field}` = {escaped}"]
	if scope is RowScope.FACILITATED and spec.facilitator_eid_field:
		clauses.append(f"{table}.`{spec.facilitator_eid_field}` = {escaped}")
	return "(" + " OR ".join(clauses) + ")"


def _inherited_condition(table: str, spec, scope: RowScope, escaped_eid: str) -> str:
	"""Documents, conditions and info requests inherit their parent's scope via
	a correlated EXISTS rather than a join - the query builder owns the FROM
	clause, so a subquery is the only safe way in."""
	parent = f"`tab{spec.parent_doctype}`"
	parent_spec = scoping.spec_for(spec.parent_doctype)
	assert parent_spec is not None, f"{spec.parent_doctype} has no scope spec"

	match = [f"{parent}.`{parent_spec.subject_eid_field}` = {escaped_eid}"]
	if scope is RowScope.FACILITATED and parent_spec.facilitator_eid_field:
		match.append(f"{parent}.`{parent_spec.facilitator_eid_field}` = {escaped_eid}")

	return (
		f"EXISTS (SELECT 1 FROM {parent} WHERE {parent}.`name` = "
		f"{table}.`{spec.parent_field}` AND ({' OR '.join(match)}))"
	)


# ---------------------------------------------------------------------------
# SINGLE-document reads and writes
# ---------------------------------------------------------------------------


def has_permission(doc, ptype: str = "read", user: str | None = None, **kwargs) -> bool:
	"""Per-document gate. MUST return True explicitly to grant (v16).

	This is the check that stops `GET /api/resource/GDB Loan Application/GDB-
	APP-00042` from returning someone else's case even though the Citizen role
	does hold `read` on the DocType.
	"""
	user = user or frappe.session.user
	if user == "Administrator":
		return True

	spec = scoping.spec_for(doc.doctype)
	if not spec:
		return True  # not a scoped DocType; role permissions already decided

	scope, eid = _scope_for_user(user)

	if scope is RowScope.ALL:
		return True
	if scope is RowScope.NONE:
		return False
	if not eid:
		return False

	subject_eid, facilitator_eid = _identities_of(doc, spec)

	if subject_eid and subject_eid == eid:
		return True
	if scope is RowScope.FACILITATED and facilitator_eid and facilitator_eid == eid:
		# A facilitator reads and drafts, but never decides on behalf of the
		# cluster beyond submission - write paths are additionally capability
		# guarded in services/facilitator.py.
		return True

	return False


def _identities_of(doc, spec) -> tuple[str | None, str | None]:
	"""The subject and facilitator e-IDs governing this document, following the
	parent link when the DocType carries none of its own."""
	if spec.parent_field and spec.parent_doctype:
		parent_name = doc.get(spec.parent_field)
		if not parent_name:
			return None, None
		parent_spec = scoping.spec_for(spec.parent_doctype)
		fields = [parent_spec.subject_eid_field]
		if parent_spec.facilitator_eid_field:
			fields.append(parent_spec.facilitator_eid_field)
		row = frappe.db.get_value(spec.parent_doctype, parent_name, fields, as_dict=True)
		if not row:
			return None, None
		return (
			row.get(parent_spec.subject_eid_field),
			row.get(parent_spec.facilitator_eid_field) if parent_spec.facilitator_eid_field else None,
		)

	return (
		doc.get(spec.subject_eid_field),
		doc.get(spec.facilitator_eid_field) if spec.facilitator_eid_field else None,
	)


# ---------------------------------------------------------------------------
# hooks.py wiring helper
# ---------------------------------------------------------------------------


def hook_map(target: str) -> dict[str, str]:
	"""Build the `permission_query_conditions` / `has_permission` hook dicts
	from `scoping.SCOPES`, so adding a scoped DocType never means remembering
	to also edit hooks.py."""
	path = f"gdb_bank.security.row_level.{target}"
	return {doctype: path for doctype in scoping.SCOPED_DOCTYPES}
