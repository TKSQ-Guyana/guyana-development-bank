"""Staff and citizen accounts, as the platform administrator manages them.

TWO KINDS OF ACCOUNT, TWO SIGN-IN DOORS (security/sign_in_policy.py):
  staff    — a Frappe System User created HERE, holding one or more of the
             three portal roles; signs in with work email + password against
             the Keycloak staff realm.
  citizen  — a Frappe Website User created by the citizen's own first e-ID
             sign-in (identity._resolve_user); never created here, carries no
             staff role, and can only be disabled or re-enabled.

WHAT THE FRAPPE ACCOUNT IS FOR. It holds the ROLES — what a person may do —
and its `enabled` flag is the kill switch: a disabled account is refused at
every sign-in and its open sessions are ended, whatever Keycloak still says.
Keycloak holds the PASSWORD. So creating a staff member is two acts: the
Frappe account here, and its Keycloak account through
integrations/keycloak_admin.py, set with a ONE-TIME password that is returned
to the administrator exactly once and stored nowhere on GDB's side. Keycloak
holds it as temporary, so its only use is the person's first sign-in, where
they must replace it (identity.staff_set_password). The password they then
sign in with is one nobody at GDB has seen.

Every change is checked against security/role_policy.py first, and recorded
through services/access_audit.py in the same transaction. Every change is
also a desired END STATE (these roles, enabled or not), so repeating a request
is a no-op rather than a second change — the idempotency a retried POST needs.
"""

import secrets

import frappe
from frappe import _
from frappe.sessions import clear_sessions
from frappe.utils import cint, validate_email_address

from gdb_bank.integrations import keycloak_admin
from gdb_bank.security import role_policy
from gdb_bank.services import access_audit
from gdb_bank.utils.constants import PLATFORM_ADMIN_ROLE
from gdb_bank.utils.eid import EID_FIELD, EID_SHAPE, normalize_eid
from gdb_bank.utils.session import _logger

STAFF_EID_FIELD = "gdb_staff_eid"
STAFF = "staff"
CITIZENS = "citizens"
USER_TYPES = {STAFF: "System User", CITIZENS: "Website User"}

MAX_PAGE = 100

# Roles worth showing an administrator. The rest of what Frappe hands a user
# (All, Desk User, lending's desk roles) is noise at this level.
_SHOWN_ROLES = (*role_policy.GRANTABLE_ROLES, PLATFORM_ADMIN_ROLE, "System Manager", "Citizen")

_LIST_FIELDS = ["name", "full_name", "user_type", "enabled", "last_login", EID_FIELD, STAFF_EID_FIELD]

# Holding both is allowed — a small bank needs it — but only because
# api.disburse_loan's per-case gate refuses the officer who approved the case.
_DECIDE_AND_RELEASE = {"Loan Underwriter", "Disbursement Officer"}

# Read aloud or typed from a screen, so no character that looks like another
# (0/O, 1/l/I). Three groups of four: ~68 bits, for a password that works once.
_OTP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


# -- helpers -------------------------------------------------------------------


def _one_time_password() -> str:
	while True:
		chars = [secrets.choice(_OTP_ALPHABET) for _ in range(12)]
		if any(c.isupper() for c in chars) and any(c.islower() for c in chars) and any(c.isdigit() for c in chars):
			return "-".join("".join(chars[i : i + 4]) for i in (0, 4, 8))


def _reason(reason) -> str:
	text = (reason or "").strip()
	if len(text) < 3:
		frappe.throw(_("Say why this change is being made."))
	return text[:500]


def _clean_roles(roles) -> list[str]:
	parsed = frappe.parse_json(roles) if isinstance(roles, str) else roles
	wanted = sorted({str(r).strip() for r in (parsed or []) if str(r).strip()})
	if not wanted:
		frappe.throw(_("A staff account needs at least one role. To remove access, disable the account."))
	refusal = role_policy.refusal_to_grant(wanted)
	if refusal:
		frappe.throw(refusal, frappe.PermissionError)
	return wanted


