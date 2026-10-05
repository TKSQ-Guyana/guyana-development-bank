"""The KYC register: what the State already holds about a person, by ID number.

Sign-up asks for a 9-digit number and fills the rest from here — names, date of
birth, the phone on record, where they live. The phone is the one the sign-up
code goes to, and it never leaves the server whole: the form is told only its
last four digits, and the person confirms it is theirs.

WHERE THE RECORDS LIVE. In ERPNext, as GDB KYC Record — loaded from the
register's export, visible and correctable on the desk. Until any are loaded,
a local JSON file stands in (`fixtures/kyc_registry.local`, gitignored, or
site_config `gdb_kyc_registry_path` / GDB_KYC_REGISTRY_PATH). Neither: no
lookup, and sign-up works exactly as before, with everything typed. Real
people's records either way — never in git.

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


def normalize_id(value) -> str | None:
	"""An ID number as the register holds it: letters kept (a passport-style
	"RE0010941" is not "0010941"), uppercased, spaces and dashes dropped."""
	if value is None:
		return None
	if isinstance(value, float) and value.is_integer():
		value = int(value)
	text = re.sub(r"[\s\-]", "", str(value)).upper()
	return text or None


DOCTYPE = "GDB KYC Record"


def _from_erpnext(number: str) -> dict | None | bool:
	"""The GDB KYC Record under this ID number; False when none are loaded at
	all (the file then stands in)."""
	if not frappe.db.table_exists(DOCTYPE) or not frappe.db.count(DOCTYPE):
		return False
	name = frappe.db.get_value(DOCTYPE, {"id_number": number}) or frappe.db.get_value(
		DOCTYPE, {"passport_number": number}
	)
	return frappe.get_doc(DOCTYPE, name).as_dict() if name else None


def _records() -> dict:
	"""Every record in the local file, by its ID number's digits. Read on each
	call: the file is small, and an edit to it then applies without a restart."""
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


def _birth_date(value) -> str | None:
	"""The register writes M/D/YYYY; the portal holds YYYY-MM-DD."""
	if isinstance(value, date):
		return value.isoformat()
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


def _record(number) -> dict | None:
	"""The register row under this ID number: as the register holds it (letters
	kept — a passport-style "R1234567"), else by its digits alone."""
	keys = [k for k in dict.fromkeys((normalize_id(number), _digits(number))) if k]
	for key in keys:
		record = _from_erpnext(key)
		if record is False:
			records = _records()
			record = records.get(key) or records.get(_digits(key))
		if record:
			return record
	return None


def lookup(number: str) -> dict | None:
	"""The person on record under this ID number, in the portal's shape, or None.
	Carries the WHOLE phone — callers outside this server get `public()` only."""
	record = _record(number)
	if not record:
		return None
	address = ", ".join(p.strip() for p in (record.get("lot_street"), record.get("street"), record.get("address")) if (p or "").strip())
	return {
		# Server-side only — names the reference photo (face_check); public() drops it.
		"profile_id": record.get("profile_id") or record.get("name"),
		"first_name": _name(record.get("forenames")),
		"last_name": _name(record.get("surname")),
		"date_of_birth": _birth_date(record.get("date_of_birth")),
		"sex": record.get("sex") or None,
		"phone": _phone(record),
		"region": _region(record.get("region")),
		"village": _name(record.get("village_name") or record.get("other_village")),
		"address": address,
		"id_type": record.get("id_type") or None,
		# The account the register pays this person into — server-side; offered
		# back only to the person themselves (api.my_kyc_bank_account).
		"bank": (record.get("bank") or "").strip(),
		"bank_branch": (record.get("bank_branch") or "").strip(),
		"account_number": (record.get("account_number") or "").strip(),
		"name_on_account": (record.get("name_on_account") or "").strip(),
		"account_type": (record.get("account_type") or "").strip(),
		"full_name": (record.get("full_name") or "").strip(),
	}


def id_numbers(number: str | None) -> dict | None:
	"""The ID numbers the register holds for the person signed up under this
	National ID — their ID number and any passport number, compacted as
	evidence.clean_id_number compacts what an applicant types — or None."""
	if not number:
		return None
	record = _record(number)
	if not record:
		return None
	numbers = {normalize_id(record.get(f)) for f in ("id_number", "passport_number")}
	numbers.discard(None)
	numbers.discard("")
	return {"id_type": record.get("id_type") or None, "numbers": numbers} if numbers else None


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


def import_rows(rows: list[dict]) -> dict:
	"""Load register rows (the export's columns) as GDB KYC Records. A row whose
	profile_id is already loaded is updated, never duplicated. Answers what
	happened, row by row."""
	done = {"created": [], "updated": [], "failed": []}
	fields = {f.fieldname for f in frappe.get_meta(DOCTYPE).fields}
	for row in rows:
		values = {k.strip().lower().replace(" ", "_"): (v if v is not None else "") for k, v in row.items()}
		values = {k: (str(v).strip() if not isinstance(v, date) else v) for k, v in values.items() if k in fields}
		values["date_of_birth"] = _birth_date(values.get("date_of_birth")) or None
		# Unique when present; a register row without one is still a person.
		values["id_number"] = normalize_id(values.get("id_number"))
		pid = values.get("profile_id")
		try:
			if not pid:
				raise ValueError("profile_id is required")
			if frappe.db.exists(DOCTYPE, pid):
				doc = frappe.get_doc(DOCTYPE, pid)
				doc.update(values)
				doc.save(ignore_permissions=True)
				done["updated"].append(pid)
			else:
				frappe.get_doc({"doctype": DOCTYPE, **values}).insert(ignore_permissions=True)
				done["created"].append(pid)
		except Exception as exc:
			done["failed"].append(f"{pid or '?'}: {exc}")
	return done
