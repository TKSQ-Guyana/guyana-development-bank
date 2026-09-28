"""Timed reachability checks for the integrations the platform depends on.

Every check has a hard timeout, follows no redirect and hands nothing it read
back to the browser beyond reachable / status / latency — the admin is told
whether a dependency answers, not what it said.
"""

import time

import requests

TIMEOUT_SECONDS = 5


def http_get(url: str, *, timeout: int = TIMEOUT_SECONDS) -> tuple[dict, requests.Response | None]:
	"""(summary, response). The response is for the caller to inspect server
	side; only the summary is ever returned to a client."""
	started = time.monotonic()
	try:
		res = requests.get(url, timeout=timeout, allow_redirects=False, headers={"Accept": "application/json"})
	except requests.RequestException:
		return {"reachable": False, "status": None, "latency_ms": None}, None
	latency = int((time.monotonic() - started) * 1000)
	return {"reachable": True, "status": res.status_code, "latency_ms": latency}, res


def keycloak_realm(base_url: str, realm: str) -> dict:
	"""Does this Keycloak serve this realm? Reads the realm's OIDC discovery
	document, which is public and needs no client credentials."""
	summary, res = http_get(f"{base_url.rstrip('/')}/realms/{realm}/.well-known/openid-configuration")
	if res is None:
		return {"ok": False, "latency_ms": None, "detail": "Could not reach the Keycloak server."}
	if res.status_code == 404:
		return {"ok": False, "latency_ms": summary["latency_ms"], "detail": "Keycloak answered, but has no such realm."}
	if res.status_code != 200:
		return {"ok": False, "latency_ms": summary["latency_ms"], "detail": f"Keycloak answered HTTP {res.status_code}."}
	try:
		issuer = (res.json() or {}).get("issuer", "")
	except ValueError:
		issuer = ""
	if not issuer.rstrip("/").endswith(f"/realms/{realm}"):
		return {"ok": False, "latency_ms": summary["latency_ms"], "detail": "The server did not answer as a Keycloak realm."}
	return {"ok": True, "latency_ms": summary["latency_ms"], "detail": "Realm is answering."}


def http_service(base_url: str) -> dict:
	"""Is a registry service up? Any answer below 500 means the service is
	there — its contract has no health route, and a 404 on the base path still
	proves the host and the application are reachable."""
	summary, res = http_get(base_url)
	if res is None:
		return {"ok": False, "latency_ms": None, "detail": "Could not reach the service."}
	if res.status_code >= 500:
		return {"ok": False, "latency_ms": summary["latency_ms"], "detail": f"The service answered HTTP {res.status_code}."}
	return {"ok": True, "latency_ms": summary["latency_ms"], "detail": "Service is answering."}
