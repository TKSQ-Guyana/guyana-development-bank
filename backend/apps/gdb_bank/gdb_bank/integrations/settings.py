"""Where every integration setting comes from — one answer for every adapter.

First non-empty value wins:

  1. GDB Integration Settings — the Single doctype the platform administrator
     edits in the portal. Secrets are Frappe Password fields, encrypted in
     __Auth; the Single itself only ever holds a mask.
  2. site_config.json — how a deployed site pins a value with no container
     change.
  3. The environment — how docker compose passes it.

identity.py (Keycloak) and integrations/client.py (DCRA, the bank switch) all
read through `get`, so the portal's settings screen is always telling the
truth about what the adapters will use: `source` reports which of the three
answered.

An outside API is two keys here — `<system>_base_url` and `<system>_api_key` —
and that naming is what integrations/client.py looks up.
"""

import os
import re

import frappe

DOCTYPE = "GDB Integration Settings"

# key -> (environment variable, is_secret)
KEYS = {
	"keycloak_url": ("KEYCLOAK_URL", False),
	"keycloak_realm": ("KEYCLOAK_REALM", False),
	"keycloak_client_id": ("KEYCLOAK_CLIENT_ID", False),
	"keycloak_client_secret": ("KEYCLOAK_CLIENT_SECRET", True),
	"keycloak_staff_url": ("KEYCLOAK_STAFF_URL", False),
	"keycloak_staff_realm": ("KEYCLOAK_STAFF_REALM", False),
	"keycloak_staff_client_id": ("KEYCLOAK_STAFF_CLIENT_ID", False),
	"keycloak_staff_client_secret": ("KEYCLOAK_STAFF_CLIENT_SECRET", True),
	"keycloak_admin_client_id": ("KEYCLOAK_ADMIN_CLIENT_ID", False),
	"keycloak_admin_client_secret": ("KEYCLOAK_ADMIN_CLIENT_SECRET", True),
	# The citizen realm's own admin client: creates the Keycloak account behind
	# a TIN sign-up (tin_auth.py), and nothing in the staff realm.
	"keycloak_citizen_admin_client_id": ("KEYCLOAK_CITIZEN_ADMIN_CLIENT_ID", False),
	"keycloak_citizen_admin_client_secret": ("KEYCLOAK_CITIZEN_ADMIN_CLIENT_SECRET", True),
	"dcra_base_url": ("DCRA_BASE_URL", False),
	"dcra_api_key": ("DCRA_API_KEY", True),
	"bank_registry_base_url": ("BANK_REGISTRY_BASE_URL", False),
	"bank_registry_api_key": ("BANK_REGISTRY_API_KEY", True),
}

URL_KEYS = frozenset(k for k in KEYS if k.endswith("_url"))
SECRET_KEYS = frozenset(k for k, (_env, secret) in KEYS.items() if secret)

_TOKEN = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
_URL = re.compile(r"^https?://[^\s/?#]+(:\d+)?(/[^\s?#]*)?$")


def is_secret(key: str) -> bool:
	return key in SECRET_KEYS


def _doctype_ready() -> bool:
	# Adapters run before the first migrate has created the doctype (the site
	# bootstrap signs nobody in, but a bench console might) — fall through to
	# site_config and the environment rather than fail.
	return bool(frappe.db.exists("DocType", DOCTYPE))


def stored(key: str) -> str:
	"""The override saved in the portal, or '' when there is none."""
	if key not in KEYS or not _doctype_ready():
		return ""
	raw = frappe.db.get_value(DOCTYPE, DOCTYPE, key)
	if not raw:
		return ""
	if is_secret(key):
		from frappe.utils.password import get_decrypted_password

		return (get_decrypted_password(DOCTYPE, DOCTYPE, key, raise_exception=False) or "").strip()
	return str(raw).strip()


def _fallback(key: str) -> tuple[str, str | None]:
	value = str(frappe.conf.get(key) or "").strip()
	if value:
		return value, "site_config"
	value = (os.environ.get(KEYS[key][0]) or "").strip()
	if value:
		return value, "environment"
	return "", None


def resolve(key: str) -> tuple[str, str | None]:
	"""(value, source) — source is settings | site_config | environment | None."""
	value = stored(key)
	if value:
		return value, "settings"
	return _fallback(key)


def get(key: str) -> str:
	return resolve(key)[0]


def source(key: str) -> str | None:
	return resolve(key)[1]


def normalize(key: str, value) -> str:
	"""Canonical form of one value, or throw if it cannot be right.

	The doctype controller calls this on save and the connection test calls it
	on unsaved input, so what can be tested is exactly what can be stored.
	"""
	text = str(value or "").strip()
	if not text or is_secret(key):
		return text
	if key in URL_KEYS:
		text = text.rstrip("/")
		if len(text) > 300 or not _URL.match(text):
			frappe.throw(frappe._("{0} must be a full http:// or https:// address.").format(key))
		return text
	if not _TOKEN.match(text):
		frappe.throw(frappe._("{0} may contain only letters, digits, dot, dash and underscore.").format(key))
	return text
