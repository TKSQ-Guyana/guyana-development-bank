"""SME Direct Loan terms: the programme's repayment terms and moratoria.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_sme_terms
"""

from unittest.mock import patch

import frappe

from gdb_bank.tests.sme_fixture import complete_sme
from frappe.tests import IntegrationTestCase

from gdb_bank import api, offers
from gdb_bank.utils import policy

CITIZEN = "test-gdb-sme-terms@example.gy"


class TestSmeTerms(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		frappe.get_doc(
			{
				"doctype": "User",
				"email": CITIZEN,
				"first_name": "Sme",
				"send_welcome_email": 0,
				"roles": [{"role": "Citizen"}],
			}
		).insert(ignore_permissions=True)
		self.draft = None

	def save(self, **kwargs):
		"""Save the citizen's one SME draft — the first save opens it and every
		later one updates it, as the form does (one SME Loan at a time)."""
		args = {"loan_amount": 500000, "purpose": "New oven", "term_months": 12, "name": getattr(self, "draft", None)}
		args.update(kwargs)
		with self.set_user(CITIZEN):
			saved = api.save_application(**args)
		self.draft = saved["name"]
		return saved

	def test_the_term_is_any_month_from_six_to_five_years(self):
		self.assertEqual(policy.sme_term_bounds(), (6, 60))
		for term in (6, 7, 18, 37, 60):
			self.assertEqual(self.save(term_months=term)["term_months"], term)
		for term in (3, 5, 61, 120):
			with self.assertRaises(frappe.ValidationError):
				self.save(term_months=term)

	def test_the_moratorium_asked_for_is_kept_and_an_odd_one_refused(self):
		self.assertEqual(policy.moratorium_options(), [1, 2, 3])
		name = self.save(sections={"moratorium_months": 3})["name"]
		self.assertEqual(frappe.db.get_value("Loan Application", name, "gdb_moratorium_months"), 3)
		with self.assertRaises(frappe.ValidationError):
			self.save(sections={"moratorium_months": 5})

	def test_the_offer_states_the_moratorium(self):
		self.assertIn("none", offers.moratorium_line(0))
		self.assertIn("3 months", offers.moratorium_line(3))
		self.assertIn("month 4", offers.repayment_start(3))

	def test_the_endpoint_publishes_the_choices(self):
		with self.set_user(CITIZEN):
			terms = api.sme_loan_terms()
		self.assertEqual((terms["min_term"], terms["max_term"]), (6, 60))
		self.assertEqual(terms["moratorium_options"], [1, 2, 3])


class TestDebtsAndBalanceSheet(TestSmeTerms):
	"""The balance sheet, the existing-debts question, and when it must be answered."""

	def submit(self, **sections):
		name = self.save(sections={"moratorium_months": 1, **sections})["name"]
		complete_sme(CITIZEN, name)
		with self.set_user(CITIZEN):
			return api.submit_application(name=name)

	def test_the_balance_sheet_and_debts_round_trip(self):
		saved = self.save(
			sections={
				"moratorium_months": 1,
				"total_assets": 900000,
				"total_debt": 250000,
				"total_equity": 650000,
				"has_existing_debts": "Yes",
				"existing_debts": [
					{"lender": "Republic Bank", "amount": 200000, "status": "Current"},
					{"lender": "", "amount": 5, "status": ""},  # a blank line, dropped
					{"lender": "Supplier", "amount": 50000, "status": "In arrears"},
				],
			}
		)
		with self.set_user(CITIZEN):
			loan = api.loan_detail(name=saved["name"])
		self.assertEqual(loan["sections"]["total_equity"], 650000)
		self.assertEqual(
			[(d["lender"], d["amount"], d["status"]) for d in loan["existing_debts"]],
			[("Republic Bank", 200000, "Current"), ("Supplier", 50000, "In arrears")],
		)

	def test_the_existing_debts_question_must_be_answered_to_submit(self):
		with self.assertRaisesRegex(frappe.ValidationError, "existing debts"):
			self.submit()

	def test_a_yes_needs_the_debts_and_their_status(self):
		with self.assertRaisesRegex(frappe.ValidationError, "lender, amount and status"):
			self.submit(has_existing_debts="Yes")
		with self.assertRaisesRegex(frappe.ValidationError, "status"):
			self.submit(has_existing_debts="Yes", existing_debts=[{"lender": "Bank", "amount": 10}])

	def test_a_no_submits(self):
		self.assertEqual(self.submit(has_existing_debts="No")["status"], "Submitted")

	def test_an_odd_debt_status_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(sections={"existing_debts": [{"lender": "Bank", "amount": 1, "status": "Forgotten"}]})


class TestSmeApplicationRules(TestSmeTerms):
	"""What a single SME application must carry before it goes to GDB."""

	def ready(self, **kwargs) -> str:
		sections = {"moratorium_months": 1, "has_existing_debts": "No", **kwargs.pop("sections", {})}
		name = self.save(sections=sections, **kwargs)["name"]
		complete_sme(CITIZEN, name)
		return name

	def refused(self, message: str, name: str) -> None:
		with self.set_user(CITIZEN), self.assertRaisesRegex(frappe.ValidationError, message):
			api.submit_application(name=name)

	def submits(self, name: str) -> dict:
		with self.set_user(CITIZEN):
			return api.submit_application(name=name)

	def test_a_complete_sme_application_submits(self):
		self.assertEqual(self.submits(self.ready())["status"], "Submitted")

	def test_the_e_id_is_optional_but_eleven_digits_when_given(self):
		name = self.ready()
		frappe.db.set_value("Loan Application", name, "gdb_applicant_eid", "12345")
		self.refused("xxx-xxxx-xxxx", name)
		frappe.db.set_value("Loan Application", name, {"gdb_applicant_eid": "", "gdb_has_eid": "No"})
		self.assertEqual(self.submits(name)["status"], "Submitted")

	def test_an_existing_business_needs_its_dcra_number(self):
		name = self.ready(business_stage="Existing", business_name="Oven Co", dcra_number="BN-2026-1")
		frappe.db.set_value("Loan Application", name, {"gdb_date_established": "2020-01-01", "gdb_dcra_number": ""})
		self.refused("DCRA", name)

	def test_a_new_business_needs_no_registration(self):
		name = self.ready(
			business_stage="New",
			business_name="Oven Co",
			dcra_number="BN-2026-1",
			sections={"industrial_training": "No", "has_mentor": "No"},
		)
		frappe.db.set_value("Loan Application", name, {"gdb_registration_date": None, "gdb_dcra_number": ""})
		self.assertEqual(self.submits(name)["status"], "Submitted")

	def test_the_date_established_cannot_be_in_the_future(self):
		with self.assertRaisesRegex(frappe.ValidationError, "cannot be in the future"):
			self.save(
				business_stage="Existing",
				business_name="Oven Co",
				dcra_number="BN-2026-1",
				sections={"moratorium_months": 1, "date_established": frappe.utils.add_days(frappe.utils.today(), 1)},
			)

	def test_an_existing_business_needs_no_registration_date(self):
		name = self.ready(business_stage="Existing", business_name="Oven Co", dcra_number="BN-2026-1")
		frappe.db.set_value(
			"Loan Application", name, {"gdb_registration_date": None, "gdb_date_established": "2020-01-01"}
		)
		self.assertEqual(self.submits(name)["status"], "Submitted")

	def test_an_existing_business_submits_without_its_certificate(self):
		name = self.ready(business_stage="Existing", business_name="Oven Co", dcra_number="BN-2026-1")
		frappe.db.set_value("Loan Application", name, "gdb_date_established", "2020-01-01")
		frappe.db.set_value(
			"GDB Applicant Document",
			{"application": name, "document_type": "Certificate of Registration"},
			"status",
			"Replaced",
		)
		self.assertEqual(self.submits(name)["status"], "Submitted")

	def test_a_new_business_submits_without_its_certificate(self):
		name = self.ready(
			business_stage="New",
			business_name="Oven Co",
			dcra_number="BN-2026-1",
			sections={"industrial_training": "No", "has_mentor": "No"},
		)
		frappe.db.set_value(
			"GDB Applicant Document",
			{"application": name, "document_type": "Certificate of Registration"},
			"status",
			"Replaced",
		)
		self.assertEqual(self.submits(name)["status"], "Submitted")

	def test_a_new_business_keeps_its_dcra_number(self):
		saved = self.save(
			business_stage="New", business_name="Oven Co", dcra_number="bn-2026-1", sections={"moratorium_months": 1}
		)
		self.assertEqual(saved["dcra_number"], "BN-2026-1")

	def test_a_new_business_answers_the_training_and_mentor_questions(self):
		name = self.ready(business_stage="New", business_name="Oven Co", dcra_number="BN-2026-1")
		self.refused("industrial training", name)
		frappe.db.set_value("Loan Application", name, {"gdb_industrial_training": "Yes", "gdb_has_mentor": "Yes"})
		self.refused("mentor's first name", name)
		frappe.db.set_value(
			"Loan Application",
			name,
			{"gdb_mentor_first_name": "Asha", "gdb_mentor_last_name": "Persaud", "gdb_mentor_phone": "+5926001234"},
		)
		self.assertEqual(self.submits(name)["status"], "Submitted")

	def test_mentor_details_go_with_a_no(self):
		saved = self.save(
			business_stage="New",
			business_name="Oven Co",
			dcra_number="BN-2026-1",
			sections={
				"moratorium_months": 1,
				"has_mentor": "No",
				"mentor_details": "Ms Persaud",
				"mentor_first_name": "Asha",
				"mentor_phone": "6001234",
			},
		)
		self.assertFalse(saved["sections"]["mentor_details"])
		self.assertFalse(saved["sections"]["mentor_first_name"])
		self.assertFalse(saved["sections"]["mentor_phone"])

	def test_an_existing_business_carries_no_new_business_answers(self):
		saved = self.save(
			business_stage="Existing",
			business_name="Oven Co",
			dcra_number="BN-2020-1",
			sections={"moratorium_months": 1, "industrial_training": "Yes", "institution": "UG"},
		)
		self.assertFalse(saved["sections"]["industrial_training"])
		self.assertFalse(saved["sections"]["institution"])

	def test_a_public_servant_earning_250k_or_more_is_flagged_not_refused(self):
		name = self.ready(
			sections={
				"public_service_employed": "Yes",
				"public_service_ministry": "Ministry of Health",
				"public_service_under_250k": "No",
			}
		)
		loan = self.submits(name)
		self.assertEqual(loan["status"], "Submitted")
		self.assertEqual(loan["sections"]["requires_loan_officer_review"], 1)

	def test_an_applicant_without_a_bank_account_may_submit(self):
		name = self.ready(sections={"no_bank_account": 1})
		self.assertEqual(self.submits(name)["sections"]["no_bank_account"], 1)

	def test_an_invalid_email_address_is_refused(self):
		from gdb_bank import profiles

		with self.set_user(CITIZEN), self.assertRaisesRegex(frappe.ValidationError, "valid email"):
			profiles.save_profile(email="not-an-email")

	def test_no_document_is_expected_of_a_single_sme(self):
		from gdb_bank.services.evidence import missing_evidence

		for stage, expected in (("Existing", []), ("New", [])):
			name = self.save(
				business_stage=stage, business_name="Oven Co", dcra_number="BN-2026-1", sections={"moratorium_months": 1}
			)["name"]
			self.assertEqual(missing_evidence(name), expected)
