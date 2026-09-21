"""Keycloak -> Frappe identity mapping (Phase 1).

Keycloak is the authority on WHO someone is and WHAT REALM ROLES they hold.
Frappe is the authority on what those roles may do. This module is the seam,
and it is entirely registry-driven: `personas.keycloak_role_map()` decides
which Frappe role a realm role grants, so onboarding a new persona to Keycloak
is the same one-line registry edit as everything else.

THE KILL SWITCH
    The implementation plan's Phase 1 validation is that disabling a user in
    Keycloak immediately stops them working in Frappe. Two mechanisms:

      * Tokens are short-lived and Keycloak refuses to reissue for a disabled
        user, so `exchange_token` fails at the next refresh.
      * `sync_identity()` runs on EVERY session creation and revokes every GDB
        role the token no longer carries. A user disabled mid-session keeps a
        Frappe session cookie until it expires, so `enforce_kill_switch()` is
        also called from the session hook to disable the Frappe user outright.

    Belt and braces, because a stale session on a revoked account is exactly
    the failure this phase exists to prevent.

WHAT THIS MODULE MUST NEVER DO
    Trust a role claim the SPA sends. Roles come from a signed token verified
    against Keycloak's JWKS, never from a request body.
"""

from __future__ import annotations

import os
from typing import Any

import frappe
from frappe.utils import cint

from gdb_bank.domain import events as ev
from gdb_bank.rbac import personas as reg
from gdb_bank.security import eid as eid_mod
from gdb_bank.security import errors

