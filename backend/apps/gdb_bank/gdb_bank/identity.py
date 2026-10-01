"""Keycloak sign-in: password grant -> Frappe session, for both populations.

WHAT THIS IS. Keycloak authenticates everybody; there are two doors, one realm
each:

  password_login(eid, password)    citizen realm — a citizen's national e-ID
                                   (`123-4567-8901`) is their username. First
                                   sign-in links or provisions a citizen account.
  staff_login(email, password)     staff realm — a GDB work email is the
                                   username. NEVER provisions: the account must
                                   already exist, created by the platform
                                   administrator (services/accounts.py).
  staff_set_password(email,        staff realm, first sign-in only: the
    password, new_password)        one-time password the administrator was
                                   shown is swapped for the person's own, then
                                   they are signed in as staff_login would.

Either way this module exchanges the credentials with Keycloak for a token,
confirms the token with Keycloak, maps the identity onto a Frappe User and
mints the normal Frappe `sid` session. From `whoami` onwards nothing downstream
can tell how the session was created — every existing endpoint, role check and
`permission_query_conditions` keeps working untouched.

WHICH DOOR MAY OPEN WHICH ACCOUNT is security/sign_in_policy.py: the e-ID door
never lands on a staff account and the staff door never lands on a citizen's.
It is checked here before anything is linked, and again at Frappe's on_login.

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
    `Citizen` and nothing else; staff roles are granted only by the platform
    administrator (services/accounts.py), so a
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

import frappe
import requests
from frappe import _
from frappe.rate_limiter import rate_limit

from gdb_bank.integrations import keycloak_admin
from gdb_bank.integrations import settings as integration_settings
from gdb_bank.security import sign_in_policy
from gdb_bank.services import access_audit
from gdb_bank.utils.eid import EID_FIELD, EID_SHAPE, normalize_eid
from gdb_bank.utils.session import (
	_is_disbursement,
	_is_facilitator,
	_is_field_officer,
	_is_finance,
	_is_platform_admin,
	_is_underwriter,
	_logger,
)

_HTTP_TIMEOUT = 10

# The password a staff member chooses to replace their one-time password.
# Keycloak's own realm policy, if it has one, applies on top.
NEW_PASSWORD_MIN = 12
NEW_PASSWORD_MAX = 128


def _conf(key: str) -> str:
	"""The portal's integration settings first, then site_config, then the
	environment — integrations/settings.py decides, for every adapter alike."""
	return integration_settings.get(key)


# TWO POPULATIONS, TWO REALMS, TWO DOORS — see the module docstring. CITIZEN
# provisions on first sign-in; STAFF never does.
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
		base = (_conf("keycloak_staff_url") or _conf("keycloak_url")).rstrip("/")
		realm = _conf("keycloak_staff_realm")
		client_id = _conf("keycloak_staff_client_id")
		secret = _conf("keycloak_staff_client_secret")
	else:
		base = _conf("keycloak_url").rstrip("/")
		realm = _conf("keycloak_realm")
		client_id = _conf("keycloak_client_id")
		secret = _conf("keycloak_client_secret")

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



@frappe.whitelist(allow_guest=True)
def eid_login_available() -> dict:
	"""Which of the two Keycloak doors this site has configured.

	The SPA renders both forms either way — a site with Keycloak switched off
	should say so out loud rather than quietly hide the control — but the login
	page uses this to explain itself before anybody types a password for
	nothing. `available` is the citizen e-ID door."""
	citizen = keycloak_settings(CITIZEN)
	staff = keycloak_settings(STAFF)
	return {
		"available": bool(citizen),
		"citizen_realm": citizen["realm"] if citizen else None,
		"staff_available": bool(staff),
		"staff_realm": staff["realm"] if staff else None,
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="eid", limit=8, seconds=60)
def password_login(eid: str, password: str) -> dict:
	"""Citizen sign-in: e-ID and password against the citizen realm. Sets the
	`sid` cookie on success.

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

	citizen = keycloak_settings(CITIZEN)
	if not citizen:
		frappe.throw(_("e-ID sign-in is not configured on this site."))

	try:
		token = _request_token(citizen, eid, password)
	except _Unreachable:
		frappe.throw(_("Could not reach the sign-in service. Please try again."))
	if not token:
		# Same answer for a wrong password and an unknown e-ID — see the note in
		# _request_token about not revealing which e-IDs exist.
		frappe.throw(_("Incorrect e-ID or password."), frappe.AuthenticationError)

	info = _userinfo(citizen, token)
	user, created = _resolve_user(eid, info)
	return _establish(eid, user, created=created, realm=citizen["realm"], claims=info)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="email", limit=8, seconds=60)
