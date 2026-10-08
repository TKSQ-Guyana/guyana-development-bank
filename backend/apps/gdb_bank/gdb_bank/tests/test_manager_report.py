"""The GDB Team Report (services/manager_report) and the GDB Manager persona
that reads it.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_manager_report
"""

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api
from gdb_bank.services import manager_report as report

MANAGER = "test-gdb-manager@example.gy"


def row(name, person, applicant_name, address="", village="", phone="", dob=None, nid="", product="SME", amount=300000):
	return frappe._dict(
		name=name, gdb_owner=person, applicant=person, applicant_name=applicant_name, address=address,
		village_or_town=village, phone=phone, verified_phone="", applicant_phone_number="",
		date_of_birth=dob, verified_birth_date=None, gdb_national_id=nid, national_id="",
		loan_product="quick" if product == "Quick" else "sme", loan_amount=amount,
	)


class TestTheTeamReport(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		frappe.cache.delete_value(report.CACHE_KEY)
		if not frappe.db.exists("User", MANAGER):
			frappe.get_doc(
				{"doctype": "User", "email": MANAGER, "first_name": "Manager", "send_welcome_email": 0,
				 "roles": [{"role": "GDB Manager"}]}
			).insert(ignore_permissions=True)

	def test_a_manager_reads_it(self):
		with self.set_user(MANAGER):
			out = api.manager_report()
		for key in ("total", "sme", "quick", "by_date", "stage", "region", "sector", "age", "registration", "fraud"):
			self.assertIn(key, out)

	def test_nobody_else_may(self):
		with self.set_user("Guest"), self.assertRaises(frappe.AuthenticationError):
			api.manager_report()
		citizen = "test-gdb-not-manager@example.gy"
		if not frappe.db.exists("User", citizen):
			frappe.get_doc(
				{"doctype": "User", "email": citizen, "first_name": "Citizen", "send_welcome_email": 0,
				 "user_type": "Website User", "roles": [{"role": "Citizen"}]}
			).insert(ignore_permissions=True)
		with self.set_user(citizen), self.assertRaises(frappe.PermissionError):
			api.manager_report()

	def test_the_figures_agree_with_each_other(self):
		out = report._build()
		self.assertEqual(out["total"]["n"], out["sme"]["n"] + out["quick"]["n"])
		self.assertEqual(sum(r[1] for r in out["region"]), out["total"]["n"])
		self.assertEqual(sum(r[1] for r in out["sector"]), out["total"]["n"])
		self.assertEqual(sum(r[1] for r in out["age"]), out["total"]["n"])
		self.assertEqual(sum(r[1] for r in out["stage"]), out["total"]["n"])
		reg = out["registration"]
		self.assertEqual(reg["with"]["n"] + reg["without"]["n"], out["sme"]["n"])

	def test_the_role_is_held_alone_and_opens_the_staff_door(self):
		from gdb_bank.security import role_policy, sign_in_policy
		from gdb_bank.services.user import whoami

		self.assertIn("GDB Manager", role_policy.GRANTABLE_ROLES)
		self.assertIn("GDB Manager", role_policy.EXCLUSIVE_ROLES)
		self.assertTrue(sign_in_policy.is_staff_account(MANAGER))
		self.assertTrue(whoami(MANAGER)["is_manager"])
		self.assertFalse(whoami(MANAGER)["is_underwriter"])


class TestRegistration(IntegrationTestCase):
	def test_placeholders_count_as_not_registered(self):
		for typed in ("", "N/A", "n/a", "NIL", "None", "0000000", "000", "-", "not applicable", "TBD"):
			self.assertFalse(report.registered(typed), typed)

	def test_real_numbers_count(self):
		for typed in ("BN-2026-1", "123456", "B 1234 / 2019", "80045"):
			self.assertTrue(report.registered(typed), typed)


class TestFraudLeads(IntegrationTestCase):
	def leads(self, rows):
		return report._fraud(rows, {"quick"})[0]

	def test_one_household_at_one_lot_is_high(self):
		out = self.leads([
			row("A-1", "u1", "Mark Kendall", "Lot 233 Main Street", "Khadaarville"),
			row("A-2", "u2", "Sherry Kendall", "233 Main St.", "Khadaarville"),
		])
		self.assertEqual([(f["type"], f["risk"]) for f in out], [("Shared address", "high")])

	def test_different_surnames_at_one_lot_are_medium(self):
		out = self.leads([
			row("A-1", "u1", "Fizul Mohamed", "373 Peters Street", "Parika"),
			row("A-2", "u2", "Thanmatie Ally", "373 Peters St", "Parika"),
		])
		self.assertEqual([f["risk"] for f in out], ["med"])

	def test_an_area_name_alone_is_low(self):
		out = self.leads([
			row("A-1", "u1", "Avril Torres", "Mabaruma", "Barabina"),
			row("A-2", "u2", "Roy Younge", "Mabaruma", "Barabina"),
		])
		self.assertEqual([f["risk"] for f in out], ["low"])

	def test_the_same_lot_in_another_village_is_not_a_match(self):
		self.assertEqual(self.leads([
			row("A-1", "u1", "Mark Kendall", "233 Main Street", "Khadaarville"),
			row("A-2", "u2", "Sherry Kendall", "233 Main Street", "Parika"),
		]), [])

	def test_one_person_with_two_applications_is_not_a_lead(self):
		self.assertEqual(self.leads([
			row("A-1", "u1", "Mark Kendall", "233 Main Street", "Khadaarville", phone="6001234"),
			row("A-2", "u1", "Mark Kendall", "233 Main Street", "Khadaarville", phone="6001234", product="Quick"),
		]), [])

	def test_a_shared_phone_at_different_addresses_is_high(self):
		out = self.leads([
			row("A-1", "u1", "Munesh Shamlall", "1 First St", "Enmore", phone="+592 600 1234"),
			row("A-2", "u2", "Neelita Singh", "9 Ninth St", "Parika", phone="6001234"),
		])
		self.assertEqual([(f["type"], f["risk"]) for f in out], [("Shared phone", "high")])

	def test_one_national_id_on_two_accounts_is_high(self):
		out, duplicates = report._fraud([
			row("A-1", "u1", "Ann Persaud", nid="123456789"),
			row("A-2", "u2", "Bea Singh", nid="123-456-789"),
		], {"quick"})
		self.assertEqual(duplicates, 1)
		self.assertEqual([(f["type"], f["risk"]) for f in out], [("Duplicate ID", "high")])

	def test_a_repeated_name_names_both_births(self):
		out = self.leads([
			row("A-1", "u1", "Nafeeza Khan", dob="1989-01-10"),
			row("A-2", "u2", "Nafeeza  Khan", dob="1988-12-02", product="Quick"),
		])
		self.assertEqual(out[0]["risk"], "med")
		self.assertIn("Jan 1989 vs Dec 1988", out[0]["key"])


class TestVillages(IntegrationTestCase):
	def test_the_village_is_read_from_the_map_place(self):
		cases = {
			"Acme Photo, Robb Street, Bourda, Georgetown, Demerara-Mahaica, Guyana": "Acme Photo",
			"12, Public Road, Bel Air Park, Georgetown, Demerara-Mahaica, 10101, Guyana": "Bel Air Park",
			"Bartica - West, Cuyuni-Mazaruni, Guyana": "Bartica - West",
			"anna regina, Pomeroon-Supenaam, Guyana": "Anna Regina",
			"Region 4, Guyana": "Not specified",
			"": "Not specified",
			None: "Not specified",
		}
		for place, village in cases.items():
			self.assertEqual(report.village_of(place), village, place)

	def test_the_villages_add_up_to_the_applications(self):
		out = report._build()
		self.assertEqual(sum(v[4] for v in out["villages"]), out["total"]["n"])
		for village, _region, _sector, kind, *_ in out["villages"]:
			self.assertEqual(village == report.SME_VILLAGE, kind == 1)
