"""The one way gdb_bank calls an outside system over HTTP.

Every adapter (dcra.py, bank_registry.py) goes through `get_json`, so what must
be true of every outside call is written once:

  - configuration comes from integrations/settings.py and nowhere else:
    `<system>_base_url`, and `<system>_api_key` when the system issues one
  - every call has a timeout
  - a system that is not configured, cannot be reached, or answers with
    something that is not JSON is "no answer" — never raised into the request,
    and never turned into a pass
  - the log line carries the system, the outcome and how long it took, and
    nothing from the request or the response

Adapters hold no data of their own. With no base URL there is no answer.

TO ADD AN OUTSIDE SYSTEM: its two keys in settings.KEYS, a group in
services/integration_settings.GROUPS, the two fields on GDB Integration
Settings, and an adapter that maps its JSON onto ours.
"""

import logging
import time

import frappe
import requests

from gdb_bank.integrations import settings

TIMEOUT_SECONDS = 10


def _logger() -> logging.Logger:
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger


def configured(system: str) -> bool:
	return bool(settings.get(f"{system}_base_url"))


def get_json(system: str, path: str, params: dict | None = None) -> tuple[int | None, object]:
	"""GET `<system>_base_url` + path. Answers (status, body).

	`status` is None when there was no answer at all: not configured, not
	reachable, or timed out. `body` is the parsed JSON, or None when the
	response carried none.
	"""
	base_url = settings.get(f"{system}_base_url")
	if not base_url:
		return None, None

	headers = {"Accept": "application/json"}
	# The key is sent as a bearer token. No agency has confirmed its scheme
	# yet; when one does, this line is the only place it changes.
	api_key = settings.get(f"{system}_api_key")
	if api_key:
		headers["Authorization"] = f"Bearer {api_key}"

	started = time.monotonic()
	try:
		res = requests.get(
			f"{base_url.rstrip('/')}{path}",
			params=params,
			headers=headers,
			timeout=TIMEOUT_SECONDS,
			allow_redirects=False,
		)
	except requests.RequestException as exc:
		elapsed = int((time.monotonic() - started) * 1000)
		_logger().error(f"{system}: no answer ({type(exc).__name__}) after {elapsed}ms")
		return None, None

	elapsed = int((time.monotonic() - started) * 1000)
	log = _logger().info if res.status_code < 400 or res.status_code == 404 else _logger().error
	log(f"{system}: HTTP {res.status_code} in {elapsed}ms")

	try:
		return res.status_code, res.json()
	except ValueError:
		return res.status_code, None