def staff_login(email: str, password: str) -> dict:
	"""GDB staff sign-in: work email and password against the STAFF realm.

	Never provisions. Being able to authenticate to the staff realm proves the
	person holds a Keycloak account there; it says nothing about what the Bank
	lets them do. The Frappe account — and the roles on it — must already have
	been created by the platform administrator, so a Keycloak account alone can
	never open the portal. Rate-limited per email, like the e-ID door.

	A ONE-TIME password answers `{"password_change_required": true}` and opens
	no session: the SPA then asks for the person's own password and sends both
	to staff_set_password. Keycloak only says so once the password is right, so
	this reveals nothing a wrong guess would not.
	"""
	email = (email or "").strip().lower()
	password = password or ""
	if not email or "@" not in email:
		frappe.throw(_("Enter your GDB work email."))
	if not password:
		frappe.throw(_("Password is required."))

	staff = keycloak_settings(STAFF)
	if not staff:
		frappe.throw(_("Staff sign-in is not configured on this site."))

	try:
		token = _request_token(staff, email, password)
	except _Unreachable:
		frappe.throw(_("Could not reach the sign-in service. Please try again."))
	except _PasswordChangeRequired:
		return {"password_change_required": True}
	if not token:
		frappe.throw(_("Incorrect email or password."), frappe.AuthenticationError)

	return _open_staff_session(staff, email, token)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="email", limit=8, seconds=60)
def staff_set_password(email: str, password: str, new_password: str) -> dict:
	"""First staff sign-in: replace the one-time password with the person's own.

	`password` is the one-time password the administrator was shown. Keycloak
	holds it as temporary, so it proves who is here and does nothing else; it
	is checked with Keycloak BEFORE anything changes. The account must be one
	the portal would open, and must actually be waiting on a new password —
	this is not a general change-password door. The new password is saved as
	permanent, which clears Keycloak's pending action, and the person is signed
	in with it exactly as staff_login would. Neither password is logged or
	stored on GDB's side; the access trail records that it happened.
	"""
	email = (email or "").strip().lower()
	password = password or ""
	new_password = new_password or ""
	if not email or "@" not in email:
		frappe.throw(_("Enter your GDB work email."))
	if not password:
		frappe.throw(_("Enter the one-time password GDB gave you."))
	_check_new_password(email, password, new_password)

	staff = keycloak_settings(STAFF)
	if not staff:
		frappe.throw(_("Staff sign-in is not configured on this site."))
	if not keycloak_admin.is_configured():
		frappe.throw(_("Choosing a password is not available on this site. Please contact GDB."))

	try:
		token = _request_token(staff, email, password)
	except _Unreachable:
		frappe.throw(_("Could not reach the sign-in service. Please try again."))
	except _PasswordChangeRequired:
		token = None
	else:
		if token:
			frappe.throw(_("Your password is already set. Sign in with it."))
		frappe.throw(_("Incorrect email or one-time password."), frappe.AuthenticationError)

	# The one-time password is proven. Nothing is changed for an account the
	# portal would refuse to open anyway.
	if not frappe.db.exists("User", email):
		frappe.throw(
			_("Your account is recognised, but it has not been granted access to the Bank portal. Please contact GDB."),
			frappe.AuthenticationError,
		)
	refusal = sign_in_policy.refusal(email, sign_in_policy.STAFF)
	if refusal:
		frappe.throw(refusal, frappe.AuthenticationError)
	_check_enabled(email)

	try:
		account = keycloak_admin.sign_in_account(email)
		if not account or "UPDATE_PASSWORD" not in account["required_actions"]:
			# Pending on something other than a new password (a profile step,
			# say): not this door's to clear.
			frappe.throw(_("This account needs to be completed before you can sign in. Please contact GDB."))
		keycloak_admin.set_password(account["id"], new_password, temporary=False)
	except keycloak_admin.PasswordRejected as exc:
		frappe.throw(str(exc))
	except keycloak_admin.KeycloakAdminError:
		frappe.throw(_("Your new password could not be saved. Please try again."))

	access_audit.record(
		email,
		access_audit.PASSWORD_CHOSEN,
		reason=_("Replaced the one-time password at first sign-in."),
		subject=email,
		subject_user=email,
	)
	frappe.db.commit()
	_logger().info(f"staff password chosen [{staff['realm']}]: {email}")

	try:
		token = _request_token(staff, email, new_password)
	except (_Unreachable, _PasswordChangeRequired):
		token = None
	if not token:
		frappe.throw(_("Your new password is set. Sign in with it."))
	return _open_staff_session(staff, email, token)


