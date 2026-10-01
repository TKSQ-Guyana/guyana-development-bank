"""DCRA — Deeds and Commercial Registries Authority.

The registry of record for business names and companies in Guyana. GDB reads
it so an applicant who already runs a registered business never retypes what
the State already holds: give the registration number, get the registered
name, type, status and proprietors back.

This module is the *adapter* for the real DCRA service (contract in
docs/integrations/dcra.md). It holds no data of its own. It is switched on by
configuration alone — `dcra_base_url`, and `dcra_api_key` if DCRA issues one —
from the platform administrator's Integrations screen, site_config or the
environment (integrations/settings.py). The call itself is integrations/client.py.

Every result carries `source`:

  dcra        — the registry answered
  unavailable — the registry is not configured, or did not respond

A registration the adapter cannot confirm comes back as `status: "Unavailable"`
— never as a pass, and never as "Not Found". That distinction is the whole
point of the adapter: an unavailable registry is a known state, not a silent
success.
"""

from __future__ import annotations

from urllib.parse import quote

from gdb_bank.integrations import client

SYSTEM = "dcra"


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


def businesses_for(eid: str) -> list[dict]:
	"""Every registration naming this e-ID as a proprietor.

	This is what lets the portal fill the registration number in rather than
	asking for it. It is also the anti-impersonation control: an applicant can
	only ever pick from businesses the register says are theirs, so claiming
	somebody else's registration is not a thing the form can express. Matched
	on e-ID rather than name — a name is typed by two different registers and
	can disagree; an e-ID is the one identifier both sides already share.

	A registry that is not configured or does not answer yields nothing: the
	caller shows the manual path, never a fabricated business.
	"""
	eid = (eid or "").strip()
	if not eid:
		return []

	status, payload = client.get_json(SYSTEM, "/registrations", {"proprietor_eid": eid})
	if status != 200:
		return []

	rows = payload.get("registrations") if isinstance(payload, dict) else payload
	return [{**row, "source": "dcra"} for row in (rows or [])]


def owned_by(record: dict, eid: str) -> bool:
	"""Whether this e-ID is listed as a proprietor on an already-resolved record.

	Used on the manual-entry path: typing a registration number that resolves
	is not the same as it being yours, so a caller who wants to say which is
	which checks this rather than treating any confirmed lookup as ownership.
	"""
	eid = (eid or "").strip()
	if not eid:
		return False
	return eid in (record.get("proprietor_eids") or [])


def lookup(registration_number: str) -> dict:
	"""Resolve a DCRA registration number to a business.

	Always returns a dict carrying `source`, one of:
	  dcra        — the registry answered
	  unavailable — the registry could not be reached, or is not configured
	"""
	number = normalize(registration_number)
	if not number:
		return _unavailable(number, "no registration number given")
	if not client.configured(SYSTEM):
		return _unavailable(number, "DCRA service is not configured")

	# Quoted: the number is the applicant's own typing and goes into a URL path.
	status, payload = client.get_json(SYSTEM, f"/registrations/{quote(number, safe='')}")

	if status == 404:
		return {
			"registration_number": number,
			"business_name": None,
			"status": "Not Found",
			"source": "dcra",
		}
	if status != 200 or not isinstance(payload, dict):
		return _unavailable(number, "DCRA service did not respond")

	return {
		"registration_number": payload.get("registration_number") or number,
		"business_name": payload.get("business_name"),
		"business_type": payload.get("business_type"),
		"status": payload.get("status"),
		"registered_on": payload.get("registered_on"),
		"region": payload.get("region"),
		"proprietors": payload.get("proprietors") or [],
		"proprietor_eids": payload.get("proprietor_eids") or [],
		"source": "dcra",
	}