def _roles_by_user(names: list[str]) -> dict[str, list[str]]:
	if not names:
		return {}
	rows = frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "parent": ["in", names], "role": ["in", list(_SHOWN_ROLES)]},
		fields=["parent", "role"],
	)
	held: dict[str, list[str]] = {}
	for row in rows:
		held.setdefault(row.parent, []).append(row.role)
	return {user: sorted(roles) for user, roles in held.items()}


def _summary(row, roles: list[str], actor: str) -> dict:
	staff = row.user_type == "System User"
	refusal = role_policy.refusal_to_manage(actor, row.name, roles)
	return {
		"name": row.name,
		"full_name": row.full_name,
		"kind": STAFF if staff else CITIZENS,
		"enabled": bool(cint(row.enabled)),
		"last_login": row.last_login,
		# How GDB identifies a person: the citizen's sign-in e-ID, or the
		# national e-ID recorded on a staff account for the conflict check.
		"eid": row.get(STAFF_EID_FIELD if staff else EID_FIELD),
		"roles": roles,
		"manageable": refusal is None,
		"protected_reason": refusal,
	}


def _load(user: str):
	if not user or not frappe.db.exists("User", user):
		frappe.throw(_("No such account."), frappe.DoesNotExistError)
	return frappe.get_doc("User", user)


def _manageable(actor: str, user: str):
	doc = _load(user)
	refusal = role_policy.refusal_to_manage(actor, doc.name, [r.role for r in doc.roles])
	if refusal:
		frappe.throw(refusal, frappe.PermissionError)
	return doc


def _warnings(roles) -> list[str]:
	if _DECIDE_AND_RELEASE <= set(roles):
		return [
			_(
				"This person can both decide and release loans. That is allowed, but they "
				"will be refused release on any loan they approved."
			)
		]
	return []


# -- reads ---------------------------------------------------------------------


def list_users(actor: str, kind: str = STAFF, search: str | None = None, start=0, page_length=50) -> dict:
	user_type = USER_TYPES.get(kind)
	if not user_type:
		frappe.throw(_("Choose staff or citizens."))
	page_length = max(1, min(cint(page_length) or 50, MAX_PAGE))
	start = max(0, cint(start))

	filters = {"user_type": user_type, "name": ["not in", list(role_policy.STANDARD_USERS)]}
	or_filters = None
	term = (search or "").strip()[:100]
	if term:
		like = f"%{term}%"
		or_filters = [
			["full_name", "like", like],
			["name", "like", like],
			[EID_FIELD, "like", like],
			[STAFF_EID_FIELD, "like", like],
		]

	rows = frappe.get_all(
		"User",
		filters=filters,
		or_filters=or_filters,
		fields=_LIST_FIELDS,
		order_by="full_name asc",
		limit_start=start,
		limit_page_length=page_length + 1,
	)
	page = rows[:page_length]
	roles = _roles_by_user([r.name for r in page])
	return {
		"users": [_summary(r, roles.get(r.name, []), actor) for r in page],
		"has_more": len(rows) > page_length,
		# The create form offers exactly what the server will accept, rather
		# than keeping a second copy of role_policy in the client.
		"grantable_roles": list(role_policy.GRANTABLE_ROLES),
	}


def get_user(actor: str, user: str) -> dict:
	doc = _load(user)
	row = frappe._dict({field: doc.get(field) for field in _LIST_FIELDS})
	roles = sorted({r.role for r in doc.roles} & set(_SHOWN_ROLES))
	summary = _summary(row, roles, actor)
	staff = summary["kind"] == STAFF
	return {
		**summary,
		"email": doc.email,
		"grantable_roles": list(role_policy.GRANTABLE_ROLES),
		"can_change_roles": staff and summary["manageable"],
		"can_reset_password": staff and summary["manageable"] and summary["enabled"],
		"keycloak_managed": keycloak_admin.is_configured(),
		"warnings": _warnings(roles),
	}


# -- writes --------------------------------------------------------------------


def _keycloak_outcome(status: str, detail: str) -> dict:
	return {"status": status, "detail": detail}


def _issued_detail(email: str) -> str:
	return _(
		"Give {0} this one-time password. It is shown only now. It works once: at their first "
		"sign-in they must choose their own."
	).format(email)