def _check_new_password(email: str, one_time: str, new_password: str) -> None:
	if len(new_password) < NEW_PASSWORD_MIN:
		frappe.throw(_("Choose a password of at least {0} characters.").format(NEW_PASSWORD_MIN))
	if len(new_password) > NEW_PASSWORD_MAX:
		frappe.throw(_("Choose a password of at most {0} characters.").format(NEW_PASSWORD_MAX))
	if new_password == one_time:
		frappe.throw(_("Choose a password of your own, not the one-time password."))
	if new_password.strip().lower() == email:
		frappe.throw(_("Your password cannot be your email address."))


def _open_staff_session(staff: dict, email: str, token: str) -> dict:
	"""The part of a staff sign-in after Keycloak has said yes."""
	info = _userinfo(staff, token)
	user = _resolve_staff_user(email, info)
	_check_enabled(user)
	sign_in_policy.mark(sign_in_policy.STAFF)
	frappe.local.login_manager.login_as(user)
	frappe.db.commit()
	_logger().info(f"staff login [{staff['realm']}]: {user}")
	return _session_summary(user, realm=staff["realm"], provisioned=False)


def _check_enabled(user: str) -> None:
	# The kill switch that works even when Keycloak still authenticates:
	# disabling the Frappe User ends portal access immediately, with no round
	# trip to the identity provider.
	if not frappe.db.get_value("User", user, "enabled"):
		frappe.throw(_("This account is disabled. Please contact the Bank."), frappe.AuthenticationError)


def _session_summary(user: str, *, realm: str, provisioned: bool) -> dict:
	return {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		"roles": frappe.get_roles(user),
		"is_underwriter": _is_underwriter(user),
		"is_finance": _is_finance(user),
		"is_disbursement": _is_disbursement(user),
		"is_platform_admin": _is_platform_admin(user),
		"is_facilitator": _is_facilitator(user),
		"is_field_officer": _is_field_officer(user),
		"provisioned": provisioned,
		"realm": realm,
	}


def _establish(eid: str, user: str, *, created: bool, realm: str, claims: dict | None = None) -> dict:
	"""Mint the Frappe session for a citizen and describe who just signed in."""
	_check_enabled(user)

	sign_in_policy.mark(sign_in_policy.EID)
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
	from gdb_bank.profiles import record_identity_claims
	from gdb_bank.services.cluster import link_pending_invitations

	if claims:
		record_identity_claims(user, eid, claims)
	link_pending_invitations(user, eid)

	return _session_summary(user, realm=realm, provisioned=created)


