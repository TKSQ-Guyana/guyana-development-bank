"""The e-ID (three-box number) - normalization, validation and storage.

Every GDB record keys on the e-ID, not on the email address: features.md is
explicit that queues identify people by e-ID, and an email can be changed while
an identity cannot. The e-ID arrives as a Keycloak token claim
(`GDB_EID_CLAIM`, default `eid`) and is mirrored onto the Frappe User as
`gdb_eid` so every backend query can scope on it without a token round-trip.

FORMAT
    Three dash-separated boxes, e.g. `123-4567-890`. Stored normalized
    (uppercase, single dashes, no spaces). `is_valid()` is deliberately lenient
    on box widths - the authoritative check is Keycloak's; this exists to catch
    a malformed claim before it becomes a row-scoping filter.
"""

from __future__ import annotations

import os
import re

import frappe

EID_CLAIM = os.environ.get("GDB_EID_CLAIM", "eid")
"""Which token claim carries the e-ID. Deployments that name it differently
(`national_id`, `three_box`) set GDB_EID_CLAIM rather than patching code."""

EID_USER_FIELD = "gdb_eid"

_NORMALIZE = re.compile(r"[\s_]+")
_SHAPE = re.compile(r"^[A-Z0-9]{2,6}(-[A-Z0-9]{2,6}){2}$")


def normalize(raw: str | None) -> str | None:
	if not raw:
		return None
	value = _NORMALIZE.sub("", str(raw)).strip().upper()
	value = re.sub(r"-{2,}", "-", value).strip("-")
	return value or None


def is_valid(raw: str | None) -> bool:
	value = normalize(raw)
	return bool(value and _SHAPE.match(value))


def for_user(user: str) -> str | None:
	"""The e-ID mirrored onto a Frappe User, or None if that user predates
	Keycloak onboarding (a locally created demo account, say)."""
	if not user or user == "Guest":
		return None
	return frappe.db.get_value("User", user, EID_USER_FIELD)


def user_for_eid(eid: str) -> str | None:
	value = normalize(eid)
	if not value:
		return None
	return frappe.db.get_value("User", {EID_USER_FIELD: value}, "name")


def bind_to_user(user: str, eid: str | None) -> str | None:
	"""Mirror the token's e-ID onto the User record.

	`db_set` is correct here and only here: the e-ID mirror is operational
	system state synchronised from the identity provider on every login, not a
	business state transition (CLAUDE.md section 2). It is also rejected if it
	would silently re-point an existing e-ID at a different account.
	"""
	value = normalize(eid)
	if not value:
		return None

	current = frappe.db.get_value("User", user, EID_USER_FIELD)
	if current == value:
		return value

	clash = frappe.db.get_value("User", {EID_USER_FIELD: value, "name": ("!=", user)}, "name")
	if clash:
		frappe.log_error(
			title="gdb_bank: e-ID collision",
			message=f"e-ID already bound to another user; refused to rebind to {user}",
		)
		return current

	frappe.db.set_value("User", user, EID_USER_FIELD, value, update_modified=False)
	return value
