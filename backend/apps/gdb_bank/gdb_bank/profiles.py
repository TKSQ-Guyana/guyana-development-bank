"""The applicant's own details — asserted and declared, kept apart.

Two sources, two blocks, never merged:

  * what the e-ID directory said at sign-in (`record_identity_claims`, called
    from identity.py with the claims Keycloak returned), and
  * what the applicant typed (`save_profile`).

An underwriter reads both. That is the whole design: a name the directory holds
and a name the applicant gave are different kinds of fact, and a case where they
disagree is exactly the case a human needs to look at. Collapsing them into one
field would answer a question nobody asked and hide the one that matters.

For a cluster, the head applies but each member is their own person: members
fill in their own details and attach their own documents, and staff reading the
head's case can open each member's profile from it. Members never see each
other's — see permissions.own_record_has_permission.

Endpoints: POST /api/method/gdb_bank.profiles.<name>
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from gdb_bank.api import _is_staff, _logger, _session_user

DOCTYPE = "GDB Citizen Profile"

# What the applicant may write. Everything else on the doctype is either
# derived (name, e-ID) or asserted by the directory, and a citizen writing to
# those would be declaring something as verified.
DECLARED_FIELDS = (
	"phone",
	"date_of_birth",
	"occupation",
	"region",
	"village_or_town",
	"address",
	"next_of_kin",
	"next_of_kin_phone",
)

VERIFIED_FIELDS = (
	"verified_full_name",
	"verified_email",
	"verified_phone",
	"verified_birth_date",
	"verified_address",
	"identity_source",
	"verified_on",
)

PROFILE_FIELDS = ("name", "user", "eid", "full_name", "updated_on") + DECLARED_FIELDS + VERIFIED_FIELDS


def _ensure(user: str):
	"""The profile row for this user, created empty if it does not exist yet."""
	name = frappe.db.get_value(DOCTYPE, {"user": user})
	if name:
		return name
	doc = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"user": user,
			"eid": frappe.db.get_value("User", user, "gdb_eid"),
		}
	).insert(ignore_permissions=True)
	return doc.name


def record_identity_claims(user: str, eid: str, claims: dict) -> None:
	"""Write what the identity provider asserted. Called on every e-ID sign-in.

	Overwrites the verified block each time and touches nothing the applicant
	declared: the directory is authoritative about its own assertions and has
	no opinion about theirs. Never raises — a portal sign-in must not fail
	because a profile write did.
	"""
	try:
		name = _ensure(user)
		frappe.db.set_value(
			DOCTYPE,
			name,
			{
				"eid": eid,
				"verified_full_name": (claims.get("name") or "").strip()
				or " ".join(
					p
					for p in (
						(claims.get("given_name") or "").strip(),
						(claims.get("family_name") or "").strip(),
					)
					if p
				),
				"verified_email": (claims.get("email") or "").strip(),
				"verified_phone": (claims.get("phone_number") or "").strip(),
				"verified_birth_date": (claims.get("birthdate") or "").strip(),
				"verified_address": _address(claims.get("address")),
				"identity_source": "e-ID directory",
				"verified_on": now_datetime(),
			},
		)
		frappe.db.commit()
	except Exception:
		_logger().warning(f"could not record identity claims for {user}", exc_info=True)


def _address(value) -> str:
	"""OIDC `address` is a claim object; some realms send a bare string."""
	if not value:
		return ""
	if isinstance(value, str):
		return value.strip()
	parts = [
		value.get("street_address"),
		value.get("locality"),
		value.get("region"),
		value.get("country"),
	]
	return ", ".join(p.strip() for p in parts if p and str(p).strip())


@frappe.whitelist()
def my_profile():
	"""The caller's own profile, created on first read."""
	user = _session_user()
	name = _ensure(user)
	return frappe.db.get_value(DOCTYPE, name, list(PROFILE_FIELDS), as_dict=True)


@frappe.whitelist(methods=["POST"])
def save_profile(**kwargs):
	"""The applicant fills in their own details.

	Only the declared block. The verified block is the directory's, and an
	applicant who could write it could declare themselves verified.
	"""
	user = _session_user()
	name = _ensure(user)

	# An untouched field arrives from a browser form as "", and "" is not a
	# date: MySQL rejects it on `date_of_birth` and the whole save 500s. Empty
	# means "not given", which is NULL — for every field, so clearing one works
	# the same way it does for setting one.
	values = {}
	for field in DECLARED_FIELDS:
		if field not in kwargs:
			continue
		value = kwargs[field]
		if isinstance(value, str):
			value = value.strip() or None
		values[field] = value

	if not values:
		frappe.throw(_("Nothing to save."))
	values["updated_on"] = now_datetime()
	frappe.db.set_value(DOCTYPE, name, values)
	frappe.db.commit()
	_logger().info(f"profile updated by {user}: {', '.join(sorted(values))}")
	return frappe.db.get_value(DOCTYPE, name, list(PROFILE_FIELDS), as_dict=True)


@frappe.whitelist()
def profile_of(user: str):
	"""One person's profile, for staff. Read only, and both blocks.

	This is how an underwriter reading a cluster head's case sees who the other
	members actually are — the members fill their own in, and nobody fills in
	anybody else's.
	"""
	caller = _session_user()
	if caller != user and not _is_staff(caller):
		frappe.throw(_("You may only read your own profile."), frappe.PermissionError)
	name = frappe.db.get_value(DOCTYPE, {"user": user})
	if not name:
		return None
	return frappe.db.get_value(DOCTYPE, name, list(PROFILE_FIELDS), as_dict=True)
