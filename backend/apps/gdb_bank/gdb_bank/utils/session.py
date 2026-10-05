"""Session, role and logging infrastructure for the portal.

These are the impure, request-scoped helpers every layer needs: who is logged
in, which staff role they hold, how to run a bank-side write as the system, and
the app logger. They live below both api.py and services/ so neither has to own
them, and so authorization stays out of the pure domain logic in services/.

api.py re-imports these names, so `from gdb_bank.api import _session_user` (and
the rest) keeps resolving for the sibling modules that already do that.
"""

import logging
from contextlib import contextmanager

import frappe
from frappe import _

from gdb_bank.utils.constants import (
	DISBURSEMENT_ROLES,
	FACILITATOR_ROLES,
	FIELD_OFFICER_ROLES,
	FINANCE_ROLES,
	PLATFORM_ADMIN_ROLES,
	STAFF_ROLES,
	UNDERWRITER_ROLES,
	REPRESENTATIVE_ROLES,
)


def _logger() -> logging.Logger:
	"""Frappe-native logging: rotating logs/gdb_bank.log at bench and site
	level. Fetched lazily (frappe.logger caches per request-site) and pinned to
	INFO — frappe's process default is ERROR and site config has no say."""
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger


def _session_user() -> str:
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("Please log in."), frappe.AuthenticationError)
	return user


def _is_underwriter(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & UNDERWRITER_ROLES)


def _require_underwriter() -> str:
	user = _session_user()
	if not _is_underwriter(user):
		_logger().warning(f"denied underwriter endpoint to {user}")
		frappe.throw(_("Only GDB loan officers may do this."), frappe.PermissionError)
	return user


def _is_finance(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & FINANCE_ROLES)


def _require_finance() -> str:
	user = _session_user()
	if not _is_finance(user):
		_logger().warning(f"denied finance endpoint to {user}")
		frappe.throw(_("Only GDB Finance may do this."), frappe.PermissionError)
	return user


def _is_disbursement(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & DISBURSEMENT_ROLES)


def _require_disbursement() -> str:
	user = _session_user()
	if not _is_disbursement(user):
		_logger().warning(f"denied disbursement endpoint to {user}")
		frappe.throw(
			_("Only the GDB disbursement officer may do this."), frappe.PermissionError
		)
	return user


def _require_underwriter_or_disbursement() -> str:
	"""Either of the two staff personas with a stake in release readiness.

	The underwriter owns the credit decision; the disbursement officer is the
	one actually refused `disburse_loan` while a required condition sits
	Outstanding (see `conditions.outstanding`). Both may therefore clear the
	checklist — the officer is not just reading a gate somebody else holds the
	key to, they hold it too. Booking and disbursement themselves stay behind
	`_require_disbursement` alone; this only widens who may tick the
	pre-conditions, not who may move money.
	"""
	user = _session_user()
	if not (_is_underwriter(user) or _is_disbursement(user)):
		_logger().warning(f"denied underwriter-or-disbursement endpoint to {user}")
		frappe.throw(
			_("Only a GDB loan officer or disbursement officer may do this."),
			frappe.PermissionError,
		)
	return user


def _is_staff(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & STAFF_ROLES)


def _require_staff() -> str:
	"""Any GDB persona, but not the applicant. For bank-internal reading where
	all three staff roles have a legitimate view and a citizen has none."""
	user = _session_user()
	if not _is_staff(user):
		_logger().warning(f"denied staff endpoint to {user}")
		frappe.throw(_("Only GDB staff may do this."), frappe.PermissionError)
	return user


def _is_facilitator(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & FACILITATOR_ROLES)


def _require_facilitator() -> str:
	"""Group formation and the group's application — nothing else. Which group a
	facilitator may touch is cluster._require_facilitator_of; this is the role."""
	user = _session_user()
	if not _is_facilitator(user):
		_logger().warning(f"denied facilitator endpoint to {user}")
		frappe.throw(_("Only a GDB facilitator may do this."), frappe.PermissionError)
	return user


def _is_representative(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & REPRESENTATIVE_ROLES)


def _require_representative() -> str:
	"""The appointment queue — nothing else."""
	user = _session_user()
	if not _is_representative(user):
		_logger().warning(f"denied representative endpoint to {user}")
		frappe.throw(_("Only a GDB Representative may do this."), frappe.PermissionError)
	return user


def _is_field_officer(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & FIELD_OFFICER_ROLES)


def _require_field_officer() -> str:
	"""Assist requests, assisted applications and field tasks — nothing else.
	Which case or applicant an officer may touch is decided per record in
	services/field_operations; this is the role."""
	user = _session_user()
	if not _is_field_officer(user):
		_logger().warning(f"denied field-officer endpoint to {user}")
		frappe.throw(_("Only a GDB field officer may do this."), frappe.PermissionError)
	return user


def _is_platform_admin(user: str | None = None) -> bool:
	return bool(set(frappe.get_roles(user or frappe.session.user)) & PLATFORM_ADMIN_ROLES)


def _require_platform_admin() -> str:
	"""Accounts, roles, system health and integration settings — and nothing
	within reach of a case. The converse holds too: this role is in none of the
	authority sets, so every other _require_* refuses it."""
	user = _session_user()
	if not _is_platform_admin(user):
		_logger().warning(f"denied platform-admin endpoint to {user}")
		frappe.throw(_("Only the GDB platform administrator may do this."), frappe.PermissionError)
	return user


def _eids(users) -> dict:
	"""e-ID for each of these users, in one query.

	The e-ID is how GDB staff identify an applicant — an email address is a
	mailbox, not an identity, and two people can share one. Fetched in a batch
	because every list view needs it for every row.
	"""
	wanted = {u for u in users if u}
	if not wanted:
		return {}
	rows = frappe.get_all(
		"User", filters={"name": ["in", list(wanted)]}, fields=["name", "gdb_eid"]
	)
	return {r.name: r.gdb_eid for r in rows}


@contextmanager
def _as_system():
	"""Run a bank-side write as Administrator, handing the session back intact.

	Elevation is unavoidable for these writes: lending creates Loan Demand and
	repayment-schedule rows of its own downstream, so ignore_permissions on the
	outer doc would not reach them, and frappe.has_permission only
	short-circuits for Administrator.

	The catch is that frappe.set_user() overwrites local.session.sid with the
	username it is given (frappe/__init__.py), so set_user -> work ->
	set_user(caller) leaves the caller holding a sid that no longer resolves:
	their very next request is Guest and 403s. Capture the real sid and session
	data, and put them back.
	"""
	caller = frappe.session.user
	sid = frappe.session.sid
	data = frappe.session.data
	frappe.set_user("Administrator")
	try:
		yield caller
	finally:
		frappe.set_user(caller)
		frappe.local.session.sid = sid
		frappe.local.session.data = data
