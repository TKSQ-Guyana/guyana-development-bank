"""The GDB Team Report, live: what the GDB Manager's page (frontend
features/manager) shows and re-reads every few seconds.

Every submitted application (a submitted Loan Application), counted by
product, created date, business stage, region, sector, applicant age and
business registration, plus a review list of potential fraud leads.

Figures, as the report defines them:
  region        the region on the applicant's portal profile; where that is
                blank, the business location on the application
  age           from the date of birth on the applicant's profile, as of today
  registration  a DCRA number that is really one — "N/A", "NIL", "NONE",
                "0000000" and the like count as not registered

The fraud list is leads for a loan officer, not findings:
  shared address   the same lot number and street in the same village/town,
                   on applicants with different names. High: same surname
                   (likely one household). Medium: different surnames. Low:
                   the same address with no lot number (an area name only).
  shared phone     the same phone on different applicants at different
                   addresses (high)
  duplicate ID     one National ID on two different accounts (high)
  repeated name    the same name on different accounts (medium; high when the
                   date of birth matches too)
  shared bank      one bank account nominated by two borrowers — only once
                   cases are approved, as that is when GDB records the account

Read-only and cached for CACHE_SECONDS, so any number of open pages polling at
once cost the database one set of queries.
"""

import re
from collections import defaultdict
from datetime import date

import frappe
from frappe.utils import flt, getdate, now_datetime

from gdb_bank.install import QUICK_LOAN_PRODUCT_NAME

CACHE_KEY = "gdb_manager_report"
CACHE_SECONDS = 10
FRAUD_LIMIT = 200

REGIONS = (
	(1, "Barima-Waini"),
	(2, "Pomeroon-Supenaam"),
	(3, "Essequibo Islands-West Demerara"),
	(4, "Demerara-Mahaica"),
	(5, "Mahaica-Berbice"),
	(6, "East Berbice-Corentyne"),
	(7, "Cuyuni-Mazaruni"),
	(8, "Potaro-Siparuni"),
	(9, "Upper Takutu-Upper Essequibo"),
	(10, "Upper Demerara-Berbice"),
)
_REGION_NO = re.compile(r"region\s*(\d{1,2})\b", re.IGNORECASE)

AGE_BANDS = ((18, 24), (25, 34), (35, 44), (45, 54), (55, 64), (65, 200))
STRUCTURES = ("Sole Trader", "Partnership", "Incorporated (Inc.)", "Other")

# What applicants type when they have no registration to give.
_NOT_A_NUMBER = {"", "NA", "NIL", "NONE", "NULL", "NO", "NOTAPPLICABLE", "TBD", "PENDING", "NOTREGISTERED"}

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def report() -> dict:
	cached = frappe.cache.get_value(CACHE_KEY)
	if cached:
		return cached
	out = _build()
	frappe.cache.set_value(CACHE_KEY, out, expires_in_sec=CACHE_SECONDS)
	return out


# ---------------------------------------------------------------------------
# reading the values
# ---------------------------------------------------------------------------


def _region_no(value: str | None) -> int | None:
	match = _REGION_NO.search(value or "")
	if match and 1 <= int(match.group(1)) <= 10:
		return int(match.group(1))
	return None


def registered(dcra: str | None) -> bool:
	"""Whether a DCRA number is one: not blank, not a placeholder ("N/A",
	"NIL", "NONE"), not all zeros, and holding at least one digit."""
	plain = re.sub(r"[^A-Z0-9]", "", (dcra or "").upper())
	if plain in _NOT_A_NUMBER or not re.search(r"\d", plain):
		return False
	return bool(plain.strip("0"))


def _age(born, today: date) -> int | None:
	if not born:
		return None
	born = getdate(born)
	return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _band(age: int | None) -> str:
	if age is None:
		return "Not stated"
	for low, high in AGE_BANDS:
		if low <= age <= high:
			return f"{low}+" if high >= 200 else f"{low}–{high}"
	return "Under 18"


def _structure(value: str | None) -> str:
	value = (value or "").strip()
	return value if value in STRUCTURES else ("Other" if value else "Not stated")


