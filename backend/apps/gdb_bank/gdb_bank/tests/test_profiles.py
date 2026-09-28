"""The citizen profile keeps only on-list regions, whatever form one arrives in.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_profiles
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import profiles

CITIZEN = "test-gdb-profile@example.gy"
REGION_4 = "Region 4 — Demerara-Mahaica"


class TestProfileRegion(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		frappe.get_doc(
			{
				"doctype": "User",
				"email": CITIZEN,
				"first_name": "Profile",
				"send_welcome_email": 0,
				"roles": [{"role": "Citizen"}],
			}
		).insert(ignore_permissions=True)

	def save_region(self, region: str) -> str:
		with self.set_user(CITIZEN):
			return profiles.save_profile(region=region)["region"]

	def test_a_hyphen_or_a_lost_dash_is_stored_as_the_list_spells_it(self):
		for arrived in ("Region 4 - Demerara-Mahaica", "Region 4 � Demerara-Mahaica", REGION_4):
			self.assertEqual(self.save_region(arrived), REGION_4, arrived)

	def test_a_region_that_is_not_on_the_list_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save_region("Somewhere else")

	def test_personal_financials_save_despite_an_old_broken_region(self):
		with self.set_user(CITIZEN):
			name = profiles.my_profile()["name"]
		frappe.db.set_value(profiles.DOCTYPE, name, "region", "Region 4 � Demerara-Mahaica")

		with self.set_user(CITIZEN):
			saved = profiles.save_personal_financials(
				employment_status="Employed", monthly_income="1000", monthly_expenses="500"
			)
		self.assertEqual(saved["region"], REGION_4)