KEYCLOAK_URL = os.environ.get("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "Guyana-Gov")
KEYCLOAK_CLIENT_ID = os.environ.get("KEYCLOAK_CLIENT_ID", "gdb-portal")
KEYCLOAK_TIMEOUT = cint(os.environ.get("KEYCLOAK_TIMEOUT_SECONDS") or 5)

_JWKS_CACHE_KEY = "gdb_bank:keycloak_jwks"
_JWKS_TTL_SECONDS = 3600


KEYCLOAK_PUBLIC_URL = os.environ.get("KEYCLOAK_PUBLIC_URL") or KEYCLOAK_URL
"""Where the BROWSER reaches Keycloak, which is not where this container does.

In compose the backend talks to `http://keycloak:8080` over the docker network,
while the citizen's browser must be sent to `http://localhost:8086`. Issuing a
redirect to the internal name produces a hostname the browser cannot resolve -
a sign-in button that goes nowhere, with nothing in any log. Deployments where
both are the same URL simply leave this unset.
"""


def internal_realm_url() -> str:
	"""The realm as THIS CONTAINER reaches it. Backchannel calls only - JWKS,
	the admin API, the service-account token."""
	return f"{KEYCLOAK_URL.rstrip('/')}/realms/{KEYCLOAK_REALM}"


def issuer() -> str:
	"""The value that actually appears in a token's `iss`, and therefore the
	one `verify_token` must check against.

	THIS IS THE PUBLIC URL, NOT THE INTERNAL ONE, and the distinction has bitten
	before. Keycloak stamps `iss` with its *frontend* hostname - `KC_HOSTNAME`,
	which compose sets to `http://localhost:8085`. The backend reaching it at
	`http://keycloak:8080` over the docker network does not change what the
	token says. Validating against the internal name rejects every genuine
	token with `InvalidIssuerError`, which `verify_token` reports as the same
	generic "could not be verified" that a forged token produces.
	"""
	return f"{KEYCLOAK_PUBLIC_URL.rstrip('/')}/realms/{KEYCLOAK_REALM}"


def public_config() -> dict:
	"""Everything the SPA needs to run the PKCE dance, and nothing else.

	The SPA must not hardcode a Keycloak URL, for the same reason
	`project_overview.md` section 6 forbids hardcoding policy figures in
	frontend content: the value differs per environment and a stale copy in a
	built bundle is not something anyone notices until a citizen cannot sign in.

	`configured` is false when no identity service is reachable at all, so the
	login page can say so plainly instead of redirecting into a dead host.
	"""
	oidc = f"{issuer()}/protocol/openid-connect"
	return {
		"configured": bool(KEYCLOAK_PUBLIC_URL and KEYCLOAK_REALM and KEYCLOAK_CLIENT_ID),
		"issuer": issuer(),
		"realm": KEYCLOAK_REALM,
		"client_id": KEYCLOAK_CLIENT_ID,
		"authorize_url": f"{oidc}/auth",
		"token_url": f"{oidc}/token",
		"end_session_url": f"{oidc}/logout",
	}


# ---------------------------------------------------------------------------
# The id_token, held for logout
# ---------------------------------------------------------------------------

_ID_TOKEN_CACHE_PREFIX = "gdb_bank:id_token:"
_ID_TOKEN_TTL_SECONDS = 12 * 3600


def remember_id_token(sid: str, id_token: str | None) -> None:
	"""Stash the id_token for this Frappe session, so `sign_out` can send it
	back to Keycloak as `id_token_hint`.

	WHY THE SERVER HOLDS THIS AND NOT THE SPA
	    An id_token carries `name`, `email` and `eid` - PII, in a form anything
	    with browser access can read. CLAUDE.md section 1 forbids PII in
	    `localStorage`, `sessionStorage` and `IndexedDB` outright, so the SPA
	    keeping it between sign-in and sign-out is not available to us. Holding
	    it server-side against the session keeps the citizen's own claims off
	    their disk and out of any later XSS.

	WHY IT IS NEEDED AT ALL
	    RP-initiated logout without `id_token_hint` makes Keycloak render a
	    "Do you want to log out?" confirmation page, because it cannot tell
	    which session the request means. A citizen who closes the tab at that
	    page instead of clicking through keeps their Keycloak session - which
	    is the exact failure `api/v1_identity.sign_out` exists to prevent, on
	    the exact shared machine its docstring is worried about.

	Cache rather than a DocType: it is session-scoped, worthless after logout
	and must not outlive the session it belongs to. The TTL is a backstop for
	sessions that are never signed out of.
	"""
	if not sid or not id_token:
		return
	frappe.cache().set_value(
		f"{_ID_TOKEN_CACHE_PREFIX}{sid}", id_token, expires_in_sec=_ID_TOKEN_TTL_SECONDS
	)


def forget_id_token(sid: str) -> str | None:
	"""Take the id_token back out, and delete it in the same breath.

	Read-and-delete rather than read-then-maybe-delete: sign-out is the only
	consumer, it happens once, and a hint left in the cache after the session
	it names is gone is just a stale copy of someone's claims.
	"""
	if not sid:
		return None
	key = f"{_ID_TOKEN_CACHE_PREFIX}{sid}"
	token = frappe.cache().get_value(key)
	frappe.cache().delete_value(key)
	return token


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------


def _jwks() -> dict:
	"""Keycloak's signing keys, cached. Fetched with an explicit timeout -
	CLAUDE.md forbids calling an external API without one."""
	cached = frappe.cache().get_value(_JWKS_CACHE_KEY)
	if cached:
		return cached

	import requests

	url = f"{internal_realm_url()}/protocol/openid-connect/certs"
	try:
		response = requests.get(url, timeout=KEYCLOAK_TIMEOUT)
		response.raise_for_status()
	except Exception:
		frappe.log_error(title="gdb_bank: could not fetch Keycloak JWKS")
		errors.throw(
			errors.UpstreamUnavailable,
			"The identity service is temporarily unavailable. Please try again.",
		)

	keys = response.json()
	frappe.cache().set_value(_JWKS_CACHE_KEY, keys, expires_in_sec=_JWKS_TTL_SECONDS)
	return keys


def verify_token(token: str) -> dict:
	"""Verify a Keycloak-issued JWT and return its claims.

	Signature, issuer, audience, authorized party and expiry are all checked. A
	token that fails any of them yields 401 - never a partial trust.

	WHY `azp` IS CHECKED AS WELL AS `aud`
	    Keycloak does not put a public client's own id in `aud` on its own: that
	    claim is filled by the Audience Resolve mapper from the *client roles* a
	    user holds, and `gdb-portal` defines none. The seeder therefore adds an
	    explicit audience mapper (GDB_AUDIENCE_MAPPER) - but a realm where that
	    mapper is missing or has been edited away must fail CLOSED, and it must
	    fail in a way somebody can diagnose.

	    `azp` ("authorized party") names the client the token was actually
	    minted for, and Keycloak always sets it. Asserting it means a token
	    issued to some *other* client in the same realm is refused even if that
	    client's audience list happens to include us.

	    The assertion is UNCONDITIONAL. `if claims.get("azp") and ...` reads as
	    "check it when it is there", which is the shape of a control that fails
	    open: a token carrying no `azp` at all skips the one check that exists
	    for the realm whose audience mapper is gone. Absent is not "nothing to
	    check" - it is a claim we cannot verify, from an issuer that is
	    documented to always send it, and it is refused.
	"""
	try:
		import jwt
		from jwt import PyJWKClient  # noqa: F401  (import surfaces missing crypto extra)
	except ImportError:
		frappe.log_error(title="gdb_bank: PyJWT with crypto extra is not installed")
		errors.throw(
			errors.UpstreamUnavailable,
			"The identity service is not configured on this server.",
		)

	from jwt import PyJWKClient

	try:
		signing_key = PyJWKClient(
			f"{internal_realm_url()}/protocol/openid-connect/certs",
			cache_keys=True,
			timeout=KEYCLOAK_TIMEOUT,
		).get_signing_key_from_jwt(token)

		claims = jwt.decode(
			token,
			signing_key.key,
			algorithms=["RS256"],
			issuer=issuer(),
			audience=KEYCLOAK_CLIENT_ID,
			options={"require": ["exp", "iat", "iss", "sub"]},
		)
	except jwt.InvalidIssuerError:
		# The other whole-realm misconfiguration, and it looks identical to the
		# audience one from the citizen's side. Keycloak stamps `iss` with its
		# frontend hostname (KC_HOSTNAME), so this is what a KEYCLOAK_PUBLIC_URL
		# that does not match it produces - for every sign-in, not just one.
		frappe.log_error(
			title="gdb_bank: Keycloak token has the wrong issuer",
			message=(
				f"expected iss {issuer()!r}. KEYCLOAK_PUBLIC_URL must match Keycloak's own "
				f"KC_HOSTNAME — the internal docker URL is not what the token carries."
			),
		)
		errors.throw(errors.AuthenticationRequired, "Your sign-in could not be verified.")
	except jwt.InvalidAudienceError:
		# Worth its own branch, and worth naming in the log. This is what a
		# realm missing the audience mapper looks like, and it fails for EVERY
		# sign-in - so the one thing the operator must not be told is the
		# generic "could not be verified" that a tampered token also produces.
		frappe.log_error(
			title="gdb_bank: Keycloak token has the wrong audience",
			message=(
				f"expected {KEYCLOAK_CLIENT_ID!r} in aud. The realm is probably missing the "
				f"audience mapper — re-run keycloak-local/setup-gdb.mjs."
			),
		)
		errors.throw(errors.AuthenticationRequired, "Your sign-in could not be verified.")
	except Exception:
		# Never leak the library's message: it names the realm, the key id and
		# the expected audience (CLAUDE.md section 5).
		frappe.logger("gdb_bank", allow_site=True).warning("rejected an invalid Keycloak token")
		errors.throw(errors.AuthenticationRequired, "Your sign-in could not be verified.")

	azp = claims.get("azp")
	if not azp or azp != KEYCLOAK_CLIENT_ID:
		# Two different operator problems, one citizen-facing message. The log
		# separates them because a missing claim means "look at the realm", and
		# a wrong one means "somebody presented another client's token".
		frappe.logger("gdb_bank", allow_site=True).warning(
			"rejected a Keycloak token that carries no azp claim"
			if not azp
			else "rejected a Keycloak token minted for another client"
		)
		errors.throw(errors.AuthenticationRequired, "Your sign-in could not be verified.")

	return claims


# ---------------------------------------------------------------------------
# Claims -> personas
# ---------------------------------------------------------------------------


def realm_roles(claims: dict) -> tuple[str, ...]:
	"""Realm roles from a Keycloak access token: `realm_access.roles`, plus the
	client roles under `resource_access.<client>.roles` if present."""
	roles: set[str] = set()
	realm_access = claims.get("realm_access") or {}
	roles.update(realm_access.get("roles") or [])

	resource_access = claims.get("resource_access") or {}
	client = resource_access.get(KEYCLOAK_CLIENT_ID) or {}
	roles.update(client.get("roles") or [])

	return tuple(sorted(roles))


def frappe_roles_for(claims: dict) -> tuple[str, ...]:
	"""Which GDB Frappe roles this token grants. Registry-driven: add a persona
	with a `keycloak_roles` entry and it maps here automatically."""
	mapping = reg.keycloak_role_map()
	granted: set[str] = set()
	for realm_role in realm_roles(claims):
		granted.update(mapping.get(realm_role, ()))
	return tuple(sorted(granted))


def claim_eid(claims: dict) -> str | None:
	return eid_mod.normalize(claims.get(eid_mod.EID_CLAIM))


# ---------------------------------------------------------------------------
# Provisioning a Frappe user from a verified token
# ---------------------------------------------------------------------------


def provision_user(claims: dict) -> str:
	"""Find or create the Frappe user for a verified token, then converge their
	roles and e-ID onto what the token says.

	The e-ID, not the email, identifies the person: an email change in Keycloak
	must not create a second Frappe account.
	"""
	eid = claim_eid(claims)
	email = (claims.get("email") or "").strip().lower()

	if not eid and not email:
		errors.throw(errors.AuthenticationRequired, "Your sign-in is missing an identity.")

	user = (eid and eid_mod.user_for_eid(eid)) or (
		email and frappe.db.exists("User", email) and email
	)

	if not user:
		user = _create_user(claims, email, eid)
	elif email and frappe.db.get_value("User", user, "email") != email:
		# Email changed upstream. Update the contact field; never re-key.
		frappe.db.set_value("User", user, "email", email, update_modified=False)

	if eid:
		eid_mod.bind_to_user(user, eid)

	sync_roles(user, claims)
	return user


def _create_user(claims: dict, email: str, eid: str | None) -> str:
	"""Create the Frappe account for a first-time Keycloak sign-in.

	`user_type` follows the persona: citizens and facilitators are Website
	Users and never reach the desk. A token carrying no GDB role at all still
	creates an account, but with no persona - they can sign in and see nothing,
	which is the correct outcome for someone not yet onboarded.
	"""
	roles = frappe_roles_for(claims)
	personas = reg.personas_for_roles(set(roles))
	needs_desk = any(p.desk_access for p in personas)

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email or f"{eid}@eid.local",
			"first_name": claims.get("given_name") or claims.get("name") or eid,
			"last_name": claims.get("family_name") or "",
			"user_type": "System User" if needs_desk else "Website User",
			"send_welcome_email": 0,
			"enabled": 1,
			eid_mod.EID_USER_FIELD: eid,
		}
	)
	user.flags.ignore_permissions = True
	user.insert()
	frappe.logger("gdb_bank", allow_site=True).info(
		f"provisioned user from Keycloak with personas={[p.key for p in personas]}"
	)
	return user.name


