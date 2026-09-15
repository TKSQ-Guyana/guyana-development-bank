"""DCRA — Deeds and Commercial Registries Authority.

The registry of record for business names and companies in Guyana. GDB reads
it so an applicant who already runs a registered business never retypes what
the State already holds: give the registration number, get the registered
name, type, status and proprietors back.

This module is the *adapter*. It has one public function, `lookup`, and two
implementations behind it:

  live     — an HTTP call to the DCRA service, used when the site is
             configured with `dcra_base_url` (see the contract in
             docs/integrations/dcra.md).
  sandbox  — a small fixed register used until that service exists.

Every result carries `source`, and callers must not treat `sandbox` as proof
of anything. A registration that the adapter cannot confirm comes back as
`status: "Unavailable"` — never as a pass. That distinction is the whole point
of the adapter: an unavailable registry is a known state, not a silent success.
"""

from __future__ import annotations

import logging

import frappe

_HTTP_TIMEOUT = 10

# Sandbox register. Stand-ins, used only until DCRA exposes the real service —
# `source` says "sandbox" on every one of these so nothing downstream can
# mistake them for a registry confirmation. They exist so the application flow
# can be built and tested end to end, which is what rule 15 asks for.
SANDBOX_REGISTER: dict[str, dict] = {
	"BN-2024-004512": {
		"registration_number": "BN-2024-004512",
		"business_name": "Essequibo Cassava Processors",
		"business_type": "Business Name",
		"status": "Active",
		"registered_on": "2024-03-18",
		"region": "Region 2 - Pomeroon-Supenaam",
		"proprietors": ["Hemanth Narine"],
	},
	"BN-2023-001987": {
		"registration_number": "BN-2023-001987",
		"business_name": "Demerara Coast Fisheries",
		"business_type": "Business Name",
		"status": "Active",
		"registered_on": "2023-07-02",
		"region": "Region 4 - Demerara-Mahaica",
		"proprietors": ["Asha Persaud"],
	},
	"C-2022-000734": {
		"registration_number": "C-2022-000734",
		"business_name": "Berbice Agro Supplies Inc.",
		"business_type": "Company",
		"status": "Active",
		"registered_on": "2022-11-25",
		"region": "Region 6 - East Berbice-Corentyne",
		"proprietors": ["S. Khan", "M. Edwards"],
	},
	"BN-2019-000442": {
		"registration_number": "BN-2019-000442",
		"business_name": "Linden Timber Works",
		"business_type": "Business Name",
		# A struck-off registration is deliberately included: an underwriter
		# needs to see that a business exists but is no longer in good standing.
		"status": "Struck Off",
		"registered_on": "2019-05-14",
		"region": "Region 10 - Upper Demerara-Berbice",
		"proprietors": ["J. Fraser"],
	},
}


def _logger() -> logging.Logger:
	logger = frappe.logger("gdb_bank", allow_site=True)
	logger.setLevel(logging.INFO)
	return logger


def normalize(registration_number: str | None) -> str:
	"""DCRA numbers are quoted with mixed spacing and case; store one form."""
	return (registration_number or "").strip().upper().replace(" ", "")


def _unavailable(number: str, reason: str) -> dict:
	"""The registry could not answer. Distinct from 'not registered'."""
	return {
		"registration_number": number,
		"business_name": None,
		"status": "Unavailable",
		"source": "unavailable",
		"reason": reason,
	}


def _live(number: str, base_url: str) -> dict | None:
	"""Call the real DCRA service. Contract: docs/integrations/dcra.md."""
	import requests

	try:
		res = requests.get(
			f"{base_url.rstrip('/')}/registrations/{number}",
			headers={"Accept": "application/json"},
			timeout=_HTTP_TIMEOUT,
		)
	except requests.RequestException as exc:
		_logger().error(f"dcra unreachable: {exc}")
		return None

	if res.status_code == 404:
		return {
			"registration_number": number,
			"business_name": None,
			"status": "Not Found",
			"source": "dcra",
		}
	if res.status_code != 200:
		_logger().error(f"dcra returned {res.status_code} for {number}")
		return None

	payload = res.json()
	return {
		"registration_number": payload.get("registration_number") or number,
		"business_name": payload.get("business_name"),
		"business_type": payload.get("business_type"),
		"status": payload.get("status"),
		"registered_on": payload.get("registered_on"),
		"region": payload.get("region"),
		"proprietors": payload.get("proprietors") or [],
		"source": "dcra",
	}


def _live_by_proprietor(name: str, base_url: str) -> list[dict] | None:
	"""Search the registry for businesses this person is a proprietor of."""
	import requests

	try:
		res = requests.get(
			f"{base_url.rstrip('/')}/registrations",
			params={"proprietor": name},
			headers={"Accept": "application/json"},
			timeout=_HTTP_TIMEOUT,
		)
	except requests.RequestException as exc:
		_logger().error(f"dcra proprietor search unreachable: {exc}")
		return None

	if res.status_code != 200:
		_logger().error(f"dcra proprietor search returned {res.status_code}")
		return None

	payload = res.json()
	rows = payload.get("registrations") if isinstance(payload, dict) else payload
	return [{**r, "source": "dcra"} for r in (rows or [])]


def businesses_for(proprietor_name: str) -> list[dict]:
	"""Every registration naming this person as a proprietor.

	This is what lets the portal fill the registration number in rather than
	asking for it. It is also the anti-impersonation control: an applicant can
	only ever pick from businesses the register says are theirs, so claiming
	somebody else's registration is not a thing the form can express.
	"""
	name = (proprietor_name or "").strip()
	if not name:
		return []

	base_url = frappe.conf.get("dcra_base_url")
	if base_url:
		live = _live_by_proprietor(name, base_url)
		# Unreachable registry yields nothing rather than sandbox data — the
		# caller shows a manual fallback, never a fabricated business.
		return live or []

	folded = name.casefold()
	return [
		{**record, "source": "sandbox"}
		for record in SANDBOX_REGISTER.values()
		if any(p.strip().casefold() == folded for p in record.get("proprietors", []))
	]


def lookup(registration_number: str) -> dict:
	"""Resolve a DCRA registration number to a business.

	Always returns a dict carrying `source`, one of:
	  dcra        — the registry answered
	  sandbox     — the stand-in register answered; NOT evidence
	  unavailable — the registry could not be reached, or is not configured
	"""
	number = normalize(registration_number)
	if not number:
		return _unavailable(number, "no registration number given")

	base_url = frappe.conf.get("dcra_base_url")
	if base_url:
		live = _live(number, base_url)
		if live is not None:
			return live
		# A configured-but-unreachable registry is unavailable. It must never
		# fall through to the sandbox and look like a confirmation.
		return _unavailable(number, "DCRA service did not respond")

	record = SANDBOX_REGISTER.get(number)
	if not record:
		return {
			"registration_number": number,
			"business_name": None,
			"status": "Not Found",
			"source": "sandbox",
		}
	return {**record, "source": "sandbox"}
