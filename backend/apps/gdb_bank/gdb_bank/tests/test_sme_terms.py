"""SME Direct Loan terms: the programme's repayment terms and moratoria.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_sme_terms
"""

from unittest.mock import patch

import frappe
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