def sync_roles(user: str, claims: dict) -> dict:
	"""Make the user's GDB roles exactly match what the token grants.

	Grants are additive and revocations are immediate: a role dropped in
	Keycloak is removed from Frappe on the next sign-in. Roles outside the
	registry (System Manager, lending's Loan Manager) are never touched - they
	are the site administrator's business, not the token's.

	WHY `ignore_permissions` IS CORRECT AND NECESSARY HERE
	    This runs inside `exchange_token`, which is `allow_guest` by necessity:
	    the caller has no Frappe session yet, and the verified token IS the
	    credential. So `frappe.session.user` is still "Guest" while we write the
	    User document that is about to become their account - and Guest cannot
	    write User, so `add_roles` -> `save()` failed with "User Guest does not
	    have doctype access via role permission for document User". Every
	    sign-in by a new or role-changed account died there.

	    The authority for this write is not the session, which is by definition
	    anonymous; it is the token, already verified against Keycloak's JWKS in
	    `verify_token` before this function is reachable. `ignore_permissions`
	    names that: skip the *session* permission check for a decision that was
	    made by cryptography instead.

	    The roles written are still only those `frappe_roles_for()` derives from
	    the registry, so this cannot grant anything a realm role does not map
	    to, and the change is audited below.
	"""
	wanted = set(frappe_roles_for(claims))
	registry_roles = {p.role for p in reg.PERSONAS}

	doc = frappe.get_doc("User", user)
	doc.flags.ignore_permissions = True
	current = {r.role for r in doc.roles} & registry_roles

	to_add = sorted(wanted - current)
	to_remove = sorted(current - wanted)

	if to_add:
		doc.add_roles(*[r for r in to_add if frappe.db.exists("Role", r)])
	if to_remove:
		doc.remove_roles(*to_remove)

	if to_add or to_remove:
		_audit_role_change(user, claims, to_add, to_remove)

	return {"added": to_add, "removed": to_remove}