def _words(text: str | None) -> str:
	"""An address as compared: lower case, '&' as 'and', no punctuation, the
	usual street words shortened, no 'lot'."""
	text = (text or "").lower().replace("&", " and ")
	text = re.sub(r"[^a-z0-9 ]+", " ", text)
	for long, short in (("street", "st"), ("road", "rd"), ("avenue", "ave"), ("housing scheme", "hs"), ("scheme", "hs")):
		text = re.sub(rf"\b{long}\b", short, text)
	text = re.sub(r"\blot\b|\bno\b", " ", text)
	return re.sub(r"\s+", " ", text).strip()


def _address_key(address: str | None, village: str | None) -> tuple[str, bool] | None:
	"""(key, has_lot) for an applicant's address, or None with none given.
	With a lot number: the number, the street words after it and the village.
	Without: the whole address (an area name), which is a weaker match."""
	words = _words(address)
	place = _words(village)
	if not words and not place:
		return None
	lot = re.search(r"\b(\d+[a-z]?)\b", words)
	if lot:
		street = " ".join(w for w in words[lot.end():].split() if w not in place.split())[:40]
		return f"{lot.group(1)}|{street}|{place}", True
	return f"{words}|{place}", False


def _phone(value: str | None) -> str:
	digits = re.sub(r"\D", "", value or "")
	return digits[-7:] if len(digits) >= 7 else ""


def _name(value: str | None) -> str:
	return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", "", (value or "").lower())).strip()


def _surname(value: str | None) -> str:
	parts = _name(value).split()
	return parts[-1] if parts else ""


def _month_year(born) -> str:
	if not born:
		return "no DOB"
	born = getdate(born)
	return f"{MONTHS[born.month - 1]} {born.year}"


# ---------------------------------------------------------------------------
# the report
# ---------------------------------------------------------------------------


