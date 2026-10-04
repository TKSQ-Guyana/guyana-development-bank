"""The review queue's filters (services/underwriting.py all_loans / _narrowed).

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_review_queue
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank.services import underwriting

ROWS = [
	frappe._dict(
		name="ACC-LOAP-TEST-001",
		applicant_name="Asha Persaud",
		gdb_business_name="Asha's Bakery",
		gdb_owner="asha@example.gy",
		loan_product=None,
		gdb_business_stage="Existing",
		loan_amount=500000,
		gdb_submitted_on="2026-09-01",
		creation="2026-08-30 10:00:00",
	),
	frappe._dict(
		name="ACC-LOAP-TEST-002",
		applicant_name="Dev Singh",
		gdb_business_name="Singh Welding",
		gdb_owner="dev@example.gy",
		loan_product=None,
		gdb_business_stage="New",
		loan_amount=1500000,
		gdb_submitted_on=None,
		creation="2026-09-20 09:00:00",
	),
]


def narrowed(**kwargs):
	args = {
		"search": None,
		"product": None,
		"business_stage": None,
		"min_amount": None,
		"max_amount": None,
		"from_date": None,
		"to_date": None,
	}
	args.update(kwargs)
	return [r.name[-3:] for r in underwriting._narrowed(ROWS, **args)]


class TestReviewQueueFilters(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)

	def test_no_filter_keeps_everything(self):
		self.assertEqual(narrowed(), ["001", "002"])

	def test_search_matches_names_business_and_id(self):
		self.assertEqual(narrowed(search="asha"), ["001"])
		self.assertEqual(narrowed(search="WELDING"), ["002"])
		self.assertEqual(narrowed(search="test-002"), ["002"])
		self.assertEqual(narrowed(search="nobody"), [])

	def test_search_matches_the_applicants_tin(self):
		with patch.object(frappe, "get_all", side_effect=[["dev@example.gy"], []]):
			self.assertEqual(narrowed(search="987654321"), ["002"])

	def test_product_and_business_stage(self):
		self.assertEqual(narrowed(product="standard"), ["001", "002"])
		self.assertEqual(narrowed(product="quick"), [])
		self.assertEqual(narrowed(business_stage="new"), ["002"])

	def test_amount_range_is_inclusive(self):
		self.assertEqual(narrowed(min_amount=500000), ["001", "002"])
		self.assertEqual(narrowed(min_amount="500001"), ["002"])
		self.assertEqual(narrowed(max_amount=500000), ["001"])
		self.assertEqual(narrowed(min_amount="", max_amount=""), ["001", "002"])

	def test_submitted_dates_fall_back_to_creation(self):
		self.assertEqual(narrowed(from_date="2026-09-01", to_date="2026-09-01"), ["001"])
		self.assertEqual(narrowed(from_date="2026-09-10"), ["002"])
		self.assertEqual(narrowed(to_date="2026-08-31"), [])

	def test_the_counts_follow_the_filters(self):
		page = underwriting.all_loans(search="zz-no-such-case-zz")
		self.assertEqual(page["total"], 0)
		self.assertEqual(page["counts"]["All"], 0)

	def test_the_evidence_filter_splits_the_queue(self):
		every = underwriting.all_loans(page_length=100)["total"]
		complete = underwriting.all_loans(evidence="complete", page_length=100)["total"]
		missing = underwriting.all_loans(evidence="missing", page_length=100)["total"]
		self.assertEqual(complete + missing, every)