def _issue_one_time_password(user_id: str) -> str:
	"""Set a fresh temporary password on the Keycloak account and hand it back.
	The caller returns it to the administrator and keeps it nowhere."""
	password = _one_time_password()
	keycloak_admin.set_password(user_id, password, temporary=True)
	return password


def _provision_keycloak(email: str, full_name: str) -> tuple[dict, str | None]:
	"""(outcome, one-time password or None)."""
	if not keycloak_admin.is_configured():
		return _keycloak_outcome(
			"manual",
			_("Keycloak account management is not configured. Create the account in the staff realm "
			  "with username {0} before this person can sign in.").format(email),
		), None
	try:
		user_id, created = keycloak_admin.ensure_account(email, full_name)
		if not created:
			return _keycloak_outcome(
				"linked",
				_("A Keycloak account already exists for {0}; they sign in with its password. "
				  "Use \"Reset password\" to issue a one-time password instead.").format(email),
			), None
		password = _issue_one_time_password(user_id)
	except keycloak_admin.KeycloakAdminError as exc:
		return _keycloak_outcome(
			"failed",
			_("{0} Use \"Reset password\" to retry once it is fixed.").format(str(exc)),
		), None
	return _keycloak_outcome("issued", _issued_detail(email)), password


def create_staff_user(actor: str, full_name: str, email: str, roles, reason: str, eid: str | None = None) -> dict:
	reason = _reason(reason)
	full_name = (full_name or "").strip()
	if not full_name or len(full_name) > 140:
		frappe.throw(_("Enter the person's full name."))
	email = (email or "").strip().lower()
	validate_email_address(email, throw=True)
	wanted = _clean_roles(roles)

	eid = normalize_eid(eid) if eid else ""
	if eid and not EID_SHAPE.match(eid):
		frappe.throw(_("Enter the e-ID as 3, then 4, then 4 digits."))

	if frappe.db.exists("User", email):
		frappe.throw(_("An account with this email already exists."), frappe.DuplicateEntryError)
	if eid and frappe.db.exists("User", {STAFF_EID_FIELD: eid}):
		frappe.throw(_("This e-ID is already recorded on another staff account."), frappe.DuplicateEntryError)

	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": full_name,
			"user_type": "System User",
			# The password is Keycloak's, never Frappe's: no welcome mail with a
			# Frappe set-password link, and no Frappe password.
			"send_welcome_email": 0,
			"enabled": 1,
			STAFF_EID_FIELD: eid or None,
			"roles": [{"role": role} for role in wanted],
		}
	).insert(ignore_permissions=True)
	access_audit.record(
		actor,
		access_audit.ACCOUNT_CREATED,
		reason=reason,
		subject=email,
		subject_user=email,
		new=wanted,
	)
	# Commit before calling Keycloak, which is not part of this transaction: a
	# Keycloak failure must leave a Frappe account the administrator can retry
	# from, not a half-made one that vanishes on rollback.
	frappe.db.commit()
	_logger().info(f"platform admin {actor} created staff account {email} with {wanted}")

	keycloak, password = _provision_keycloak(email, full_name)
	if password:
		access_audit.record(
			actor, access_audit.ONE_TIME_PASSWORD_ISSUED, reason=reason, subject=email, subject_user=email
		)
		frappe.db.commit()
	# `one_time_password` is in this response and nowhere else — not the
	# database, not the log, not the access trail.
	return {"user": get_user(actor, email), "keycloak": keycloak, "one_time_password": password}


def set_user_roles(actor: str, user: str, roles, reason: str) -> dict:
	reason = _reason(reason)
	doc = _manageable(actor, user)
	if doc.user_type != "System User":
		frappe.throw(
			_("Citizen accounts carry no staff roles. Create a staff account for this person instead."),
			frappe.PermissionError,
		)
	wanted = set(_clean_roles(roles))
	grantable = set(role_policy.GRANTABLE_ROLES)
	current = {r.role for r in doc.roles} & grantable

	if current != wanted:
		doc.set("roles", [r for r in doc.roles if r.role not in grantable or r.role in wanted])
		for role in sorted(wanted - current):
			doc.append("roles", {"role": role})
		doc.save(ignore_permissions=True)
		access_audit.record(
			actor,
			access_audit.ROLES_CHANGED,
			reason=reason,
			subject=doc.name,
			subject_user=doc.name,
			old=current,
			new=wanted,
		)
		frappe.db.commit()
		_logger().info(f"platform admin {actor} set roles of {doc.name}: {sorted(current)} -> {sorted(wanted)}")

	return {"user": get_user(actor, doc.name), "changed": current != wanted}