def _build() -> dict:
	now = now_datetime()
	today = now.date()
	quick_products = set(frappe.get_all("Loan Product", {"product_name": QUICK_LOAN_PRODUCT_NAME}, pluck="name"))

	rows = frappe.db.sql(
		"""select a.name, a.creation, a.loan_product, a.loan_amount, a.status, a.applicant,
			a.applicant_name, a.applicant_phone_number, a.gdb_owner, a.gdb_business_stage,
			a.gdb_dcra_number, a.gdb_legal_structure, a.gdb_sector, a.gdb_no_bank_account,
			a.gdb_trade_region, a.gdb_operating_location,
			p.region, p.address, p.village_or_town, p.phone, p.verified_phone,
			p.date_of_birth, p.verified_birth_date, p.national_id, u.gdb_national_id
		from `tabLoan Application` a
		left join `tabGDB Citizen Profile` p on p.user = a.gdb_owner
		left join `tabUser` u on u.name = a.gdb_owner
		where a.docstatus = 1
		order by a.name""",
		as_dict=True,
	)

	total = {"n": 0, "amt": 0.0}
	sme = {"n": 0, "amt": 0.0}
	quick = {"n": 0, "amt": 0.0}
	by_date = defaultdict(lambda: {"sme": [0, 0.0], "quick": [0, 0.0]})
	stage = defaultdict(lambda: [0, 0.0])
	region = defaultdict(lambda: [0, 0.0])
	sector = defaultdict(lambda: [0, 0.0])
	age = defaultdict(lambda: [0, 0.0])
	reg = {
		True: {"n": 0, "amt": 0.0, "existing": 0, "new": 0, "other": 0},
		False: {"n": 0, "amt": 0.0, "existing": 0, "new": 0, "other": 0},
	}
	structures = defaultdict(lambda: {"with": 0, "without": 0})
	no_bank = 0
	approved = 0

	for r in rows:
		amount = flt(r.loan_amount)
		is_quick = r.loan_product in quick_products
		product = quick if is_quick else sme
		for bucket in (total, product):
			bucket["n"] += 1
			bucket["amt"] += amount
		day = by_date[str(r.creation.date())]["quick" if is_quick else "sme"]
		day[0] += 1
		day[1] += amount
		if r.status == "Approved":
			approved += 1
		if r.gdb_no_bank_account:
			no_bank += 1

		if is_quick:
			key = "Not captured (Quick Loan)"
		else:
			key = {"New": "New business (SME)", "Existing": "Existing business (SME)"}.get(
				(r.gdb_business_stage or "").title(), "Not stated (SME)"
			)
		stage[key][0] += 1
		stage[key][1] += amount

		no = _region_no(r.region) or _region_no(r.gdb_trade_region) or _region_no(r.gdb_operating_location)
		label = f"Region {no} — {dict(REGIONS)[no]}" if no else "Not stated"
		region[label][0] += 1
		region[label][1] += amount

		label = (r.gdb_sector or "").strip() or "Not stated"
		sector[label][0] += 1
		sector[label][1] += amount

		label = _band(_age(r.date_of_birth or r.verified_birth_date, today))
		age[label][0] += 1
		age[label][1] += amount

		if not is_quick:
			has = registered(r.gdb_dcra_number)
			side = reg[has]
			side["n"] += 1
			side["amt"] += amount
			side[{"Existing": "existing", "New": "new"}.get((r.gdb_business_stage or "").title(), "other")] += 1
			structures[_structure(r.gdb_legal_structure)]["with" if has else "without"] += 1

	region_order = [f"Region {no} — {name}" for no, name in REGIONS] + ["Not stated"]
	band_order = [_band(low) for low, _high in AGE_BANDS] + ["Under 18", "Not stated"]
	fraud, duplicate_ids = _fraud(rows, quick_products)
	shared_banks = _shared_bank_accounts()
	fraud = shared_banks + fraud

	return {
		"as_of": now.isoformat(),
		"total": total,
		"sme": sme,
		"quick": quick,
		"by_date": [
			{"d": d, "sme": v["sme"], "quick": v["quick"]} for d, v in sorted(by_date.items(), reverse=True)
		],
		"stage": [
			[k, *stage[k]]
			for k in ("New business (SME)", "Existing business (SME)", "Not stated (SME)", "Not captured (Quick Loan)")
			if stage[k][0]
		],
		"region": [[k, *region[k]] for k in region_order if region[k][0]],
		"sector": sorted(
			([k, *v] for k, v in sector.items()), key=lambda x: (x[0] == "Not stated", -x[1], x[0])
		),
		"age": [[k, *age[k]] for k in band_order if age[k][0]],
		"registration": {
			"with": reg[True],
			"without": reg[False],
			"structures": [
				[k, structures[k]["with"], structures[k]["without"]]
				for k in (*STRUCTURES, "Not stated")
				if k != "Not stated" or (structures[k]["with"] + structures[k]["without"])
			],
		},
		"no_bank_account": no_bank,
		"approved": approved,
		"duplicate_ids": duplicate_ids,
		"bank_checked": bool(approved),
		"fraud": fraud[:FRAUD_LIMIT],
		"fraud_total": len(fraud),
	}


# ---------------------------------------------------------------------------
# potential fraud
# ---------------------------------------------------------------------------

RISK_ORDER = {"high": 0, "med": 1, "low": 2}


def _app(r, quick_products) -> list:
	return [r.name, r.applicant_name or "", "Quick" if r.loan_product in quick_products else "SME", flt(r.loan_amount)]


def _people(group) -> int:
	return len({r.gdb_owner or r.applicant or r.name for r in group})


