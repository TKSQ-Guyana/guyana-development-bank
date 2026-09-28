"""Integration settings as the platform administrator sees and changes them.

Reading answers, for every setting, the value in force and WHERE it comes from
(portal override, site_config or environment — integrations/settings.py). A
secret is never returned in any form: only whether one is set, and where.

Saving writes overrides onto GDB Integration Settings, with a reason, recorded
in the access trail. A secret can be replaced or removed but never read back,
so a leaked administrator session cannot be turned into a leaked credential.

Testing checks a group against the values in force, optionally overlaid with
values the administrator has typed but not saved, so a change can be proven
before it is made.
"""

import frappe
from frappe import _

from gdb_bank.integrations import keycloak_admin, probe, settings
from gdb_bank.services import access_audit
from gdb_bank.utils.session import _logger

CITIZEN_EID = "citizen_eid"
STAFF_SIGN_IN = "staff_sign_in"
STAFF_ACCOUNTS = "staff_accounts"
DCRA = "dcra"
BANK_REGISTRY = "bank_registry"

GROUPS = {
	CITIZEN_EID: {
		"label": "Citizen e-ID sign-in (Keycloak)",
		"keys": ("keycloak_url", "keycloak_realm", "keycloak_client_id", "keycloak_client_secret"),
	},
	STAFF_SIGN_IN: {
		"label": "Staff sign-in (Keycloak)",
		"keys": ("keycloak_staff_url", "keycloak_staff_realm", "keycloak_staff_client_id", "keycloak_staff_client_secret"),
	},
	STAFF_ACCOUNTS: {
		"label": "Staff account management (Keycloak admin client)",
		"keys": ("keycloak_admin_client_id", "keycloak_admin_client_secret"),
	},
	DCRA: {"label": "DCRA business registry", "keys": ("dcra_base_url",)},
	BANK_REGISTRY: {"label": "Bank account registry", "keys": ("bank_registry_base_url",)},
}

LABELS = {
	"keycloak_url": "Keycloak URL",
	"keycloak_realm": "Realm",
	"keycloak_client_id": "Client ID",
	"keycloak_client_secret": "Client secret",
	"keycloak_staff_url": "Keycloak URL (empty: the citizen one)",
	"keycloak_staff_realm": "Realm",
	"keycloak_staff_client_id": "Client ID",
	"keycloak_staff_client_secret": "Client secret",
	"keycloak_admin_client_id": "Admin client ID",
	"keycloak_admin_client_secret": "Admin client secret",
	"dcra_base_url": "Base URL (empty: sandbox register)",
	"bank_registry_base_url": "Base URL (empty: sandbox register)",
}


def _group(key: str) -> dict:
	group = GROUPS.get(key)
	if not group:
		frappe.throw(_("Unknown integration."))
	return group


def _field(key: str) -> dict:
	value, source = settings.resolve(key)
	secret = settings.is_secret(key)
	return {
		"key": key,
		"label": LABELS[key],
		"secret": secret,
		"value": None if secret else value,
		"is_set": bool(value),
		"source": source,
	}


def _mode(group_key: str) -> str:
	get = settings.get
	if group_key == CITIZEN_EID:
		return "configured" if get("keycloak_url") and get("keycloak_realm") and get("keycloak_client_id") else "off"
	if group_key == STAFF_SIGN_IN:
		base = get("keycloak_staff_url") or get("keycloak_url")
		return "configured" if base and get("keycloak_staff_realm") and get("keycloak_staff_client_id") else "off"
	if group_key == STAFF_ACCOUNTS:
		return "configured" if keycloak_admin.is_configured() else "off"
	url_key = GROUPS[group_key]["keys"][0]
	return "live" if get(url_key) else "sandbox"


def status() -> list[dict]:
	"""Configured or not, per integration — no network, for the health screen."""
	return [{"key": key, "label": group["label"], "mode": _mode(key)} for key, group in GROUPS.items()]


