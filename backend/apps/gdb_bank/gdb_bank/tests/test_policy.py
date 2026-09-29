"""The rate GDB lends at comes from configuration, and defaults to zero.

Covers the production incident these tests were written for: the Loan Product
was INSERTED at a hard-coded 8.0 and only ever corrected by ensure_product_terms
in after_migrate, so a freshly created site — one that had never been migrated —
carried 8% into every repayment schedule on a programme announced as
interest-free.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_policy
"""

import inspect
import os
from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import install
from gdb_bank.utils import policy


@contextmanager
def configured(site_config: str | None = None, environment: str | None = None):
	"""Pin what each configuration layer answers, whatever the host really has."""
	with patch.dict(frappe.conf, {}, clear=False), patch.dict(os.environ, {}, clear=False):
		if site_config is None:
			frappe.conf.pop(policy.RATE_KEY, None)
		else:
			frappe.conf[policy.RATE_KEY] = site_config

		if environment is None:
			os.environ.pop(policy.RATE_ENV, None)
		else:
			os.environ[policy.RATE_ENV] = environment

		yield


class TestRateResolution(IntegrationTestCase):
	def test_nothing_configured_is_the_announced_zero(self):
		with configured():
			self.assertEqual(policy.rate_of_interest(), 0.0)
			self.assertEqual(policy.source(), "default")

	def test_site_config_sets_the_rate(self):
		with configured(site_config="4.5"):
			self.assertEqual(policy.rate_of_interest(), 4.5)
			self.assertEqual(policy.source(), "site_config")

	def test_the_environment_sets_it_when_site_config_is_silent(self):
		with configured(environment="2"):
			self.assertEqual(policy.rate_of_interest(), 2.0)
			self.assertEqual(policy.source(), "environment")

	def test_site_config_beats_the_environment(self):
		with configured(site_config="1", environment="9"):
			self.assertEqual(policy.rate_of_interest(), 1.0)
			self.assertEqual(policy.source(), "site_config")

	def test_a_value_that_is_not_a_number_is_refused_rather_than_guessed_at(self):
		with configured(site_config="eight percent"):
			self.assertEqual(policy.rate_of_interest(), 0.0)
			self.assertEqual(policy.source(), "default")

	def test_a_negative_rate_is_refused(self):
		with configured(site_config="-1"):
			self.assertEqual(policy.rate_of_interest(), 0.0)

	def test_a_rate_of_a_hundred_or_more_is_a_typo_not_a_policy(self):
		for absurd in ("100", "1000"):
			with configured(site_config=absurd):
				self.assertEqual(policy.rate_of_interest(), 0.0, absurd)

	def test_a_blank_value_falls_through_to_the_next_layer(self):
		with configured(site_config="   ", environment="6"):
			self.assertEqual(policy.rate_of_interest(), 6.0)
			self.assertEqual(policy.source(), "environment")

	def test_refusing_a_bad_value_never_raises_into_a_migrate(self):
		"""A bad config entry must not abort the migration that reads it."""
		with configured(site_config="}{"):
			self.assertEqual(policy.rate_of_interest(), 0.0)


class TestProductCarriesTheConfiguredRate(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		self.product = frappe.db.get_value(
			"Loan Product", {"product_name": install.LOAN_PRODUCT_NAME}
		)
		if not self.product:
			self.skipTest(f"{install.LOAN_PRODUCT_NAME} is not seeded on this site")

	def rate(self):
		return frappe.db.get_value("Loan Product", self.product, "rate_of_interest")

	def test_a_configured_rate_reaches_the_product(self):
		with configured(site_config="3.5"):
			install.ensure_product_terms()
		self.assertEqual(self.rate(), 3.5)

	def test_nothing_configured_holds_the_product_at_zero(self):
		frappe.db.set_value("Loan Product", self.product, "rate_of_interest", 7.0)
		with configured():
			install.ensure_product_terms()
		self.assertEqual(self.rate(), 0)

	def test_the_eight_percent_a_fresh_site_was_born_with_is_corrected(self):
		"""The live incident, reproduced: a product sitting at 8% on a site whose
		after_migrate never ran is brought back to the announced rate."""
		frappe.db.set_value("Loan Product", self.product, "rate_of_interest", 8.0)
		with configured():
			install.ensure_product_terms()
		self.assertEqual(self.rate(), 0)

	def test_the_repayment_ceiling_is_set_alongside_the_rate(self):
		frappe.db.set_value("Loan Product", self.product, "validate_normal_repayment", 0)
		with configured():
			install.ensure_product_terms()
		self.assertEqual(
			frappe.db.get_value("Loan Product", self.product, "validate_normal_repayment"), 1
		)


class TestNoHardCodedRateSurvives(IntegrationTestCase):
	"""project_overview.md §29: a policy value written into the code is an
	incorrect implementation. The insert is where the 8.0 hid."""

	def test_the_product_is_inserted_at_the_configured_rate(self):
		source = inspect.getsource(install.ensure_lending_defaults)
		self.assertIn("policy.rate_of_interest()", source)
		self.assertNotIn("8.0", source)

	def test_the_terms_are_held_at_the_configured_rate(self):
		source = inspect.getsource(install.ensure_product_terms)
		self.assertIn("policy.resolve()", source)
