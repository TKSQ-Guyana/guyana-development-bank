"""The KYC register: what the State already holds about a person, by ID number.

Sign-up asks for a 9-digit number and fills the rest from here — names, date of
birth, the phone on record, where they live. The phone is the one the sign-up
code goes to, and it never leaves the server whole: the form is told only its
last four digits, and the person confirms it is theirs.

THE DATA IS LOCAL, AND NEVER IN GIT. Real people's records — names, ID numbers,
dates of birth, phones, bank accounts — live in a JSON file outside source
control (`fixtures/kyc_registry.local`; `*.local` is gitignored), or wherever
site_config `gdb_kyc_registry_path` / GDB_KYC_REGISTRY_PATH points. No file, no
lookup: sign-up works exactly as before, with everything typed.

A STAND-IN FOR THE REAL REGISTER. The lookup is one function (`lookup`), so
reading the live register over its API later is a change here alone.
"""

import json
import os
import re
from datetime import date

import frappe

DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "kyc_registry.local")


def _path() -> str:
	return str(
		frappe.conf.get("gdb_kyc_registry_path") or os.environ.get("GDB_KYC_REGISTRY_PATH") or DEFAULT_PATH
	)


def _digits(value) -> str:
	return "".join(c for c in str(value or "") if c.isdigit())


def _records() -> dict:
	"""Every record, by its ID number's digits. Read on each call: the file is
	small, and an edit to it then applies without a restart."""
	path = _path()
	if not os.path.exists(path):
		return {}
	try:
		with open(path, encoding="utf-8") as fh:
			rows = json.load(fh)
	except (OSError, ValueError):
		frappe.logger("gdb_bank").error(f"kyc register at {path} could not be read")
		return {}
	return {_digits(r.get("id_number")): r for r in rows if _digits(r.get("id_number"))}


def _birth_date(value: str) -> str | None:
	"""The register writes M/D/YYYY; the portal holds YYYY-MM-DD."""
	m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$", value or "")
	if not m:
		return None
	try:
		return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
	except ValueError:
		return None


def _phone(record: dict) -> str:
	"""The Guyana number on record, as +592 and seven digits, or ""."""
	for key in ("contact_number", "cg_contact_number"):
		digits = _digits(record.get(key))
		if digits.startswith("592") and len(digits) == 10:
			digits = digits[3:]
		if len(digits) == 7:
			return f"+592{digits}"
	return ""


def _region(value: str) -> str | None:
	""""Region 07" as the portal's list spells it ("Region 7 — Cuyuni-Mazaruni")."""
	from gdb_bank.gdb_bank.doctype.gdb_citizen_profile.gdb_citizen_profile import canonical_region

	m = re.match(r"^\s*region\s+0*(\d+)\s*$", value or "", re.IGNORECASE)
	return canonical_region(f"Region {int(m.group(1))}") if m else None


def _name(value: str) -> str:
	return " ".join(w.title() for w in (value or "").split())


def lookup(number: str) -> dict | None:
	"""The person on record under this ID number, in the portal's shape, or None.
	Carries the WHOLE phone — callers outside this server get `public()` only."""
	record = _records().get(_digits(number))
	if not record:
		return None
	address = ", ".join(p.strip() for p in (record.get("lot_street"), record.get("street"), record.get("address")) if (p or "").strip())
	return {
		"first_name": _name(record.get("forenames")),
		"last_name": _name(record.get("surname")),
		"date_of_birth": _birth_date(record.get("date_of_birth")),
		"sex": record.get("sex") or None,
		"phone": _phone(record),
		"region": _region(record.get("region")),
		"village": _name(record.get("village_name") or record.get("other_village")),
		"address": address,
		"id_type": record.get("id_type") or None,
	}


def masked_phone(phone: str) -> str:
	"""The first three digits hidden, the last four shown: •••-5532."""
	digits = _digits(phone)[-7:]
	return f"•••-{digits[-4:]}" if len(digits) >= 4 else ""


def public(person: dict) -> dict:
	"""What a sign-up form may be told: the person's details, the phone masked."""
	return {
		"found": True,
		"first_name": person["first_name"],
		"last_name": person["last_name"],
		"date_of_birth": person["date_of_birth"],
		"region": person["region"],
		"village": person["village"],
		"has_phone": bool(person["phone"]),
		"phone_masked": masked_phone(person["phone"]),
	}