def read() -> list[dict]:
	return [
		{
			"key": key,
			"label": group["label"],
			"mode": _mode(key),
			"fields": [_field(k) for k in group["keys"]],
			"last_change": access_audit.last_change(group["label"]),
		}
		for key, group in GROUPS.items()
	]


def save(actor: str, group_key: str, values, reason: str) -> list[dict]:
	"""Apply overrides for ONE integration.

	`values` maps setting -> new override. For an ordinary setting, "" removes
	the override (the site_config / environment value applies again). For a
	secret, an absent key leaves it alone, "" removes it, and anything else
	replaces it.
	"""
	reason = (reason or "").strip()
	if len(reason) < 3:
		frappe.throw(_("Say why this change is being made."))
	group = _group(group_key)
	values = frappe.parse_json(values) if isinstance(values, str) else (values or {})
	unknown = set(values) - set(group["keys"])
	if unknown:
		frappe.throw(_("{0} is not part of this integration.").format(", ".join(sorted(unknown))))

	doc = frappe.get_single(settings.DOCTYPE)
	before, after, removed_secrets = [], [], []
	for key in group["keys"]:
		if key not in values:
			continue
		new = settings.normalize(key, values.get(key))
		if settings.is_secret(key):
			had = bool(settings.stored(key))
			if not new:
				if had:
					removed_secrets.append(key)
					doc.set(key, None)
					before.append(f"{key}: set")
					after.append(f"{key}: removed")
				continue
			doc.set(key, new)
			before.append(f"{key}: {'set' if had else 'not set'}")
			after.append(f"{key}: replaced")
			continue
		old = settings.stored(key)
		if old == new:
			continue
		doc.set(key, new or None)
		before.append(f"{key}: {old or '(not overridden)'}")
		after.append(f"{key}: {new or '(not overridden)'}")

	if not after:
		return read()

	doc.save(ignore_permissions=True)
	if removed_secrets:
		from frappe.utils.password import remove_encrypted_password

		for key in removed_secrets:
			remove_encrypted_password(settings.DOCTYPE, settings.DOCTYPE, key)
	access_audit.record(
		actor,
		access_audit.SETTINGS_CHANGED,
		reason=reason[:500],
		subject=group["label"],
		old="\n".join(before),
		new="\n".join(after),
	)
	frappe.db.commit()
	_logger().info(f"platform admin {actor} changed integration settings: {group_key}")
	return read()


def test(group_key: str, values=None) -> dict:
	"""Check one integration, overlaying unsaved values when given."""
	group = _group(group_key)
	overlay = frappe.parse_json(values) if isinstance(values, str) else (values or {})

	def value(key: str) -> str:
		if key in group["keys"] and overlay.get(key) not in (None, ""):
			return settings.normalize(key, overlay[key])
		return settings.get(key)

	if group_key in (CITIZEN_EID, STAFF_SIGN_IN):
		if group_key == CITIZEN_EID:
			base, realm = value("keycloak_url"), value("keycloak_realm")
		else:
			base = value("keycloak_staff_url") or settings.get("keycloak_url")
			realm = value("keycloak_staff_realm")
		if not (base and realm):
			return {"ok": None, "latency_ms": None, "detail": "Not configured."}
		return probe.keycloak_realm(base, realm)

	if group_key == STAFF_ACCOUNTS:
		base = settings.get("keycloak_staff_url") or settings.get("keycloak_url")
		realm = settings.get("keycloak_staff_realm")
		client_id = value("keycloak_admin_client_id")
		secret = value("keycloak_admin_client_secret")
		if not (base and realm and client_id and secret):
			return {"ok": None, "latency_ms": None, "detail": "Not configured."}
		return keycloak_admin.probe(
			{"base": base.rstrip("/"), "realm": realm, "client_id": client_id, "client_secret": secret}
		)

	base = value(group["keys"][0])
	if not base:
		return {"ok": None, "latency_ms": None, "detail": "Not configured — the sandbox register is in use, and it is never evidence."}
	return probe.http_service(base)
