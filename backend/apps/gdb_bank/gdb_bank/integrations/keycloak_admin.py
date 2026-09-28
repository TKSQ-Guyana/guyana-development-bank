"""Keycloak Admin REST client for the STAFF realm — the Keycloak half of a staff account.

Every GDB password lives in Keycloak. When the platform administrator creates a
staff member, disables one or issues a one-time password, the matching Keycloak
account has to follow, and this module is that one conversation.

NO EMAIL. A one-time password is set here as a TEMPORARY Keycloak credential
and shown to the administrator once. Keycloak's own UPDATE_PASSWORD action then
holds the account: the password grant answers "not fully set up" until the
person chooses a permanent password (identity.staff_set_password), so the
password the administrator saw is good for exactly that one step.

HOW IT AUTHENTICATES. A confidential client in the staff realm with a service
account holding realm-management `manage-users` (and `view-users`), using the
client_credentials grant. Keycloak takes the realm to administer from the
token's issuer, so this client can manage staff accounts and nothing else — not
the citizen realm, not the master realm.

UNCONFIGURED IS A STATE, NOT AN ERROR. Without an admin client id and secret,
`is_configured()` is False and callers tell the administrator to do the
Keycloak half by hand. A configured client that fails raises
KeycloakAdminError with a sentence fit to show that administrator — never
Keycloak's own error body.

Endpoints (Keycloak 26 Admin REST API):
  POST /realms/{realm}/protocol/openid-connect/token        client_credentials
  GET  /admin/realms/{realm}/users?email=…&exact=true
  POST /admin/realms/{realm}/users                           201 + Location
  PUT  /admin/realms/{realm}/users/{id}                      {"enabled": …}
  PUT  /admin/realms/{realm}/users/{id}/reset-password       {"type": "password", "temporary": …}
       temporary=true adds UPDATE_PASSWORD; temporary=false removes it.
"""

import time

import requests
from frappe import _

from gdb_bank.integrations import settings
from gdb_bank.utils.session import _logger

_HTTP_TIMEOUT = 10


class KeycloakAdminError(Exception):
	"""A configured admin client could not do what was asked."""


def config() -> dict | None:
	base = (settings.get("keycloak_staff_url") or settings.get("keycloak_url")).rstrip("/")
	realm = settings.get("keycloak_staff_realm")
	client_id = settings.get("keycloak_admin_client_id")
	secret = settings.get("keycloak_admin_client_secret")
	if not (base and realm and client_id and secret):
		return None
	return {"base": base, "realm": realm, "client_id": client_id, "client_secret": secret}


def is_configured() -> bool:
	return config() is not None


def _token(cfg: dict) -> str:
	try:
		res = requests.post(
			f"{cfg['base']}/realms/{cfg['realm']}/protocol/openid-connect/token",
			data={
				"grant_type": "client_credentials",
				"client_id": cfg["client_id"],
				"client_secret": cfg["client_secret"],
			},
			timeout=_HTTP_TIMEOUT,
		)
	except requests.RequestException as exc:
		_logger().error(f"keycloak admin [{cfg['realm']}] unreachable: {exc}")
		raise KeycloakAdminError(_("Could not reach Keycloak.")) from exc
	if res.status_code != 200:
		_logger().error(f"keycloak admin token [{cfg['realm']}] HTTP {res.status_code}")
		raise KeycloakAdminError(_("Keycloak refused the portal's admin client. Check its id and secret."))
	token = (res.json() or {}).get("access_token")
	if not token:
		raise KeycloakAdminError(_("Keycloak returned no admin token."))
	return token


def _call(cfg: dict, method: str, path: str, **kwargs) -> requests.Response:
	token = _token(cfg)
	try:
		return requests.request(
			method,
			f"{cfg['base']}/admin/realms/{cfg['realm']}{path}",
			headers={"Authorization": f"Bearer {token}"},
			timeout=_HTTP_TIMEOUT,
			**kwargs,
		)
	except requests.RequestException as exc:
		_logger().error(f"keycloak admin {method} {path} unreachable: {exc}")
		raise KeycloakAdminError(_("Could not reach Keycloak.")) from exc


def _require(cfg: dict | None) -> dict:
	if cfg is None:
		raise KeycloakAdminError(_("Keycloak account management is not configured."))
	return cfg


def find_user_id(email: str) -> str | None:
	cfg = _require(config())
	res = _call(cfg, "GET", "/users", params={"email": email, "exact": "true"})
	if res.status_code == 403:
		raise KeycloakAdminError(_("The portal's admin client lacks the manage-users role in Keycloak."))
	if res.status_code != 200:
		_logger().error(f"keycloak admin user search HTTP {res.status_code}")
		raise KeycloakAdminError(_("Keycloak could not look the account up."))
	for row in res.json() or []:
		if (row.get("email") or "").lower() == email.lower():
			return row.get("id")
	return None


