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

	def save(self, **kwargs):
		args = {"loan_amount": 500000, "purpose": "New oven", "term_months": 12}
		args.update(kwargs)
		with self.set_user(CITIZEN):
			return api.save_application(**args)

	def test_the_terms_are_six_twelve_eighteen_and_twenty_four_months(self):
		self.assertEqual(policy.sme_loan_terms(), [6, 12, 18, 24])
		for term in (6, 12, 18, 24):
			self.assertEqual(self.save(term_months=term)["term_months"], term)
		for term in (3, 10, 36):
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
		self.assertEqual(terms["term_options"], [6, 12, 18, 24])
		self.assertEqual(terms["moratorium_options"], [1, 2, 3])
		self.assertEqual(terms["max_term"], 24)
