"""e-ID sign-in: Keycloak password grant -> Frappe session.

WHAT THIS IS. A citizen types their national e-ID (`123-4567-8901`) and a
password; this module exchanges those with Keycloak for a token, confirms the
token with Keycloak, maps the identity onto a Frappe User and mints the normal
Frappe `sid` session. From `whoami` onwards nothing downstream can tell how the
session was created — every existing endpoint, role check and
`permission_query_conditions` keeps working untouched.

WHY THE e-ID IS THE KEYCLOAK USERNAME. There is no e-ID protocol here. The
account's Keycloak `username` IS the e-ID string, dashes included, which is why
the shape below is shared with the SPA's three-box control (frontend/src/eid.ts
says the same thing in TypeScript). An account created in a shape the sign-in
form cannot type would fail as "incorrect e-ID or password", because that is
what the token endpoint answers for a username it does not know.

WHAT THIS DELIBERATELY DOES NOT DO — read before extending:

  * It does not prove the person typing is the person the e-ID names. An e-ID
    number is an IDENTIFIER, not a secret. Proofing lives upstream (the
    My Guyana broker in docs/architecture/identity-and-auth.md); this path
    trusts whoever provisioned the Keycloak account, exactly as the MPS staff
    portal does. That is defensible for provisioned accounts and is NOT
    sufficient for open citizen self-service lending.
  * It does not grant roles from Keycloak. An auto-provisioned account gets
    `Citizen` and nothing else; staff roles stay a manual Frappe act, so a
    Keycloak identity alone can never confer underwriter rights.
  * It does not keep the Keycloak tokens. They are used once, here, and
    dropped — Frappe's `sid` owns the session afterwards. Consequence, and it
    is the same one Frappe's own social login carries: signing out of Keycloak
    does not kill `sid`.

VERIFYING THE TOKEN. The access token is checked by calling Keycloak's
`userinfo` with it rather than by validating the signature locally. This
backend asked Keycloak for the token directly a moment earlier over a trusted
channel — it is not accepting a token from an untrusted caller — so the
signature check would be re-proving something we already know, at the cost of a
JWKS cache and key-rotation handling. `userinfo` rejects a forged, expired or
revoked token with a 401, and it is the same call Frappe's own OAuth path makes
(`frappe/utils/oauth.py::get_info_via_oauth`).
"""

import logging
import os
import re

import frappe
import requests
from frappe import _
from frappe.rate_limiter import rate_limit

# 3 / 4 / 4 — the e-ID's own grouping. DASHES INCLUDED: the SPA joins its three
# boxes with '-' and submits that combined string as the Keycloak username, so
# this is the stored form too. Mirrored in frontend/src/eid.ts.
EID_PART_LENGTHS = (3, 4, 4)
EID_SHAPE = re.compile(r"^\d{3}-\d{4}-\d{4}$")

# The custom field on User that carries the link (install.USER_CUSTOM_FIELDS).
EID_FIELD = "gdb_eid"

_HTTP_TIMEOUT = 10


def _logger() -> logging.Logger:
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger


def _conf(key: str, env: str) -> str:
	"""site_config first, environment second. Compose passes the environment;
	a deployed site pins it in site_config and needs no container change."""
	return (frappe.conf.get(key) or os.environ.get(env) or "").strip()


# TWO POPULATIONS, TWO REALMS — see the "Which realm" note in the module
# docstring. STAFF is tried first and never provisions; CITIZEN provisions.
STAFF = "staff"
CITIZEN = "citizen"


def keycloak_settings(population: str = CITIZEN) -> dict | None:
	"""The Keycloak connection for one population, or None when unconfigured.

	Returning None rather than throwing lets the caller say "not configured"
	once, plainly, instead of every caller inventing its own wording. The staff
	realm falls back to the citizen realm's HOST — the common deployment is one
	Keycloak serving two realms — but never to its realm or client, because
	sharing those would silently make every citizen a staff candidate."""
	if population == STAFF:
		base = (
			_conf("keycloak_staff_url", "KEYCLOAK_STAFF_URL")
			or _conf("keycloak_url", "KEYCLOAK_URL")
		).rstrip("/")
		realm = _conf("keycloak_staff_realm", "KEYCLOAK_STAFF_REALM")
		client_id = _conf("keycloak_staff_client_id", "KEYCLOAK_STAFF_CLIENT_ID")
		secret = _conf("keycloak_staff_client_secret", "KEYCLOAK_STAFF_CLIENT_SECRET")
	else:
		base = _conf("keycloak_url", "KEYCLOAK_URL").rstrip("/")
		realm = _conf("keycloak_realm", "KEYCLOAK_REALM")
		client_id = _conf("keycloak_client_id", "KEYCLOAK_CLIENT_ID")
		secret = _conf("keycloak_client_secret", "KEYCLOAK_CLIENT_SECRET")

	if not (base and realm and client_id):
		return None
	oidc = f"{base}/realms/{realm}/protocol/openid-connect"
	return {
		"population": population,
		"base": base,
		"realm": realm,
		"client_id": client_id,
		# Public clients have none; a confidential client must send one.
		"client_secret": secret,
		"token_url": f"{oidc}/token",
		"userinfo_url": f"{oidc}/userinfo",
	}


