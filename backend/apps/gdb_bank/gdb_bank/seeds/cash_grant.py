"""Seed the KYC register (GDB KYC Record) from a Cash Grant KYC export.

THE FILE is the register's export — `cg_kyc_profile_<date>.xlsx`, or the same
columns saved as CSV — one row per person, its `profile_id` the record's name:

  profile_id, full_name, surname, forenames, id_type, id_number, passport_number,
  date_of_birth, sex, contact_number, cg_contact_number, region, village ID,
  village_name, other_village, lot_street, street, address, bank, bank_branch,
  account_number, name_on_account, account_type, payment_status,
  disbursement_cycle, cheque_number, registration_type, pensioner, shutin

RUN IT on the server, after `bench migrate` (which creates the doctype), with the
file somewhere the bench can read it:

  # 1. what WOULD happen — reads everything, writes nothing
  bench --site <site> execute gdb_bank.seeds.cash_grant.run \\
      --kwargs '{"path": "/home/frappe/cg_kyc_profile_2026-08-28.xlsx", "dry_run": 1}'

  # 2. load it: new people are inserted, people already loaded are left alone
  bench --site <site> execute gdb_bank.seeds.cash_grant.run \\
      --kwargs '{"path": "/home/frappe/cg_kyc_profile_2026-08-28.xlsx"}'

  # a later export: also refresh the people already loaded
  bench --site <site> execute gdb_bank.seeds.cash_grant.run \\
      --kwargs '{"path": "/home/frappe/cg_kyc_profile_2026-09-30.xlsx", "update_existing": 1}'

With Docker: `docker cp` the file into the backend container first, run the same
command through `docker compose exec backend ...`, and delete the copy after.

WHAT IT GUARANTEES

  - Safe to run again: a person is keyed by profile_id, so a second run inserts
    nobody twice, and changes nobody unless `update_existing` is set.
  - Nobody is merged into somebody else. An ID number is unique on the register,
    so a row whose ID number appears twice in the file, or already belongs to a
    DIFFERENT profile in the database, is skipped and reported — never written
    over the other person.
  - ID numbers keep their letters ("RE0010941" is not "0010941"), uppercased,
    spaces and dashes removed. A row with no ID number is loaded: it is still a
    person, though sign-up cannot find them by TIN.
  - Dates of birth are read as Excel dates or as M/D/YYYY text; one that is
    neither is left blank and counted.
  - Each batch commits on its own, so a run stopped halfway keeps what it wrote,
    and running it again carries on.

It writes with one multi-row statement per batch rather than a document save
per person — 600k people load in minutes, not hours. GDB KYC Record has no
controller logic, so nothing a save would run is skipped. The summary is
printed, returned, and written to logs/gdb_bank.log.

The file is real people's identity data: copy it to the server only for the
run, and delete it after. It never belongs in the repository.
"""

import csv
import datetime
import os
import re
import time

import frappe
from frappe.utils import cint, now

from gdb_bank.integrations.kyc_registry import DOCTYPE, normalize_id

BATCH = 2000
# Every column the doctype stores; any other column in the file is ignored.
COLUMNS = [
	"full_name",
	"surname",
	"forenames",
	"id_type",
	"id_number",
	"passport_number",
	"date_of_birth",
	"sex",
	"contact_number",
	"cg_contact_number",
	"region",
	"village_id",
	"village_name",
	"other_village",
	"lot_street",
	"street",
	"address",
	"bank",
	"bank_branch",
	"account_number",
	"name_on_account",
	"account_type",
	"payment_status",
	"disbursement_cycle",
	"cheque_number",
	"registration_type",
	"pensioner",
	"shutin",
]
LONG_TEXT = {"address"}  # Small Text; every other column is a 140-character Data


def _key(header) -> str:
	return str(header or "").strip().lower().replace(" ", "_")


def _rows(path: str):
	"""(row number, {column: value}) for every non-empty row, streamed."""
	ext = os.path.splitext(path)[1].lower()
	if ext in (".xlsx", ".xlsm"):
		import openpyxl

		book = openpyxl.load_workbook(path, read_only=True, data_only=True)
		try:
			rows = book.worksheets[0].iter_rows(values_only=True)
			header = [_key(h) for h in next(rows)]
			for n, row in enumerate(rows, start=2):
				if row and any(v not in (None, "") for v in row):
					yield n, dict(zip(header, row))
		finally:
			book.close()
	elif ext == ".csv":
		with open(path, newline="", encoding="utf-8-sig") as fh:
			reader = csv.reader(fh)
			header = [_key(h) for h in next(reader)]
			for n, row in enumerate(reader, start=2):
				if any((v or "").strip() for v in row):
					yield n, dict(zip(header, row))
	else:
		frappe.throw(f"{path}: give an .xlsx or .csv file.")


def _text(value) -> str | None:
	if value is None:
		return None
	if isinstance(value, float) and value.is_integer():
		value = int(value)
	text = str(value).strip()
	return text or None


def _date(value):
	"""(date or None, False when a value was given but is not a date)."""
	if value in (None, ""):
		return None, True
	if isinstance(value, datetime.datetime):
		return value.date(), True
	if isinstance(value, datetime.date):
		return value, True
	m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$", str(value))
	if m:
		try:
			return datetime.date(int(m.group(3)), int(m.group(1)), int(m.group(2))), True
		except ValueError:
			pass
	m = re.match(r"^\s*(\d{4})-(\d{2})-(\d{2})", str(value))
	if m:
		try:
			return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))), True
		except ValueError:
			pass
	return None, False