def _audit_role_change(user: str, claims: dict, added, removed) -> None:
	doc = frappe.get_doc(
		{
			"doctype": "GDB Audit Event",
			"event": ev.ROLES_CHANGED,
			"actor_user": user,
			"actor_eid": claim_eid(claims),
			"actor_persona": "identity-provider",
			"subject_doctype": "User",
			"subject_name": user,
			"reason": "synchronised from Keycloak realm roles",
			"old_value": frappe.as_json(sorted(removed)),
			"new_value": frappe.as_json(sorted(added)),
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()


# ---------------------------------------------------------------------------
# Session hooks
# ---------------------------------------------------------------------------


def on_session_creation(login_manager=None) -> None:
	"""Wired to the `on_session_creation` hook, so EVERY login path converges -
	the SPA's PKCE exchange, Frappe Social Login, and a desk password login for
	an account that also exists in Keycloak.

	Failures here must not break the login; a user whose role sync fails gets
	their previous roles and an error in the log, not a 500 at the door.
	"""
	try:
		user = frappe.session.user
		if not user or user == "Guest":
			return
		enforce_kill_switch(user)
	except Exception:
		frappe.log_error(title="gdb_bank: session identity sync failed")


def enforce_kill_switch(user: str) -> bool:
	"""Disable the Frappe user if Keycloak says the account is gone or disabled.

	Returns True when the user was killed. Only consulted for accounts that
	actually carry an e-ID: locally created accounts (Administrator, the demo
	logins) are not Keycloak's to disable.
	"""
	if user == "Administrator":
		return False

	eid = eid_mod.for_user(user)
	if not eid:
		return False

	if _keycloak_account_active(eid):
		return False

	frappe.db.set_value("User", user, "enabled", 0, update_modified=False)
	frappe.logger("gdb_bank", allow_site=True).warning(
		"kill switch: disabled a Frappe user whose identity is no longer active"
	)
	doc = frappe.get_doc(
		{
			"doctype": "GDB Audit Event",
			"event": ev.USER_DISABLED,
			"actor_user": "Administrator",
			"actor_persona": "identity-provider",
			"subject_doctype": "User",
			"subject_name": user,
			"reason": "kill switch: identity disabled or removed in Keycloak",
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	frappe.db.commit()
	return True


def _keycloak_account_active(eid: str) -> bool:
	"""Ask Keycloak whether this identity is still enabled.

	Fails OPEN on an upstream error: an unreachable Keycloak must not lock
	every citizen out of the portal. It fails CLOSED only on a definite answer
	that the account is disabled. The cache keeps this off the hot path.
	"""
	cache_key = f"gdb_bank:kc_active:{eid}"
	cached = frappe.cache().get_value(cache_key)
	if cached is not None:
		return bool(cached)

	active = _query_keycloak_account(eid)
	frappe.cache().set_value(cache_key, 1 if active else 0, expires_in_sec=60)
	return active


def _query_keycloak_account(eid: str) -> bool:
	token = _service_account_token()
	if not token:
		return True  # cannot ask; fail open

	import requests

	try:
		response = requests.get(
			f"{KEYCLOAK_URL.rstrip('/')}/admin/realms/{KEYCLOAK_REALM}/users",
			params={"q": f"{eid_mod.EID_CLAIM}:{eid}", "briefRepresentation": "true"},
			headers={"Authorization": f"Bearer {token}"},
			timeout=KEYCLOAK_TIMEOUT,
		)
		response.raise_for_status()
	except Exception:
		frappe.log_error(title="gdb_bank: Keycloak admin lookup failed")
		return True  # fail open

	users = response.json() or []
	if not users:
		return False  # definitively gone
	return bool(users[0].get("enabled", True))


def _service_account_token() -> str | None:
	"""Client-credentials token for the admin lookups. Returns None when no
	service account is configured, which makes the kill switch fall back to
	token expiry alone."""
	client_id = os.environ.get("KEYCLOAK_SERVICE_CLIENT_ID")
	client_secret = os.environ.get("KEYCLOAK_SERVICE_CLIENT_SECRET")
	if not client_id or not client_secret:
		return None

	cache_key = "gdb_bank:kc_service_token"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	import requests

	try:
		response = requests.post(
			f"{internal_realm_url()}/protocol/openid-connect/token",
			data={
				"grant_type": "client_credentials",
				"client_id": client_id,
				"client_secret": client_secret,
			},
			timeout=KEYCLOAK_TIMEOUT,
		)
		response.raise_for_status()
	except Exception:
		frappe.log_error(title="gdb_bank: Keycloak service token request failed")
		return None

	payload: dict[str, Any] = response.json()
	token = payload.get("access_token")
	if token:
		ttl = max(int(payload.get("expires_in", 60)) - 30, 30)
		frappe.cache().set_value(cache_key, token, expires_in_sec=ttl)
	return token