def normalize_eid(value: str | None) -> str:
	"""Accept what a human might paste — spaces, en/em dashes, bare digits —
	and answer the one canonical `123-4567-8901`. Anything that is not twelve
	digits comes back unchanged so the caller's shape check can reject it."""
	raw = (value or "").strip()
	if not raw:
		return ""
	digits = re.sub(r"\D", "", raw)
	if len(digits) != sum(EID_PART_LENGTHS):
		return raw
	a, b, c = EID_PART_LENGTHS
	return f"{digits[:a]}-{digits[a : a + b]}-{digits[a + b : a + b + c]}"


@frappe.whitelist(allow_guest=True)
def eid_login_available() -> dict:
	"""Whether this site can do e-ID sign-in at all.

	The SPA renders the e-ID form either way — a site with Keycloak switched
	off should say so out loud rather than quietly hide the control — but the
	login page uses this to explain itself before the citizen types eleven
	digits and a password for nothing."""
	citizen = keycloak_settings(CITIZEN)
	staff = keycloak_settings(STAFF)
	return {
		"available": bool(citizen or staff),
		"citizen_realm": citizen["realm"] if citizen else None,
		"staff_realm": staff["realm"] if staff else None,
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(key="eid", limit=8, seconds=60)
def password_login(eid: str, password: str) -> dict:
	"""Sign in with an e-ID and password. Sets the `sid` cookie on success.

	Rate-limited per e-ID: this path deliberately bypasses Frappe's own
	`track_login_attempts` (that guards `/api/method/login`, which we never
	reach), and eleven digits are guessable in a way an email address is not.
	"""
	eid = normalize_eid(eid)
	password = password or ""

	if not EID_SHAPE.match(eid):
		frappe.throw(_("Enter your e-ID as 3, then 4, then 4 digits."))
	if not password:
		frappe.throw(_("Password is required."))

	staff = keycloak_settings(STAFF)
	citizen = keycloak_settings(CITIZEN)
	if not (staff or citizen):
		frappe.throw(_("e-ID sign-in is not configured on this site."))

	# STAFF FIRST, and the order is a decision, not an accident. The government
	# directory is the smaller, manually curated, higher-privilege population;
	# trying it first means a government persona is recognised AS one rather
	# than falling through and being met as an ordinary citizen.
	#
	# One person, one national e-ID, one Frappe User. Which realm answers says
	# what KIND of identity this is, not which account: a government employee
	# who also borrows holds Citizen alongside their staff role on that single
	# User, and the self-review guard in api.review_loan is what keeps the two
	# capacities from colluding.
	asked_someone = False

	for settings in (staff, citizen):
		if not settings:
			continue
		try:
			token = _request_token(settings, eid, password)
		except _Unreachable:
			# A staff realm that is down must not lock citizens out of their
			# own, healthy realm — skip it and carry on.
			continue
		asked_someone = True
		if not token:
			continue

		info = _userinfo(settings, token)
		if settings["population"] == STAFF:
			return _establish(
				eid,
				_resolve_staff_user(eid, info),
				created=False,
				realm=settings["realm"],
				claims=info,
			)
		user, created = _resolve_user(eid, info)
		return _establish(
			eid, user, created=created, realm=settings["realm"], claims=info
		)

	if not asked_someone:
		frappe.throw(_("Could not reach the sign-in service. Please try again."))

	# Every reachable realm said no. Same answer either way — see the note in
	# _request_token about not revealing which e-IDs exist.
	frappe.throw(_("Incorrect e-ID or password."), frappe.AuthenticationError)


def _establish(eid: str, user: str, *, created: bool, realm: str, claims: dict | None = None) -> dict:
	"""Mint the Frappe session and describe who just signed in."""
	# The kill switch that works even when Keycloak still authenticates:
	# disabling the Frappe User ends portal access immediately, with no
	# round trip to the identity provider.
	if not frappe.db.get_value("User", user, "enabled"):
		frappe.throw(_("This account is disabled. Please contact the Bank."), frappe.AuthenticationError)

	frappe.local.login_manager.login_as(user)
	frappe.db.commit()
	_logger().info(f"eid login [{realm}]: {eid} -> {user}{' (provisioned)' if created else ''}")

	# TWO THINGS THE E-ID MAKES POSSIBLE, both done here because this is the one
	# moment the portal holds a directory assertion about this person.
	#
	# The claims are recorded as the verified half of their profile — kept
	# apart from what they themselves declare, never merged (gdb_bank/profiles).
	#
	# And any cluster invitation raised against this e-ID before they had an
	# account is attached to the User it turns out to be. A head can therefore
	# invite somebody who has never signed in, which is the ordinary case in a
	# programme reaching people who are not online yet.
	from gdb_bank.api import _is_finance, _is_underwriter, link_pending_invitations
	from gdb_bank.profiles import record_identity_claims

	if claims:
		record_identity_claims(user, eid, claims)
	link_pending_invitations(user, eid)

	return {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		"roles": frappe.get_roles(user),
		"is_underwriter": _is_underwriter(user),
		"is_finance": _is_finance(user),
		"provisioned": created,
		"realm": realm,
	}


class _Unreachable(Exception):
	"""This realm could not be contacted at all — distinct from it saying no.

	Worth its own type: with two realms configured, a staff Keycloak that is
	down must not turn into "Incorrect e-ID or password" for a citizen whose
	own realm is perfectly healthy. The caller skips the realm and remembers
	that nobody could be asked."""


def _request_token(settings: dict, eid: str, password: str) -> str | None:
	"""The OAuth2 resource-owner password grant against ONE realm.

	Answers the access token, or None when this realm simply does not accept
	those credentials — which is the signal to try the next one. Real
	misconfiguration still throws, because falling through on a broken client
	would hide the breakage behind a wrong-password message.

	Needs "Direct access grants" enabled on the Keycloak client, which is off
	by default for new clients."""
	data = {
		"grant_type": "password",
		"client_id": settings["client_id"],
		"username": eid,
		"password": password,
		"scope": "openid profile email",
	}
	if settings["client_secret"]:
		data["client_secret"] = settings["client_secret"]

	try:
		res = requests.post(settings["token_url"], data=data, timeout=_HTTP_TIMEOUT)
	except requests.RequestException as exc:
		_logger().error(f"keycloak [{settings['realm']}] unreachable: {exc}")
		raise _Unreachable from exc

	if res.status_code == 200:
		access_token = (res.json() or {}).get("access_token")
		if not access_token:
			frappe.throw(_("The sign-in service returned no token."))
		return access_token

	body = {}
	try:
		body = res.json()
	except ValueError:
		pass
	error = body.get("error", "")
	description = body.get("error_description", "")

	if res.status_code in (400, 401) and error == "invalid_grant":
		# The one case worth distinguishing: the account exists and the
		# password was right, but Keycloak wants something done first
		# (verify email, set a new password). "Incorrect e-ID or password"
		# would send the citizen hunting for a typo that isn't there.
		if "not fully set up" in description.lower():
			frappe.throw(
				_("This e-ID account needs to be completed before you can sign in. Please contact the Bank."),
				frappe.AuthenticationError,
			)
		# Keycloak says `invalid_grant` both for a wrong password and for an
		# e-ID it has never heard of, and we keep that ambiguity: telling the
		# caller which it was tells an attacker which e-IDs exist. It is also
		# exactly what lets the next realm have its turn.
		return None

	if error == "unauthorized_client":
		_logger().error(f"keycloak client {settings['client_id']}: direct access grants disabled")
		frappe.throw(_("e-ID sign-in is not enabled for this portal. Please contact the Bank."))

	_logger().error(f"keycloak token endpoint [{settings['realm']}] {res.status_code}: {error} {description}")
	frappe.throw(_("Sign-in failed. Please try again."))


def _userinfo(settings: dict, token: str) -> dict:
	"""Confirm the token with Keycloak and read the profile off it."""
	try:
		res = requests.get(
			settings["userinfo_url"],
			headers={"Authorization": f"Bearer {token}"},
			timeout=_HTTP_TIMEOUT,
		)
	except requests.RequestException as exc:
		_logger().error(f"keycloak userinfo unreachable: {exc}")
		frappe.throw(_("Could not reach the sign-in service. Please try again."))

	if res.status_code != 200:
		_logger().error(f"keycloak userinfo {res.status_code}")
		frappe.throw(_("Sign-in failed. Please try again."), frappe.AuthenticationError)
	return res.json()


def _full_name(info: dict, fallback: str) -> str:
	name = (info.get("name") or "").strip()
	if name:
		return name
	parts = [(info.get("given_name") or "").strip(), (info.get("family_name") or "").strip()]
	return " ".join(p for p in parts if p) or fallback


def _resolve_staff_user(eid: str, info: dict) -> str:
	"""Find the Frappe User a GOVERNMENT identity speaks for. Never creates one.

	THIS IS THE WHOLE POINT OF SPLITTING THE REALMS. Being in the government
	directory proves employment by the state; it says nothing about whether the
	Bank has given that person access, still less what they may do here. So a
	staff sign-in REQUIRES an account somebody at GDB provisioned deliberately,
	and refuses outright otherwise — a new ministry hire cannot appear in the
	loan portal merely by existing.

	Whatever roles that pre-provisioned User holds are what they get. A
	government officer who also borrows holds `Citizen` alongside their staff
	role on this one User; api.review_loan is what stops those two capacities
	from meeting on the same application.
	"""
	email = (info.get("email") or "").strip().lower()
	if not email:
		frappe.throw(_("This e-ID account has no email address on file. Please contact the Bank."))

	user = frappe.db.get_value("User", {EID_FIELD: eid}, "name") or (
		email if frappe.db.exists("User", email) else None
	)
	if not user:
		_logger().info(f"staff eid {eid} ({email}) authenticated but has no GDB account")
		frappe.throw(
			_("Your government account is recognised, but it has not been granted access to the Bank portal. Please contact GDB."),
			frappe.AuthenticationError,
		)

	# Stamp the link on first arrival so later sign-ins resolve by e-ID, and
	# refuse the case where this mailbox already answers to a different one.
	existing = frappe.db.get_value("User", user, EID_FIELD)
	if existing and existing != eid:
		_logger().error(f"staff eid conflict: {user} holds {existing}, {eid} presented")
		frappe.throw(_("This account is already linked to a different e-ID. Please contact the Bank."))
	if not existing:
		frappe.db.set_value("User", user, EID_FIELD, eid)
		frappe.db.commit()
		_logger().info(f"staff eid linked: {eid} -> {user}")
	return user


def _resolve_user(eid: str, info: dict) -> tuple[str, bool]:
	"""Find — or create — the Frappe User this CITIZEN e-ID speaks for.

	Returns (user, created). Three cases, in order: the e-ID is already linked;
	the person exists under this email and is meeting us with an e-ID for the
	first time (LINK, never duplicate — one person must not end up with two
	portal identities holding half their loans each); nobody yet, so provision.
	"""
	email = (info.get("email") or "").strip().lower()
	if not email:
		# Frappe keys User on email and cannot mint a session without one.
		frappe.throw(_("This e-ID account has no email address on file. Please contact the Bank."))

	linked = frappe.db.get_value("User", {EID_FIELD: eid}, "name")
	if linked:
		return linked, False

	if frappe.db.exists("User", email):
		# Guard the other direction too: this email must not already answer to
		# a DIFFERENT e-ID, or two Keycloak accounts would share one login.
		existing = frappe.db.get_value("User", email, EID_FIELD)
		if existing and existing != eid:
			_logger().error(f"eid conflict: {email} holds {existing}, {eid} presented")
			frappe.throw(_("This account is already linked to a different e-ID. Please contact the Bank."))
		frappe.db.set_value("User", email, EID_FIELD, eid)
		frappe.db.commit()
		_logger().info(f"eid linked to existing user: {eid} -> {email}")
		return email, False

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": _full_name(info, email),
			"user_type": "Website User",
			"send_welcome_email": 0,
			"enabled": 1,
			EID_FIELD: eid,
		}
	).insert(ignore_permissions=True)
	# Citizen and only Citizen. Staff access is a deliberate manual grant in
	# Frappe — see the module docstring.
	user.add_roles("Citizen")
	frappe.db.commit()
	return user.name, True