def sign_in_account(email: str) -> dict | None:
	"""The account a staff sign-in with this email authenticates, or None.

	Looked up by USERNAME — the password grant tries the username before the
	email — and accepted only when its email is the same address, so the
	account whose password is about to change is exactly the one that just
	proved the one-time password. {"id", "required_actions"}."""
	cfg = _require(config())
	res = _call(cfg, "GET", "/users", params={"username": email, "exact": "true"})
	if res.status_code == 403:
		raise KeycloakAdminError(_("The portal's admin client lacks the manage-users role in Keycloak."))
	if res.status_code != 200:
		_logger().error(f"keycloak admin user search HTTP {res.status_code}")
		raise KeycloakAdminError(_("Keycloak could not look the account up."))
	for row in res.json() or []:
		if (row.get("username") or "").lower() == email.lower() and (row.get("email") or "").lower() == email.lower():
			return {"id": row.get("id"), "required_actions": row.get("requiredActions") or []}
	return None


def _names(full_name: str) -> tuple[str, str]:
	# Keycloak's user profile expects both names; an account missing one can be
	# held at a VERIFY_PROFILE step, which fails the password grant with the
	# same "not fully set up" answer keycloak/README.md warns about.
	parts = (full_name or "").split()
	if not parts:
		return "", ""
	return parts[0], " ".join(parts[1:]) or parts[0]


def ensure_account(email: str, full_name: str) -> tuple[str, bool]:
	"""(keycloak user id, created). An existing account is left exactly as it
	is — the person may already sign in with it."""
	existing = find_user_id(email)
	if existing:
		return existing, False

	cfg = _require(config())
	first, last = _names(full_name)
	res = _call(
		cfg,
		"POST",
		"/users",
		json={
			"username": email,
			"email": email,
			"firstName": first,
			"lastName": last,
			"enabled": True,
			"emailVerified": True,
			# No password yet. set_password adds a temporary one straight after;
			# until the person replaces it, this pending action makes the
			# password grant refuse them.
			"requiredActions": ["UPDATE_PASSWORD"],
		},
	)
	if res.status_code == 409:
		existing = find_user_id(email)
		if existing:
			return existing, False
		raise KeycloakAdminError(_("Keycloak already holds an account with this username."))
	if res.status_code != 201:
		_logger().error(f"keycloak admin create user HTTP {res.status_code}")
		raise KeycloakAdminError(_("Keycloak did not create the account."))
	user_id = (res.headers.get("Location") or "").rstrip("/").rsplit("/", 1)[-1] or find_user_id(email)
	if not user_id:
		raise KeycloakAdminError(_("Keycloak created the account but did not say where."))
	return user_id, True


class PasswordRejected(KeycloakAdminError):
	"""Keycloak refused the password itself (its password policy), not the call."""


def set_password(user_id: str, password: str, *, temporary: bool) -> None:
	"""Set the account's password. Temporary: the one-time password an
	administrator hands over, which Keycloak will only accept as the key to
	choosing a new one. Permanent: the one the person chose."""
	cfg = _require(config())
	res = _call(
		cfg,
		"PUT",
		f"/users/{user_id}/reset-password",
		json={"type": "password", "value": password, "temporary": bool(temporary)},
	)
	if res.status_code == 400:
		# Keycloak's body names the policy rule; it is not repeated to the
		# caller, and the password itself is never logged.
		_logger().info(f"keycloak admin reset-password refused by policy (temporary={bool(temporary)})")
		raise PasswordRejected(_("That password does not meet the Bank's password rules."))
	if res.status_code != 204:
		_logger().error(f"keycloak admin reset-password HTTP {res.status_code}")
		raise KeycloakAdminError(_("Keycloak did not set the password."))


def set_enabled(email: str, enabled: bool) -> bool:
	"""Mirror the portal's enable/disable onto Keycloak. False when Keycloak
	holds no account for this email."""
	user_id = find_user_id(email)
	if not user_id:
		return False
	cfg = _require(config())
	res = _call(cfg, "PUT", f"/users/{user_id}", json={"enabled": bool(enabled)})
	if res.status_code != 204:
		_logger().error(f"keycloak admin set enabled HTTP {res.status_code}")
		raise KeycloakAdminError(_("Keycloak did not update the account."))
	return True


def probe(cfg: dict | None = None) -> dict:
	"""Can the admin client authenticate? Used by the settings screen."""
	cfg = cfg or config()
	if cfg is None:
		return {"ok": None, "latency_ms": None, "detail": "Not configured."}
	started = time.monotonic()
	try:
		_token(cfg)
	except KeycloakAdminError as exc:
		return {"ok": False, "latency_ms": None, "detail": str(exc)}
	return {
		"ok": True,
		"latency_ms": int((time.monotonic() - started) * 1000),
		"detail": "Admin client authenticated.",
	}
