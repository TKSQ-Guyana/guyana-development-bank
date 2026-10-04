"""The KYC register's staff endpoints (gdb_bank/kyc.py).

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_kyc
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import kyc
from gdb_bank.integrations import kyc_registry

OFFICER = "test-gdb-kyc-officer@example.gy"
CITIZEN = "test-gdb-kyc-citizen@example.gy"
DISBURSER = "test-gdb-kyc-disburser@example.gy"

ROWS = [
	{
		"profile_id": "TEST-KYC-A",
		"full_name": "ANNA QZKYCTEST",
		"surname": "QZKYCTEST",
		"forenames": "ANNA",
		"id_number": "900100200",
		"date_of_birth": "3/3/1989",
		"cg_contact_number": "665-5532",
		"region": "Region 07",
		"account_number": "962352009777",
	},
	{
		"profile_id": "TEST-KYC-B",
		"full_name": "BRAM QZKYCTEST",
		"surname": "QZKYCTEST",
		"forenames": "BRAM",
		"id_number": "900100201",
		"region": "Region 04",
	},
]


def _user(email: str, *roles: str) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": "Kyc",
			"send_welcome_email": 0,
			"roles": [{"role": r} for r in roles],
		}
	).insert(ignore_permissions=True)


class TestKycEndpoints(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		_user(OFFICER, "Loan Underwriter")
		_user(CITIZEN, "Citizen")
		_user(DISBURSER, "Disbursement Officer")
		kyc_registry.import_rows(ROWS)

	def test_a_loan_officer_reads_one_person_by_id_number_or_profile(self):
		with self.set_user(OFFICER):
			by_number = kyc.get_kyc_record(id_number="900-100-200")
			by_profile = kyc.get_kyc_record(profile_id="TEST-KYC-A")
		self.assertEqual(by_number["profile_id"], "TEST-KYC-A")
		self.assertEqual(by_profile["full_name"], "ANNA QZKYCTEST")
		# Staff see the record whole — phone and bank account included.
		self.assertEqual(by_number["cg_contact_number"], "665-5532")
		self.assertEqual(by_number["account_number"], "962352009777")
		self.assertEqual(str(by_number["date_of_birth"]), "1989-03-03")

	def test_no_match_and_no_key_are_told_apart(self):
		with self.set_user(OFFICER):
			with self.assertRaises(frappe.DoesNotExistError):
				kyc.get_kyc_record(id_number="111111111")
			with self.assertRaises(frappe.ValidationError):
				kyc.get_kyc_record()

	def test_search_by_name_or_number_and_filter_by_region(self):
		with self.set_user(OFFICER):
			by_name = kyc.list_kyc_records(search="qzkyctest")
			by_number = kyc.list_kyc_records(search="900100201")
			by_region = kyc.list_kyc_records(search="qzkyctest", region="Region 07")
		self.assertEqual(by_name["total"], 2)
		self.assertEqual([r.profile_id for r in by_number["rows"]], ["TEST-KYC-B"])
		self.assertEqual([r.profile_id for r in by_region["rows"]], ["TEST-KYC-A"])
		# A list row carries no phone or bank details.
		self.assertNotIn("account_number", by_name["rows"][0])
		self.assertNotIn("cg_contact_number", by_name["rows"][0])

	def test_pages_are_bounded(self):
		with self.set_user(OFFICER):
			page = kyc.list_kyc_records(search="qzkyctest", page_length=1)
			huge = kyc.list_kyc_records(page_length=10_000)
		self.assertEqual((len(page["rows"]), page["total"]), (1, 2))
		self.assertEqual(huge["page_length"], kyc.MAX_PAGE)

	def test_citizens_and_other_staff_are_refused(self):
		for user in (CITIZEN, DISBURSER):
			with self.set_user(user):
				with self.assertRaises(frappe.PermissionError, msg=user):
					kyc.get_kyc_record(id_number="900100200")
				with self.assertRaises(frappe.PermissionError, msg=user):
					kyc.list_kyc_records()


class TestTheBankAccountOnRecord(IntegrationTestCase):
	"""The account the register pays a person into, offered back to that person."""

	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		_user(OFFICER, "Loan Underwriter")
		_user(CITIZEN, "Citizen")
		kyc_registry.import_rows(
			[
				{
					"profile_id": "TEST-KYC-BANK",
					"full_name": "CARA BANKER",
					"surname": "BANKER",
					"forenames": "CARA",
					"id_number": "900100299",
					"bank": "Republic Bank",
					"bank_branch": "Republic Bank - Water Street",
					"account_number": "962352009777",
					"account_type": "savings",
				}
			]
		)
		frappe.db.set_value("User", CITIZEN, "gdb_national_id", "900100299")

	def test_the_owner_is_offered_their_account_matched_to_the_portals_lists(self):
		from gdb_bank import api

		with self.set_user(CITIZEN):
			offered = api.my_kyc_bank_account()
		self.assertEqual(offered["bank"], "Republic Bank")
		self.assertEqual(offered["branch"], "Republic Bank - Water Street")
		self.assertEqual(offered["branch_name"], "Water Street")
		self.assertEqual(offered["account_number"], "962352009777")
		self.assertEqual(offered["masked"], "••••9777")
		self.assertEqual(offered["account_type"], "Savings")
		self.assertEqual(offered["holder"], "Cara Banker")

	def test_someone_not_on_the_register_is_offered_nothing(self):
		from gdb_bank import api

		with self.set_user(OFFICER):
			self.assertIsNone(api.my_kyc_bank_account())


class TestIdentityNumberCrossCheck(IntegrationTestCase):
	"""The number an applicant types from their identity document, checked by
	the officer against the KYC register (documents._cross_check_identity)."""

	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		_user(OFFICER, "Loan Underwriter")
		_user(CITIZEN, "Citizen")
		frappe.db.set_value("User", CITIZEN, "gdb_national_id", "900100200")
		kyc_registry.import_rows(ROWS)

	def file(self, kind=None, number=None):
		from gdb_bank import documents

		with self.set_user(CITIZEN):
			row = documents.new_document(document_type="Identity", id_document_kind=kind, id_document_number=number)
		frappe.db.set_value("GDB Applicant Document", row.name, "file_url", "/private/files/id.pdf")
		return row

	def check(self) -> dict:
		from gdb_bank import documents

		with self.set_user(OFFICER):
			shelf = documents.list_documents(applicant=CITIZEN)
		return next(d for d in shelf["documents"] if d.document_type == "Identity").get("register_check")

	def test_an_identity_upload_needs_its_kind_and_number(self):
		with self.assertRaisesRegex(frappe.ValidationError, "Choose which identity document"):
			self.file(None, "900100200")
		with self.assertRaisesRegex(frappe.ValidationError, "number printed"):
			self.file("National ID Card", " ")
		row = self.file("National ID Card", "900-100-200")
		self.assertEqual(row.id_document_number, "900100200")

	def test_an_e_id_number_is_kept_as_592_2001_0101(self):
		self.assertEqual(self.file("e-ID", "59220010101").id_document_number, "592-2001-0101")
		with self.assertRaisesRegex(frappe.ValidationError, "592-2001-0101"):
			self.file("e-ID", "592-2001-010")

	def test_other_documents_ask_no_number(self):
		from gdb_bank import documents

		with self.set_user(CITIZEN):
			row = documents.new_document(document_type="Proof of Address")
		self.assertIsNone(row.id_document_number)

	def test_the_officer_sees_a_match(self):
		self.file("National ID Card", "900 100 200")
		self.assertEqual(self.check()["status"], "match")

	def test_the_officer_sees_a_mismatch_with_the_registers_last_digits(self):
		self.file("Passport", "R0100299")
		check = self.check()
		self.assertEqual(check["status"], "mismatch")
		self.assertEqual(check["hint"], "…200")

	def test_a_national_id_card_must_carry_the_national_id(self):
		with self.assertRaisesRegex(frappe.ValidationError, "must match your National ID number"):
			self.file("National ID Card", "900100299")
		self.assertEqual(self.file("National ID Card", "900 100 200").id_document_number, "900100200")

	def test_someone_not_on_the_register_cannot_be_matched(self):
		frappe.db.set_value("User", CITIZEN, "gdb_national_id", "111222333")
		self.file("Passport", "R0123456")
		self.assertEqual(self.check()["status"], "not_on_register")

	def test_the_citizen_is_never_told_the_register_number(self):
		from gdb_bank import documents

		self.file("Passport", "R0100299")
		with self.set_user(CITIZEN):
			shelf = documents.list_documents()
		self.assertNotIn("register_check", next(d for d in shelf["documents"] if d.document_type == "Identity"))