def _clean(record: dict) -> tuple[dict, bool]:
	"""The row as the doctype stores it, and whether its date of birth was readable."""
	out, date_ok = {}, True
	for col in COLUMNS:
		value = record.get(col)
		if col == "id_number":
			out[col] = normalize_id(value)
		elif col == "date_of_birth":
			out[col], date_ok = _date(value)
		else:
			text = _text(value)
			out[col] = text if (text is None or col in LONG_TEXT) else text[:140]
	return out, date_ok


def _check(path: str) -> dict:
	"""Pass one: every key in the file, against itself and against the database.
	Returns the rows to skip, and why."""
	seen_pid, seen_id, skip = {}, {}, {}
	rows = 0
	for n, record in _rows(path):
		rows += 1
		pid = _text(record.get("profile_id"))
		if not pid:
			skip[n] = "no profile_id"
			continue
		if pid in seen_pid:
			skip[n] = f"profile_id {pid} repeats row {seen_pid[pid]}"
			continue
		seen_pid[pid] = n
		number = normalize_id(record.get("id_number"))
		if number:
			if number in seen_id:
				skip[n] = f"id_number {number} repeats row {seen_id[number][0]} ({seen_id[number][1]})"
				continue
			seen_id[number] = (n, pid)

	# An ID number already held by a DIFFERENT profile in the database would make
	# a write land on that other person — refused, both ways round.
	held = dict(frappe.db.sql(f"select id_number, name from `tab{DOCTYPE}` where ifnull(id_number, '') != ''"))
	for number, (n, pid) in seen_id.items():
		owner = held.get(number)
		if owner and owner != pid and n not in skip:
			skip[n] = f"id_number {number} already belongs to {owner}"
	return {"rows": rows, "skip": skip}


def _write(batch: list[list], update: bool) -> None:
	"""One INSERT for the batch; with `update`, a profile already loaded has its
	columns replaced (keyed on the name — pass one has already refused any row
	whose id_number belongs to someone else)."""
	fields = ["name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "profile_id", *COLUMNS]
	cols = ", ".join(f"`{f}`" for f in fields)
	row = "(" + ", ".join(["%s"] * len(fields)) + ")"
	sql = f"insert into `tab{DOCTYPE}` ({cols}) values {', '.join([row] * len(batch))}"
	if update:
		sql += " on duplicate key update " + ", ".join(
			f"`{f}` = values(`{f}`)" for f in [*COLUMNS, "modified", "modified_by"]
		)
	else:
		sql += " on duplicate key update `name` = `name`"  # leave a loaded profile alone
	frappe.db.sql(sql, [v for r in batch for v in r])


def run(path: str, dry_run=0, update_existing=0, batch_size=BATCH) -> dict:
	"""Load a Cash Grant KYC export into GDB KYC Record. See the module docstring."""
	dry_run, update_existing = cint(dry_run), cint(update_existing)
	batch_size = max(100, min(cint(batch_size) or BATCH, 10000))
	if not os.path.isfile(path):
		frappe.throw(f"{path}: no such file.")
	if not frappe.db.table_exists(DOCTYPE):
		frappe.throw(f"{DOCTYPE} does not exist yet — run bench migrate first.")
	started = time.time()
	say = lambda msg: (print(msg, flush=True), frappe.logger("gdb_bank", allow_site=True).info(f"cash grant seed: {msg}"))  # noqa: E731

	say(f"checking {path}")
	checked = _check(path)
	skip = checked["skip"]
	existing = set(frappe.db.sql_list(f"select name from `tab{DOCTYPE}`"))
	say(f"{checked['rows']} rows; {len(skip)} to skip; {len(existing)} people already loaded")

	inserted = updated = unchanged = bad_dates = 0
	batch, stamp, user = [], now(), "Administrator"
	for n, record in _rows(path):
		if n in skip:
			continue
		pid = _text(record.get("profile_id"))
		values, date_ok = _clean(record)
		bad_dates += 0 if date_ok else 1
		if pid in existing:
			if not update_existing:
				unchanged += 1
				continue
			updated += 1
		else:
			inserted += 1
		batch.append([pid, user, stamp, stamp, user, 0, 0, pid, *(values[c] for c in COLUMNS)])
		if len(batch) >= batch_size:
			if not dry_run:
				_write(batch, update_existing)
				frappe.db.commit()
			batch = []
			if (inserted + updated) % 50000 < batch_size:
				say(f"… {inserted} inserted, {updated} updated ({time.time() - started:.0f}s)")
	if batch and not dry_run:
		_write(batch, update_existing)
		frappe.db.commit()

	summary = {
		"file": path,
		"dry_run": bool(dry_run),
		"rows": checked["rows"],
		"inserted": inserted,
		"updated": updated,
		"left_unchanged": unchanged,
		"skipped": len(skip),
		"unreadable_dates": bad_dates,
		"total_now": frappe.db.count(DOCTYPE),
		"seconds": round(time.time() - started),
		# The first few reasons, so a skip is never silent; the full list is in the log.
		"skipped_examples": [f"row {n}: {why}" for n, why in sorted(skip.items())[:20]],
	}
	for n, why in sorted(skip.items()):
		frappe.logger("gdb_bank", allow_site=True).warning(f"cash grant seed: skipped row {n}: {why}")
	say(("DRY RUN — nothing written. " if dry_run else "") + str({k: v for k, v in summary.items() if k != "skipped_examples"}))
	return summary
