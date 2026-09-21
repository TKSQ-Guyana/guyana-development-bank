"""The e-ID (three-box number) - normalization, validation and storage.

Every GDB record keys on the e-ID, not on the email address: features.md is
explicit that queues identify people by e-ID, and an email can be changed while
an identity cannot. The e-ID arrives as a Keycloak token claim
(`GDB_EID_CLAIM`, default `eid`) and is mirrored onto the Frappe User as
`gdb_eid` so every backend query can scope on it without a token round-trip.

FORMAT
    Three dash-separated boxes of 3, 4 and 4 digits: `592-1111-0001`. The shape
    itself lives in `domain/eid_format.py`, which imports no frappe, so the
    site-free tests can prove that what we seed is what the sign-in form can
    express. This module is the frappe-bound half: storage, lookup and binding.
"""

from __future__ import annotations

import os

import frappe

from gdb_bank.domain import eid_format

EID_CLAIM = os.environ.get("GDB_EID_CLAIM", "eid")
"""Which token claim carries the e-ID. Deployments that name it differently
(`national_id`, `three_box`) set GDB_EID_CLAIM rather than patching code."""

EID_USER_FIELD = "gdb_eid"


def normalize(raw: str | None) -> str | None:
	"""The canonical `592-1111-0001`, or None for nothing usable.

	None rather than `""` because every caller here goes on to use the result
	as a database key, and an empty string is a value a query would happily
	match against a row whose e-ID was never set.
	"""
	return eid_format.normalize(raw) or None


def is_valid(raw: str | None) -> bool:
	return eid_format.is_valid(raw)


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

	# Refuse a malformed claim outright. This value becomes the WHERE clause of
	# every scoped query for this user, so binding something the format does not
	# recognise would quietly scope them to nothing - a person signed in,
	# permitted, and shown an empty portal with no error anywhere.
	if not is_valid(value):
		frappe.log_error(
			title="gdb_bank: malformed e-ID claim",
			message=f"refused to bind an e-ID that is not {eid_format.PART_LENGTHS} digits to {user}",
		)
		return frappe.db.get_value("User", user, EID_USER_FIELD)

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