class _Unreachable(Exception):
	"""The realm could not be contacted at all — distinct from it saying no.

	Worth its own type: "Could not reach the sign-in service" and "Incorrect
	password" send a person to do different things, and an outage must never
	read as a wrong password."""


class _PasswordChangeRequired(Exception):
	"""A STAFF password was right, but it is a one-time password Keycloak will
	only accept as the key to choosing a new one."""


def _request_token(settings: dict, username: str, password: str) -> str | None:
	"""The OAuth2 resource-owner password grant against ONE realm.

	`username` is the e-ID in the citizen realm and the work email in the staff
	realm. Answers the access token, or None when the realm does not accept
	those credentials. Real misconfiguration still throws, because a broken
	client must not hide behind a wrong-password message.

	Needs "Direct access grants" enabled on the Keycloak client, which is off
	by default for new clients."""
	data = {
		"grant_type": "password",
		"client_id": settings["client_id"],
		"username": username,
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
		# (verify email, set a new password). "Incorrect password" would send
		# the person hunting for a typo that isn't there.
		if "not fully set up" in description.lower():
			if settings["population"] == STAFF:
				# A one-time password from the administrator (services/accounts.py):
				# the caller decides what that means for its door.
				raise _PasswordChangeRequired
			frappe.throw(
				_("This e-ID account needs to be completed before you can sign in. Please contact the Bank."),
				frappe.AuthenticationError,
			)
		# Keycloak says `invalid_grant` both for a wrong password and for a
		# username it has never heard of, and we keep that ambiguity: telling
		# the caller which it was tells an attacker which accounts exist.
		return None

	if error == "unauthorized_client":
		_logger().error(f"keycloak client {settings['client_id']}: direct access grants disabled")
		frappe.throw(_("Sign-in is not enabled for this portal. Please contact the Bank."))

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


def _resolve_staff_user(email: str, info: dict) -> str:
	"""Find the Frappe account a STAFF-realm identity speaks for. Never creates one.

	THIS IS THE WHOLE POINT OF A SEPARATE REALM. Holding a staff-realm Keycloak
	account proves the person can authenticate there; it says nothing about
	whether the Bank has given them access, still less what they may do. So a
	staff sign-in REQUIRES an account the platform administrator created, and
	refuses outright otherwise.

	The work email typed must be the email Keycloak vouches for: a realm that
	also accepts usernames must not let one person's username open another
	person's mailbox-named account.
	"""
	vouched = (info.get("email") or "").strip().lower()
	if vouched != email:
		_logger().error(f"staff login: typed {email}, keycloak vouched for {vouched or 'no email'}")
		frappe.throw(_("Incorrect email or password."), frappe.AuthenticationError)

	if not frappe.db.exists("User", email):
		_logger().info(f"staff login: {email} authenticated but has no GDB account")
		frappe.throw(
			_("Your account is recognised, but it has not been granted access to the Bank portal. Please contact GDB."),
			frappe.AuthenticationError,
		)
	refusal = sign_in_policy.refusal(email, sign_in_policy.STAFF)
	if refusal:
		frappe.throw(refusal, frappe.AuthenticationError)
	return email


def _refuse_staff_account(user: str) -> None:
	refusal = sign_in_policy.refusal(user, sign_in_policy.EID)
	if refusal:
		_logger().warning(f"eid sign-in refused onto staff account {user}")
		frappe.throw(refusal, frappe.AuthenticationError)


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
		_refuse_staff_account(linked)
		return linked, False

	if frappe.db.exists("User", email):
		# Never link a citizen e-ID onto a STAFF account. Linking is by email,
		# and a citizen Keycloak account carrying a staff mailbox would
		# otherwise sign in as that officer. Refused before anything is written.
		_refuse_staff_account(email)
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
