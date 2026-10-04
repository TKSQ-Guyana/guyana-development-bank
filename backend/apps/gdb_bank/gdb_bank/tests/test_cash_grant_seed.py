"""The Cash Grant KYC seed (gdb_bank/seeds/cash_grant.py).

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_cash_grant_seed
"""

import csv
import datetime
import os
import tempfile
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank.integrations import kyc_registry
from gdb_bank.seeds import cash_grant

HEADER = [
	"profile_id", "full_name", "surname", "forenames", "id_type", "id_number", "passport_number",
	"date_of_birth", "sex", "contact_number", "cg_contact_number", "region", "village ID", "village_name",
	"other_village", "lot_street", "street", "address", "bank", "bank_branch", "account_number",
	"name_on_account", "account_type", "payment_status", "disbursement_cycle", "cheque_number",
	"registration_type", "pensioner", "shutin",
]  # fmt: skip


def row(pid, id_number, dob=datetime.datetime(1989, 3, 3), name="SEED TESTER", village="EAST"):
	values = dict.fromkeys(HEADER, "")
	values.update(
		{
			"profile_id": pid,
			"full_name": name,
			"surname": name.split()[-1],
			"forenames": name.split()[0],
			"id_number": id_number,
			"date_of_birth": dob,
			"cg_contact_number": "665-5532",
			"region": "Region 04",
			"village ID": 4132,
			"village_name": village,
		}
	)
	return [values[h] for h in HEADER]


class TestCashGrantSeed(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		self.dir = tempfile.mkdtemp()

	def xlsx(self, rows) -> str:
		import openpyxl

		book = openpyxl.Workbook()
		sheet = book.active
		sheet.append(HEADER)
		for r in rows:
			sheet.append(r)
		path = os.path.join(self.dir, "export.xlsx")
		book.save(path)
		return path

	def seed(self, path, **kwargs) -> dict:
		with patch("builtins.print"):
			return cash_grant.run(path, **kwargs)

	def test_a_dry_run_reads_everything_and_writes_nothing(self):
		before = frappe.db.count(kyc_registry.DOCTYPE)
		result = self.seed(self.xlsx([row("SEED-1", 900200300), row("SEED-2", 900200301)]), dry_run=1)
		self.assertEqual((result["rows"], result["inserted"]), (2, 2))
		self.assertEqual(frappe.db.count(kyc_registry.DOCTYPE), before)

	def test_it_loads_people_as_the_register_writes_them(self):
		path = self.xlsx(
			[
				row("SEED-1", 900200300),
				row("SEED-2", "zq-009 9941"),  # letters kept, spaces and dashes dropped
				row("SEED-3", None),  # no ID number: still a person
				row("SEED-4", 900200303, dob="12/30/1991"),
				row("SEED-5", 900200304, dob="not a date"),
			]
		)
		result = self.seed(path)
		self.assertEqual((result["inserted"], result["skipped"], result["unreadable_dates"]), (5, 0, 1))
		get = lambda pid, f: frappe.db.get_value(kyc_registry.DOCTYPE, pid, f)  # noqa: E731
		self.assertEqual(get("SEED-1", "id_number"), "900200300")
		self.assertEqual(get("SEED-2", "id_number"), "ZQ0099941")
		self.assertIsNone(get("SEED-3", "id_number"))
		self.assertEqual(str(get("SEED-4", "date_of_birth")), "1991-12-30")
		self.assertIsNone(get("SEED-5", "date_of_birth"))
		self.assertEqual(get("SEED-1", "village_id"), "4132")
		# And sign-up finds them by TIN.
		self.assertEqual(kyc_registry.lookup("900-200-300")["last_name"], "Tester")

	def test_running_it_again_inserts_nobody_twice_and_changes_nobody(self):
		path = self.xlsx([row("SEED-1", 900200300)])
		self.seed(path)
		changed = self.xlsx([row("SEED-1", 900200300, village="WEST")])
		again = self.seed(changed)
		self.assertEqual((again["inserted"], again["left_unchanged"]), (0, 1))
		self.assertEqual(frappe.db.get_value(kyc_registry.DOCTYPE, "SEED-1", "village_name"), "EAST")

	def test_update_existing_refreshes_people_already_loaded(self):
		self.seed(self.xlsx([row("SEED-1", 900200300)]))
		result = self.seed(self.xlsx([row("SEED-1", 900200300, village="WEST")]), update_existing=1)
		self.assertEqual(result["updated"], 1)
		self.assertEqual(frappe.db.get_value(kyc_registry.DOCTYPE, "SEED-1", "village_name"), "WEST")

	def test_nobody_is_merged_into_somebody_else(self):
		self.seed(self.xlsx([row("SEED-1", 900200300, name="FIRST PERSON")]))
		result = self.seed(
			self.xlsx(
				[
					row("SEED-9", 900200300, name="INTRUDER ONE"),  # ID already held by SEED-1
					row("SEED-7", 900200399),
					row("SEED-8", 900200399),  # repeats the row above
					row("SEED-7", 900200398),  # repeats a profile_id
				]
			),
			update_existing=1,
		)
		self.assertEqual(result["skipped"], 3)
		self.assertEqual(result["inserted"], 1)
		self.assertTrue(any("already belongs to SEED-1" in s for s in result["skipped_examples"]))
		self.assertEqual(frappe.db.get_value(kyc_registry.DOCTYPE, "SEED-1", "full_name"), "FIRST PERSON")
		self.assertFalse(frappe.db.exists(kyc_registry.DOCTYPE, "SEED-9"))

	def test_a_csv_export_loads_the_same_way(self):
		path = os.path.join(self.dir, "export.csv")
		with open(path, "w", newline="", encoding="utf-8") as fh:
			writer = csv.writer(fh)
			writer.writerow(HEADER)
			writer.writerow(row("SEED-C1", "900200500", dob="5/28/1988"))
		result = self.seed(path)
		self.assertEqual(result["inserted"], 1)
		self.assertEqual(str(frappe.db.get_value(kyc_registry.DOCTYPE, "SEED-C1", "date_of_birth")), "1988-05-28")