def _mirror_to_keycloak(email: str, enabled: bool) -> dict | None:
	if not keycloak_admin.is_configured():
		return _keycloak_outcome(
			"manual",
			_("Keycloak account management is not configured; the portal account is {0}, the Keycloak "
			  "account was not changed.").format(_("enabled") if enabled else _("disabled")),
		)
	try:
		found = keycloak_admin.set_enabled(email, enabled)
	except keycloak_admin.KeycloakAdminError as exc:
		return _keycloak_outcome("failed", str(exc))
	if not found:
		return _keycloak_outcome("absent", _("Keycloak holds no account for {0}.").format(email))
	return _keycloak_outcome("mirrored", _("The Keycloak account was updated to match."))


def set_user_enabled(actor: str, user: str, enabled, reason: str) -> dict:
	reason = _reason(reason)
	enabled = bool(cint(enabled))
	doc = _manageable(actor, user)
	changed = bool(cint(doc.enabled)) != enabled

	if changed:
		doc.enabled = 1 if enabled else 0
		doc.save(ignore_permissions=True)
		if not enabled:
			# The kill switch has to reach sessions already open: Frappe does not
			# re-check `enabled` when it resumes a session (sessions.Session.resume),
			# so without this a disabled officer keeps working until their sid
			# expires. User.check_enable_disable does the same inside a request;
			# this makes it hold from any caller.
			clear_sessions(user=doc.name, force=True)
		access_audit.record(
			actor,
			access_audit.ACCOUNT_ENABLED if enabled else access_audit.ACCOUNT_DISABLED,
			reason=reason,
			subject=doc.name,
			subject_user=doc.name,
			old="disabled" if enabled else "enabled",
			new="enabled" if enabled else "disabled",
		)
		frappe.db.commit()
		_logger().info(f"platform admin {actor} {'enabled' if enabled else 'disabled'} {doc.name}")

	# The portal account is the authority either way; Keycloak is kept in step
	# for staff so the account is dead in both places. A citizen's Keycloak
	# account is the citizen realm's, which this administrator does not manage.
	keycloak = (
		_mirror_to_keycloak(doc.name, enabled) if changed and doc.user_type == "System User" else None
	)
	return {"user": get_user(actor, doc.name), "changed": changed, "keycloak": keycloak}


def reset_password(actor: str, user: str, reason: str) -> dict:
	"""Replace a staff member's password with a new one-time password.

	Whatever they signed in with before stops working, and their open portal
	sessions are ended — a reset is as often "this may be compromised" as "I
	forgot". They are back where a new hire starts: one sign-in with the
	password shown here, then one of their own."""
	reason = _reason(reason)
	doc = _manageable(actor, user)
	if doc.user_type != "System User":
		frappe.throw(_("Citizens manage their password with the e-ID service."))
	if not cint(doc.enabled):
		frappe.throw(_("Enable the account before resetting its password."))
	if not keycloak_admin.is_configured():
		frappe.throw(_("Keycloak account management is not configured on this site."))

	try:
		user_id, _created = keycloak_admin.ensure_account(doc.name, doc.full_name)
		password = _issue_one_time_password(user_id)
	except keycloak_admin.KeycloakAdminError as exc:
		frappe.throw(str(exc))

	clear_sessions(user=doc.name, force=True)
	access_audit.record(
		actor,
		access_audit.ONE_TIME_PASSWORD_ISSUED,
		reason=reason,
		subject=doc.name,
		subject_user=doc.name,
	)
	frappe.db.commit()
	_logger().info(f"platform admin {actor} issued a one-time password for {doc.name}")
	return {
		"user": get_user(actor, doc.name),
		"one_time_password": password,
		"detail": _issued_detail(doc.name),
	}