def _fraud(rows, quick_products) -> tuple[list[dict], int]:
	leads: list[dict] = []

	# Shared household address.
	by_address = defaultdict(list)
	shown = {}
	for r in rows:
		key = _address_key(r.address, r.village_or_town)
		if key:
			by_address[key].append(r)
			shown.setdefault(key, ", ".join(x for x in ((r.address or "").strip(), (r.village_or_town or "").strip()) if x))
	address_of = {}
	for (key, has_lot), group in by_address.items():
		for r in group:
			address_of[r.name] = key
		if _people(group) < 2 or len({_name(r.applicant_name) for r in group}) < 2:
			continue
		if not has_lot:
			risk = "low"
			label = f"{shown[(key, has_lot)]} (area only)"
		else:
			# One surname per person: two applications by one person are not a household.
			surnames = list({(r.gdb_owner or r.name): _surname(r.applicant_name) for r in group}.values())
			risk = "high" if len(set(surnames)) < len(surnames) else "med"
			label = shown[(key, has_lot)]
		leads.append({"type": "Shared address", "risk": risk, "key": label, "apps": [_app(r, quick_products) for r in group]})

	# Shared phone, at different addresses.
	by_phone = defaultdict(list)
	for r in rows:
		phone = _phone(r.phone or r.verified_phone or r.applicant_phone_number)
		if phone:
			by_phone[phone].append(r)
	for group in by_phone.values():
		if _people(group) < 2:
			continue
		if len({address_of.get(r.name) for r in group}) < 2:
			continue  # one household: already a shared-address lead
		leads.append(
			{"type": "Shared phone", "risk": "high", "key": "Same phone number, different addresses",
			 "apps": [_app(r, quick_products) for r in group]}
		)

	# One National ID on two accounts.
	by_id = defaultdict(list)
	for r in rows:
		nid = re.sub(r"\W", "", (r.gdb_national_id or r.national_id or "")).upper()
		if nid:
			by_id[nid].append(r)
	duplicate_ids = 0
	for group in by_id.values():
		if _people(group) < 2:
			continue
		duplicate_ids += 1
		leads.append(
			{"type": "Duplicate ID", "risk": "high", "key": "Same National ID on different accounts",
			 "apps": [_app(r, quick_products) for r in group]}
		)

	# The same name on different accounts.
	by_name = defaultdict(list)
	for r in rows:
		name = _name(r.applicant_name)
		if len(name.split()) >= 2:
			by_name[name].append(r)
	for group in by_name.values():
		if _people(group) < 2:
			continue
		births = [r.date_of_birth or r.verified_birth_date for r in group]
		same_birth = len({str(b) for b in births if b}) == 1 and all(births)
		dobs = " vs ".join(dict.fromkeys(_month_year(b) for b in births))
		leads.append(
			{
				"type": "Same name",
				"risk": "high" if same_birth else "med",
				"key": "Same name and date of birth, different accounts"
				if same_birth
				else f"Same name, different ID and DOB ({dobs})",
				"apps": [_app(r, quick_products) for r in group],
			}
		)

	leads.sort(key=lambda f: (RISK_ORDER[f["risk"]], -max(_serial(a[0]) for a in f["apps"])))
	return leads, duplicate_ids


def _serial(name: str) -> int:
	digits = re.findall(r"\d+", name or "")
	return int(digits[-1]) if digits else 0


def _shared_bank_accounts() -> list[dict]:
	"""One bank account nominated by two borrowers on approved cases."""
	rows = frappe.db.sql(
		"""select b.bank_account_no, a.name, a.applicant_name, a.loan_product, a.loan_amount, a.applicant
		from `tabLoan Application` a
		join `tabBank Account` b on b.party_type = 'Customer' and b.party = a.applicant
		where a.docstatus = 1 and a.status = 'Approved' and ifnull(b.bank_account_no, '') != ''""",
		as_dict=True,
	)
	if not rows:
		return []
	quick_products = set(frappe.get_all("Loan Product", {"product_name": QUICK_LOAN_PRODUCT_NAME}, pluck="name"))
	by_account = defaultdict(list)
	for r in rows:
		by_account[re.sub(r"\D", "", r.bank_account_no)].append(r)
	return [
		{
			"type": "Shared bank account",
			"risk": "high",
			"key": f"Same bank account ending {acct[-4:]}",
			"apps": [[r.name, r.applicant_name or "", "Quick" if r.loan_product in quick_products else "SME", flt(r.loan_amount)] for r in group],
		}
		for acct, group in by_account.items()
		if acct and len({r.applicant for r in group}) > 1
	]
