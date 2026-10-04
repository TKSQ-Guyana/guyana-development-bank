"""Quick Loan: a second product for informal traders, applied for on its own form.

Up to a configured ceiling (G$300,000 as announced), with no TIN, no DCRA
registration and no receipts. Every test acts through the portal's own
endpoints as the person acting; the endpoints commit, so commit is suppressed
and each test is rolled back.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_quick_loan
"""

import os
from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, documents, install
from gdb_bank.utils import policy

def _image(fmt: str) -> bytes:
	from io import BytesIO

	from PIL import Image

	out = BytesIO()
	Image.new("RGB", (4, 4), (0, 128, 0)).save(out, format=fmt)
	return out.getvalue()


def _pdf() -> bytes:
	from io import BytesIO

	from pypdf import PdfWriter

	writer, out = PdfWriter(), BytesIO()
	writer.add_blank_page(width=72, height=72)
	writer.write(out)
	return out.getvalue()


# Real files, because Frappe itself parses what is uploaded (a PDF is scanned
# for JavaScript, a JPEG has its EXIF stripped) — and a Windows executable, the
# thing a renamed "photo" is most likely to be.
JPEG = _image("JPEG")
PNG = _image("PNG")
PDF = _pdf()
EXE = b"MZ\x90\x00" + b"\x00" * 64

TRADER = "test-gdb-trader@example.gy"
TRADER_EID = "592-9100-0001"

# What a market vendor tells the Quick Loan form about their trade.
TRADE = {
	"trade_activity": "Sell vegetables",
	"trade_location": "Market",
	"trading_since": "1 to 3 years",
	"trade_region": "Region 4",
	"support_1_name": "Asha Persaud",
	"support_1_relationship": "Neighbour",
	"support_1_phone": "+592 600 1111",
	"support_2_name": "Devon Baksh",
	"support_2_relationship": "Supplier",
	"support_2_phone": "600 2222",
	"resides_in_guyana": 1,
	"trade_latitude": 6.8013,
	"trade_longitude": -58.1551,
	"trade_address": "Stabroek Market, Georgetown",
	"moratorium_months": 1,
	"public_service_employed": "No",
	"related_to_gdb_employee": "No",
}

# A public servant's answers, on top of TRADE.
PUBLIC_SERVANT = {
	**TRADE,
	"public_service_employed": "Yes",
	"public_service_ministry": "Ministry of Health",
	"public_service_under_250k": "Yes",
}


def _user(email: str, *roles: str, eid: str | None = None) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": email.split("@")[0].removeprefix("test-gdb-").title(),
			"send_welcome_email": 0,
			"roles": [{"role": role} for role in roles],
		}
	).insert(ignore_permissions=True)
	if eid:
		frappe.db.set_value("User", email, "gdb_eid", eid)


@contextmanager
def configured(key: str, env: str, site_config: str | None = None, environment: str | None = None):
	"""Pin what each configuration layer answers for one policy value."""
	with patch.dict(frappe.conf, {}, clear=False), patch.dict(os.environ, {}, clear=False):
		frappe.conf.pop(key, None)
		os.environ.pop(env, None)
		if site_config is not None:
			frappe.conf[key] = site_config
		if environment is not None:
			os.environ[env] = environment
		yield


def ceiling(**layers):
	return configured(policy.QUICK_CEILING_KEY, policy.QUICK_CEILING_ENV, **layers)


def term_list(**layers):
	return configured(policy.QUICK_TERMS_KEY, policy.QUICK_TERMS_ENV, **layers)


class TestQuickLoanPolicy(IntegrationTestCase):
	def test_nothing_configured_is_the_announced_three_hundred_thousand(self):
		with ceiling():
			self.assertEqual(policy.quick_loan_ceiling(), 300000.0)

	def test_site_config_sets_the_ceiling_and_beats_the_environment(self):
		with ceiling(site_config="250000", environment="400000"):
			self.assertEqual(policy.quick_loan_ceiling(), 250000.0)

	def test_the_environment_sets_it_when_site_config_is_silent(self):
		with ceiling(environment="150000"):
			self.assertEqual(policy.quick_loan_ceiling(), 150000.0)

	def test_a_ceiling_that_is_not_a_positive_amount_is_refused(self):
		for bad in ("three hundred thousand", "0", "-5"):
			with ceiling(site_config=bad):
				self.assertEqual(policy.quick_loan_ceiling(), 300000.0, bad)

	def test_the_terms_default_to_six_twelve_eighteen_and_twenty_four_months(self):
		with term_list():
			self.assertEqual(policy.quick_loan_terms(), [6, 12, 18, 24])
			self.assertEqual(policy.quick_loan_max_term(), 24)

	def test_configured_terms_are_used_in_ascending_order(self):
		with term_list(site_config="12, 3,9"):
			self.assertEqual(policy.quick_loan_terms(), [3, 9, 12])
			self.assertEqual(policy.quick_loan_max_term(), 12)

	def test_a_term_list_with_any_entry_that_is_not_a_whole_number_of_months_is_refused(self):
		for bad in ("a year", "0", "6.5", "6,400", "6,,12"):
			with term_list(site_config=bad):
				self.assertEqual(policy.quick_loan_terms(), [6, 12, 18, 24], bad)


class RolledBack(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)


def quick_product(*fields):
	name = frappe.db.get_value("Loan Product", {"product_name": install.QUICK_LOAN_PRODUCT_NAME})
	return frappe.db.get_value("Loan Product", name, list(fields), as_dict=True) if name else None


class TestQuickLoanProduct(RolledBack):
	def setUp(self):
		super().setUp()
		if not frappe.db.get_value("Loan Product", {"product_name": install.LOAN_PRODUCT_NAME}):
			self.skipTest(f"{install.LOAN_PRODUCT_NAME} is not seeded on this site")

	def test_the_product_is_seeded_interest_free_at_the_configured_ceiling(self):
		frappe.db.delete("Loan Product", {"product_name": install.QUICK_LOAN_PRODUCT_NAME})
		with ceiling(site_config="250000"):
			install.ensure_quick_loan_product()
		product = quick_product("maximum_loan_amount", "rate_of_interest", "is_term_loan")
		self.assertEqual(product.maximum_loan_amount, 250000)
		self.assertEqual(product.rate_of_interest, policy.rate_of_interest())
		self.assertEqual(product.is_term_loan, 1)

	def test_seeding_twice_leaves_one_product(self):
		install.ensure_quick_loan_product()
		install.ensure_quick_loan_product()
		self.assertEqual(
			frappe.db.count("Loan Product", {"product_name": install.QUICK_LOAN_PRODUCT_NAME}), 1
		)

	def test_a_changed_ceiling_reaches_the_product_on_migrate(self):
		install.ensure_quick_loan_product()
		with ceiling(site_config="200000"):
			install.ensure_product_terms()
		self.assertEqual(quick_product("maximum_loan_amount").maximum_loan_amount, 200000)

	def test_the_standard_product_carries_the_sme_ceiling_not_the_quick_loans(self):
		install.ensure_quick_loan_product()
		with ceiling(site_config="200000"):
			install.ensure_product_terms()
		standard = frappe.db.get_value("Loan Product", {"product_name": install.LOAN_PRODUCT_NAME})
		self.assertEqual(
			frappe.db.get_value("Loan Product", standard, "maximum_loan_amount"), policy.sme_loan_ceiling()
		)

	def test_a_quick_loan_posts_to_the_same_ledger_accounts_as_the_standard_loan(self):
		install.ensure_quick_loan_product()
		fields = [spec[0] for spec in install.LOAN_ACCOUNT_SPECS]
		standard = frappe.db.get_value("Loan Product", {"product_name": install.LOAN_PRODUCT_NAME})
		self.assertEqual(
			quick_product(*fields),
			frappe.db.get_value("Loan Product", standard, fields, as_dict=True),
		)


class QuickLoanCase(RolledBack):
	"""A signed-in trader, and the Quick Loan product to apply for."""

	def setUp(self):
		super().setUp()
		if not frappe.db.get_value("Loan Product", {"product_name": install.LOAN_PRODUCT_NAME}):
			self.skipTest(f"{install.LOAN_PRODUCT_NAME} is not seeded on this site")
		install.ensure_quick_loan_product()
		_user(TRADER, "Citizen", eid=TRADER_EID)

	def save(self, **overrides) -> dict:
		fields = {
			"product": "quick",
			"loan_amount": 150000,
			"purpose": "Buy more stock for the stall",
			"term_months": 6,
			"sections": dict(TRADE),
		}
		fields.update(overrides)
		with self.set_user(TRADER):
			return api.save_application(**fields)


class TestQuickLoanTerms(QuickLoanCase):
	def test_the_form_is_told_the_limits_the_server_enforces(self):
		with self.set_user(TRADER):
			terms = api.quick_loan_terms()
		self.assertEqual(terms["ceiling"], policy.quick_loan_ceiling())
		self.assertEqual(terms["max_term"], policy.quick_loan_max_term())
		self.assertEqual(terms["term_options"], policy.quick_loan_terms())
		self.assertEqual(terms["rate_of_interest"], policy.rate_of_interest())
		self.assertEqual(terms["trade_locations"], list(install.QUICK_TRADE_LOCATIONS))
		self.assertEqual(terms["trading_since"], list(install.QUICK_TRADING_SINCE))

	def test_the_ceiling_is_the_products_own_not_a_second_copy(self):
		product = frappe.db.get_value("Loan Product", {"product_name": install.QUICK_LOAN_PRODUCT_NAME})
		frappe.db.set_value("Loan Product", product, "maximum_loan_amount", 120000)
		with self.set_user(TRADER):
			self.assertEqual(api.quick_loan_terms()["ceiling"], 120000)


class TestSavingAQuickLoan(QuickLoanCase):
	def test_a_trader_with_no_registration_saves_a_quick_loan_draft(self):
		draft = self.save()
		self.assertEqual(draft["product"], "quick")
		self.assertEqual(draft["status"], "Draft")
		self.assertEqual(draft["sections"]["trade_activity"], "Sell vegetables")
		self.assertEqual(draft["sections"]["trade_location"], "Market")
		self.assertEqual(draft["sections"]["trading_since"], "1 to 3 years")

	def test_it_is_filed_on_the_quick_loan_product(self):
		name = self.save()["name"]
		product = frappe.db.get_value("Loan Application", name, "loan_product")
		self.assertEqual(
			frappe.db.get_value("Loan Product", product, "product_name"), install.QUICK_LOAN_PRODUCT_NAME
		)

	def test_the_ceiling_itself_may_be_asked_for(self):
		self.assertEqual(self.save(loan_amount=policy.quick_loan_ceiling())["loan_amount"], policy.quick_loan_ceiling())

	def test_a_dollar_over_the_ceiling_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(loan_amount=policy.quick_loan_ceiling() + 1)

	def test_what_the_business_does_where_how_long_and_its_region_are_required(self):
		for missing in ("trade_activity", "trade_location", "trading_since", "trade_region"):
			sections = {k: v for k, v in TRADE.items() if k != missing}
			with self.assertRaises(frappe.ValidationError, msg=missing):
				self.save(sections=sections)

	def test_a_business_name_is_optional_and_kept_when_given(self):
		draft = self.save()
		self.assertFalse(draft["business_name"])
		self.assertEqual(
			self.save(business_name="Singh Fresh Greens", name=draft["name"])["business_name"], "Singh Fresh Greens"
		)

	def test_the_priority_groups_are_recorded_as_declared(self):
		draft = self.save(sections={**TRADE, "youth_entrepreneur": 1, "woman_entrepreneur": 0})
		self.assertEqual(draft["sections"]["youth_entrepreneur"], 1)
		self.assertEqual(draft["sections"]["woman_entrepreneur"], 0)

	def test_a_place_of_trade_outside_the_list_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(sections={**TRADE, "trade_location": "Online"})

	def test_a_term_beyond_the_longest_quick_loan_term_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(term_months=policy.quick_loan_max_term() + 1)

	def test_a_term_between_the_allowed_terms_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(term_months=10)

	def test_every_allowed_term_is_accepted(self):
		name = None
		for term in policy.quick_loan_terms():
			saved = self.save(term_months=term, name=name)
			name = saved["name"]
			self.assertEqual(saved["term_months"], term)

	def test_the_applicant_must_declare_they_live_in_guyana(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(sections={**TRADE, "resides_in_guyana": 0})

	def test_both_supporting_contacts_are_required(self):
		for key in ("support_1_name", "support_1_relationship", "support_2_phone"):
			with self.assertRaises(frappe.ValidationError, msg=key):
				self.save(sections={**TRADE, key: ""})

	def test_a_supporting_contact_number_that_is_not_a_guyana_number_is_refused(self):
		for bad in ("call my cousin", "12345", "9876543210", "+1 212 555 0100"):
			with self.assertRaises(frappe.ValidationError, msg=bad):
				self.save(sections={**TRADE, "support_1_phone": bad})

	def test_a_supporting_contact_number_is_held_with_592(self):
		name = None
		for typed in ("123 4567", "5921234567", "+592 123 4567"):
			saved = self.save(sections={**TRADE, "support_1_phone": typed}, name=name)
			name = saved["name"]
			self.assertEqual(frappe.db.get_value("Loan Application", saved["name"], "gdb_support_1_phone"), "+5921234567", typed)

	def test_the_business_must_be_pinned_in_guyana(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(sections={**TRADE, "trade_latitude": 0, "trade_longitude": 0})
		with self.assertRaises(frappe.ValidationError):
			self.save(sections={**TRADE, "trade_latitude": 40.7, "trade_longitude": -74.0})
		saved = self.save()
		row = frappe.db.get_value("Loan Application", saved["name"], ["gdb_trade_latitude", "gdb_trade_address"], as_dict=True)
		self.assertAlmostEqual(row.gdb_trade_latitude, 6.8013, places=4)
		self.assertEqual(row.gdb_trade_address, "Stabroek Market, Georgetown")

	def test_supporting_contacts_and_residency_are_kept_on_the_application(self):
		saved = self.save()
		row = frappe.db.get_value(
			"Loan Application",
			saved["name"],
			["gdb_support_1_name", "gdb_support_2_relationship", "gdb_support_1_phone", "gdb_resides_in_guyana"],
			as_dict=True,
		)
		self.assertEqual(row.gdb_support_1_name, "Asha Persaud")
		self.assertEqual(row.gdb_support_2_relationship, "Supplier")
		self.assertTrue(row.gdb_support_1_phone.startswith("+592"))
		self.assertEqual(row.gdb_resides_in_guyana, 1)

	def test_a_quick_loan_cannot_be_filed_for_a_group(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(cluster="Any Group")

	def test_no_registration_or_sme_answers_ride_along_on_a_quick_loan(self):
		draft = self.save(
			business_stage="Existing",
			dcra_number="REG-1",
			business_name="Stall Co",
			sections={**TRADE, "sector": "Mining and quarrying", "annual_revenue": 900000},
		)
		self.assertFalse(draft["business_stage"])
		self.assertFalse(draft["dcra_number"])
		self.assertFalse(draft["sections"]["sector"])
		self.assertFalse(draft["sections"]["annual_revenue"])

	def test_an_sme_application_carries_no_quick_loan_answers(self):
		with self.set_user(TRADER):
			draft = api.save_application(
				loan_amount=500000, purpose="New oven", term_months=12, sections=dict(TRADE)
			)
		self.assertEqual(draft["product"], "standard")
		self.assertFalse(draft["sections"]["trade_activity"])

	def test_an_unknown_product_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self.save(product="payday")


UNDERWRITER = "test-gdb-quick-underwriter@example.gy"


class TestSubmittingAQuickLoan(QuickLoanCase):
	def setUp(self):
		super().setUp()
		_user(UNDERWRITER, "Loan Underwriter")

	def submitted(self, **sections) -> str:
		name = self.save(sections={**TRADE, **sections})["name"]
		with self.set_user(TRADER):
			api.submit_application(name=name, accept_terms=1, credit_check_consent=1)
		return name

	def in_queue(self, name: str, **filters) -> dict | None:
		with self.set_user(UNDERWRITER):
			return next((case for case in api.all_loans(**filters)["rows"] if case["name"] == name), None)

	def refused_at_submission(self, message: str, **sections) -> None:
		name = self.save(sections={**TRADE, **sections})["name"]
		with self.set_user(TRADER), self.assertRaisesRegex(frappe.ValidationError, message):
			api.submit_application(name=name, accept_terms=1, credit_check_consent=1)

	def test_a_public_servant_earning_250k_or_more_is_routed_to_a_loan_officer_not_refused(self):
		name = self.submitted(**{**PUBLIC_SERVANT, "public_service_under_250k": "No"})
		case = self.in_queue(name)
		self.assertEqual(case["status"], "Submitted")
		self.assertEqual(case["sections"]["requires_loan_officer_review"], 1)
		self.assertIsNotNone(self.in_queue(name, officer_review=1))

	def test_a_public_servant_earning_under_250k_is_not_flagged(self):
		name = self.submitted(**PUBLIC_SERVANT)
		self.assertEqual(self.in_queue(name)["sections"]["requires_loan_officer_review"], 0)
		self.assertIsNone(self.in_queue(name, officer_review=1))

	def test_the_review_flag_is_the_servers_conclusion_not_the_forms(self):
		draft = self.save(sections={**TRADE, "requires_loan_officer_review": 1})
		self.assertEqual(draft["sections"]["requires_loan_officer_review"], 0)

	def test_a_no_to_public_service_clears_its_follow_up_answers(self):
		draft = self.save(sections={**PUBLIC_SERVANT, "public_service_employed": "No"})
		self.assertFalse(draft["sections"]["public_service_ministry"])
		self.assertFalse(draft["sections"]["public_service_under_250k"])

	def test_the_declarations_are_kept_on_the_application(self):
		draft = self.save(sections={**PUBLIC_SERVANT, "applicant_eid": " 592-2001-0101 ", "related_to_gdb_employee": "Yes"})
		self.assertEqual(draft["sections"]["applicant_eid"], "592-2001-0101")
		self.assertEqual(draft["sections"]["public_service_ministry"], "Ministry of Health")
		self.assertEqual(draft["sections"]["related_to_gdb_employee"], "Yes")

	def test_submission_asks_whether_the_applicant_is_a_public_servant(self):
		self.refused_at_submission("public service", public_service_employed="")

	def test_a_public_servant_names_their_ministry(self):
		self.refused_at_submission("Ministry or agency", **{**PUBLIC_SERVANT, "public_service_ministry": ""})

	def test_a_public_servant_answers_the_income_question(self):
		self.refused_at_submission("250,000", **{**PUBLIC_SERVANT, "public_service_under_250k": ""})

	def test_submission_asks_whether_the_applicant_is_related_to_a_gdb_employee(self):
		self.refused_at_submission("related to an employee", related_to_gdb_employee="")

	def test_an_applicant_without_a_bank_account_may_submit(self):
		name = self.submitted(no_bank_account=1)
		self.assertEqual(self.in_queue(name)["sections"]["no_bank_account"], 1)

	def test_the_facilitated_banks_are_the_desks_list(self):
		install.ensure_banks()
		frappe.db.set_value("Bank", "GBTI", "gdb_facilitated", 0)
		frappe.db.set_value("Bank", "Republic Bank", "gdb_facilitated", 1)
		with self.set_user(TRADER):
			banks = api.facilitated_banks()
		self.assertIn("Republic Bank", banks)
		self.assertNotIn("GBTI", banks)

	def test_a_submitted_quick_loan_reaches_the_review_queue_as_a_quick_loan(self):
		case = self.in_queue(self.submitted())
		self.assertEqual(case["product"], "quick")
		self.assertEqual(case["status"], "Submitted")
		self.assertEqual(case["applicant_eid"], TRADER_EID)

	def test_the_bank_expects_no_identity_document_and_no_photos(self):
		self.assertEqual(self.in_queue(self.submitted())["evidence_missing"], [])


class TestTradingEvidence(QuickLoanCase):
	"""A trader proves they trade with a phone camera, not with formal records."""

	def setUp(self):
		super().setUp()
		self.application = self.save()["name"]

	def attach(self, document_type: str, file_name: str, content: bytes):
		"""Open a shelf row and attach a file to it, as Frappe's upload_file does."""
		with self.set_user(TRADER):
			identity = {"id_document_kind": "Passport", "id_document_number": "R0123456"} if document_type == "Identity" else {}
			row = documents.new_document(document_type=document_type, application=self.application, **identity)["name"]
		return frappe.get_doc(
			{
				"doctype": "File",
				"file_name": file_name,
				"content": content,
				"attached_to_doctype": documents.DOCTYPE,
				"attached_to_name": row,
				"is_private": 1,
			}
		).insert(ignore_permissions=True)

	def test_a_photo_of_the_trade_may_be_a_jpeg_or_a_png(self):
		for file_name, content in (("stall.jpg", JPEG), ("stall.jpeg", JPEG), ("stall.png", PNG)):
			self.assertTrue(self.attach("Trading Photo", file_name, content).is_private, file_name)

	def test_receipts_may_be_photographed_or_scanned(self):
		for file_name, content in (("receipt.jpg", JPEG), ("receipt.pdf", PDF)):
			self.attach("Receipts or Records", file_name, content)

	def test_a_file_renamed_to_look_like_a_photo_is_refused(self):
		# PNG is the format Frappe does not parse on upload, so this check is ours.
		for content in (EXE, PDF, JPEG):
			with self.assertRaises(frappe.ValidationError):
				self.attach("Trading Photo", "stall.png", content)

	def test_a_trading_photo_is_a_photo_not_a_document(self):
		with self.assertRaises(frappe.ValidationError):
			self.attach("Trading Photo", "stall.pdf", PDF)

	def test_other_evidence_stays_pdf_only(self):
		with self.assertRaises(frappe.ValidationError):
			self.attach("Bank Statement", "statement.jpg", JPEG)

	def test_an_identity_document_may_be_a_photo(self):
		# GDB, 2026-10-03: a photo of the card or page, or a PDF scan.
		self.attach("Identity", "id.jpg", JPEG)

	def test_a_real_pdf_is_still_accepted_for_other_evidence(self):
		self.attach("Identity", "id.pdf", PDF)

	def test_the_upload_control_is_told_what_each_type_accepts(self):
		with self.set_user(TRADER):
			accepts = documents.document_settings()["accepts_by_type"]
		self.assertEqual(accepts["Trading Photo"], ".jpg,.jpeg,.png,.webp,.heic,.heif")
		self.assertEqual(accepts["Identity"], ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif")
		self.assertEqual(accepts["Payslip"], ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif")


DISBURSER = "test-gdb-quick-disburser@example.gy"
FINANCE = "test-gdb-quick-finance@example.gy"
REASON = "Stall seen at Bourda Market; trading two years."


class RoadToPayment(QuickLoanCase):
	"""Since 2026-10-02 a Quick Loan goes the road every GDB loan goes: the
	underwriter decides, a Letter of Offer is issued and signed, and a DIFFERENT
	officer books and pays. The one-step approve-and-pay is retired."""

	def setUp(self):
		super().setUp()
		_user(UNDERWRITER, "Loan Underwriter")
		_user(DISBURSER, "Disbursement Officer", "Citizen")
		self.payout_account(TRADER)

	def payout_account(self, user: str, status: str = "Verified"):
		with self.set_user(user):
			api.save_bank_details(bank="Citizen Bank", bank_account_no="0009111122223333")
		customer = frappe.db.get_value("Customer", {"gdb_user": user})
		account = frappe.db.get_value("Bank Account", {"party_type": "Customer", "party": customer})
		frappe.db.set_value("Bank Account", account, "gdb_verification_status", status)

	def submitted(self, user: str = TRADER, **overrides) -> str:
		with self.set_user(user):
			fields = {
				"product": "quick",
				"loan_amount": 150000,
				"purpose": "Buy more stock for the stall",
				"term_months": 6,
				"sections": dict(TRADE),
			}
			fields.update(overrides)
			name = api.save_application(**fields)["name"]
			api.submit_application(name=name, accept_terms=1, credit_check_consent=1)
		return name

	def approved(self) -> str:
		name = self.submitted()
		with self.set_user(UNDERWRITER):
			api.review_loan(name=name, action="approve", remarks=REASON)
		return name

	def offered(self) -> tuple[str, str]:
		from gdb_bank import offers

		name = self.approved()
		with self.set_user(UNDERWRITER):
			offer = offers.issue_offer(application=name)["name"]
		return name, offer

	def signed(self) -> tuple[str, str]:
		from gdb_bank import conditions, offers

		name, offer = self.offered()
		with self.set_user(TRADER):
			offers.accept_offer(
				name=offer, accepted_name=frappe.db.get_value("GDB Loan Offer", offer, "applicant_name")
			)
		with self.set_user(UNDERWRITER):
			for row in conditions.list_conditions(application=name)["conditions"]:
				conditions.verify_condition(name=row["name"], status="Met")
		return name, offer

	def loan(self, application: str):
		return frappe.db.get_value(
			"Loan",
			{"loan_application": application},
			["name", "status", "loan_amount", "disbursed_amount", "repayment_periods"],
			as_dict=True,
		)


class TestAQuickLoansRoadToPayment(RoadToPayment):
	def test_the_underwriter_approves_and_nothing_is_paid_on_approval(self):
		name = self.approved()
		decided = frappe.db.get_value("Loan Application", name, ["status", "gdb_reviewed_by"], as_dict=True)
		self.assertEqual(decided.status, "Approved")
		self.assertEqual(decided.gdb_reviewed_by, UNDERWRITER)
		self.assertIsNone(self.loan(name))

	def test_its_letter_of_offer_asks_nothing_an_informal_trader_cannot_meet(self):
		name, offer = self.offered()
		row = frappe.db.get_value("GDB Loan Offer", offer, ["conditions", "term_months", "agreement_text"], as_dict=True)
		self.assertEqual(row.term_months, 6)
		self.assertNotIn("Registr", row.conditions)
		self.assertIn("Proof of identity", row.conditions)
		self.assertIn("LETTER OF OFFER", row.agreement_text)
		with self.set_user(TRADER):
			self.assertEqual(api.loan_detail(name=name)["stage"], "Signing")

	def test_nothing_is_booked_before_the_borrower_signs(self):
		name, _offer = self.offered()
		with self.set_user(DISBURSER), self.assertRaises(frappe.ValidationError):
			api.book_loan(application=name)

	def test_once_signed_a_disbursement_officer_books_and_pays(self):
		name, _offer = self.signed()
		with self.set_user(DISBURSER):
			api.book_loan(application=name)
			api.disburse_loan(application=name)
		loan = self.loan(name)
		self.assertEqual(loan.disbursed_amount, 150000)
		self.assertEqual(loan.repayment_periods, 6)
		released_by = frappe.db.get_value("Loan Disbursement", {"against_loan": loan.name}, "gdb_disbursed_by")
		self.assertEqual(released_by, DISBURSER)
		# The first instalment: a month after release, plus the one-month
		# moratorium the trader chose — never the end of the release month.
		from frappe.utils import add_months, getdate, nowdate

		schedule = frappe.get_all("Loan Repayment Schedule", {"loan": loan.name, "docstatus": 1}, pluck="name")
		due = frappe.get_all(
			"Repayment Schedule",
			{"parent": schedule[0], "total_payment": [">", 0]},
			pluck="payment_date",
			order_by="payment_date asc",
		)
		self.assertEqual(len(due), 6)
		self.assertEqual(getdate(due[0]), getdate(add_months(nowdate(), 2)))

	def test_the_underwriter_cannot_pay_it(self):
		name, _offer = self.signed()
		with self.set_user(UNDERWRITER), self.assertRaises(frappe.PermissionError):
			api.book_loan(application=name)

	def test_the_one_step_approve_and_pay_is_retired(self):
		name = self.submitted()
		for user in (UNDERWRITER, DISBURSER):
			with self.set_user(user), self.assertRaises(frappe.ValidationError):
				api.decide_quick_loan(application=name, action="approve", remarks=REASON)
		self.assertIsNone(self.loan(name))
		self.assertEqual(frappe.db.get_value("Loan Application", name, "status"), "Open")

	def test_an_officer_can_never_decide_their_own_quick_loan(self):
		_user(f"x-{UNDERWRITER}", "Loan Underwriter", "Citizen")
		self.payout_account(f"x-{UNDERWRITER}")
		name = self.submitted(user=f"x-{UNDERWRITER}")
		with self.set_user(f"x-{UNDERWRITER}"), self.assertRaises(frappe.PermissionError):
			api.review_loan(name=name, action="approve", remarks=REASON)

	# -- the borrower's side of the bargain ------------------------------------

	def test_a_quick_loan_is_not_put_before_the_bank_until_its_terms_are_accepted(self):
		with self.set_user(TRADER):
			name = self.save()["name"]
			with self.assertRaises(frappe.ValidationError):
				api.submit_application(name=name)
			with self.assertRaises(frappe.ValidationError):
				api.submit_application(name=name, accept_terms=1)
			api.submit_application(name=name, accept_terms=1, credit_check_consent=1)
		recorded = frappe.db.get_value(
			"Loan Application", name, ["gdb_terms_accepted_on", "gdb_credit_consent_on"], as_dict=True
		)
		self.assertTrue(recorded.gdb_terms_accepted_on)
		self.assertTrue(recorded.gdb_credit_consent_on)


class TestTheApplicantsOwnDetails(QuickLoanCase):
	def test_date_of_birth_and_national_id_are_declared_on_the_profile(self):
		from gdb_bank import profiles

		with self.set_user(TRADER):
			profiles.save_profile(date_of_birth="1988-04-09", national_id="778850")
			mine = profiles.my_profile()
		self.assertEqual(str(mine["date_of_birth"]), "1988-04-09")
		self.assertEqual(mine["national_id"], "778850")

	def test_the_account_holder_name_is_recorded_as_given(self):
		with self.set_user(TRADER):
			saved = api.save_bank_details(
				bank="Citizen Bank", bank_account_no="0009111122223333", account_name="Stall Co"
			)
		self.assertEqual(saved["account_name"], "Stall Co")

	def test_the_account_type_is_recorded_when_given(self):
		install.ensure_bank_account_types()
		with self.set_user(TRADER):
			saved = api.save_bank_details(
				bank="Citizen Bank", bank_account_no="0009111122223333", account_type="Savings"
			)
		self.assertEqual(saved["account_type"], "Savings")

	def test_an_account_type_other_than_checking_or_savings_is_refused(self):
		with self.set_user(TRADER), self.assertRaises(frappe.ValidationError):
			api.save_bank_details(bank="Citizen Bank", bank_account_no="0009111122223333", account_type="Credit")


OTHER = "test-gdb-quick-other@example.gy"


class TestAskingForAFieldOfficer(QuickLoanCase):
	def ask(self, user: str = TRADER, **overrides):
		fields = {
			"applicant_name": "Ravi Singh",
			"phone": "+592 666 8850",
			"business_type": "Market vendor",
			"region": "Region 3",
			"best_time": "Morning",
		}
		fields.update(overrides)
		with self.set_user(user):
			return api.request_field_officer(**fields)

	def test_a_request_records_who_to_call_and_waits(self):
		request = self.ask()
		self.assertEqual(request["status"], "Waiting")
		self.assertEqual(request["phone"], "+592 666 8850")
		with self.set_user(TRADER):
			self.assertEqual(api.my_field_officer_request()["name"], request["name"])

	def test_asking_again_while_waiting_does_not_open_a_second_request(self):
		self.assertEqual(self.ask()["name"], self.ask()["name"])

	def test_who_to_call_is_required(self):
		for blank in ("applicant_name", "phone", "business_type", "region"):
			with self.assertRaises(frappe.ValidationError, msg=blank):
				self.ask(**{blank: ""})

	def test_the_applicant_can_cancel_and_nobody_else_can(self):
		_user(OTHER, "Citizen")
		request = self.ask()
		with self.set_user(OTHER), self.assertRaises(frappe.PermissionError):
			api.cancel_field_officer_request(name=request["name"])
		with self.set_user(TRADER):
			self.assertEqual(api.cancel_field_officer_request(name=request["name"])["status"], "Cancelled")


class TestReviewedOnce(TestAQuickLoansRoadToPayment):
	"""A settled condition and a reviewed document stay as they were decided."""

	def test_a_met_condition_cannot_be_waived_until_reopened(self):
		from gdb_bank import conditions

		name, _offer = self.offered()
		with self.set_user(TRADER):
			from gdb_bank import offers

			offers.accept_offer(name=_offer, accepted_name=frappe.db.get_value("GDB Loan Offer", _offer, "applicant_name"))
		with self.set_user(UNDERWRITER):
			row = conditions.list_conditions(application=name)["conditions"][0]
			conditions.verify_condition(name=row["name"], status="Met")
			with self.assertRaisesRegex(frappe.ValidationError, "already met"):
				conditions.verify_condition(name=row["name"], status="Waived")
			conditions.verify_condition(name=row["name"], status="Outstanding")
			self.assertEqual(conditions.verify_condition(name=row["name"], status="Waived")["status"], "Waived")

	def test_an_accepted_document_cannot_then_be_rejected(self):
		doc = frappe.get_doc(
			{"doctype": documents.DOCTYPE, "applicant": TRADER, "document_type": "Identity", "status": "Received"}
		).insert(ignore_permissions=True)
		with self.set_user(UNDERWRITER):
			documents.review_document(name=doc.name, status="Accepted")
			with self.assertRaisesRegex(frappe.ValidationError, "already been accepted"):
				documents.review_document(name=doc.name, status="Rejected")


class TestOneOfEachKindAtATime(RoadToPayment):
	"""One Quick Loan and one SME Loan per citizen; the next of a kind waits
	until the last is cleared (services/eligibility.py)."""

	def kinds(self) -> dict:
		with self.set_user(TRADER):
			return api.my_loan_eligibility()

	def sme_draft(self) -> dict:
		with self.set_user(TRADER):
			return api.save_application(loan_amount=500000, purpose="New oven", term_months=12)

	def test_a_fresh_citizen_may_apply_for_either(self):
		kinds = self.kinds()
		self.assertTrue(kinds["quick"]["can_apply"] and kinds["standard"]["can_apply"])

	def test_a_second_draft_of_the_same_kind_is_refused_and_the_first_continues(self):
		first = self.save()
		with self.assertRaisesRegex(frappe.ValidationError, "already have a Quick Loan application in progress"):
			self.save()
		self.assertEqual(self.save(name=first["name"], loan_amount=120000)["name"], first["name"])
		self.assertEqual(self.kinds()["quick"]["open_case"]["kind"], "draft")

	def test_a_quick_loan_does_not_block_an_sme_loan(self):
		self.submitted()
		self.assertTrue(self.sme_draft()["name"])
		kinds = self.kinds()
		self.assertFalse(kinds["quick"]["can_apply"])
		self.assertEqual(kinds["standard"]["open_case"]["kind"], "draft")

	def test_one_with_the_bank_blocks_the_next_until_it_is_declined(self):
		name = self.submitted()
		self.assertEqual(self.kinds()["quick"]["open_case"]["kind"], "review")
		with self.assertRaisesRegex(frappe.ValidationError, "is with GDB"):
			self.save()
		with self.set_user(UNDERWRITER):
			api.review_loan(name=name, action="reject", remarks=REASON)
		self.assertTrue(self.kinds()["quick"]["can_apply"])
		self.assertTrue(self.save()["name"])

	def test_a_loan_not_yet_repaid_blocks_the_next_and_a_closed_one_does_not(self):
		name, _offer = self.signed()
		self.assertEqual(self.kinds()["quick"]["open_case"]["kind"], "approved")
		with self.set_user(DISBURSER):
			api.book_loan(application=name)
		loan = self.loan(name)
		blocking = self.kinds()["quick"]
		self.assertEqual(blocking["open_case"]["kind"], "loan")
		self.assertIn("not yet repaid", blocking["message"])
		with self.assertRaisesRegex(frappe.ValidationError, "Clear it to apply"):
			self.save()
		frappe.db.set_value("Loan", loan.name, "status", "Written Off")
		self.assertFalse(self.kinds()["quick"]["can_apply"])
		frappe.db.set_value("Loan", loan.name, "status", "Closed")
		self.assertTrue(self.kinds()["quick"]["can_apply"])

	def test_a_declined_or_lapsed_offer_ends_the_case(self):
		name, offer = self.offered()
		self.assertFalse(self.kinds()["quick"]["can_apply"])
		frappe.db.set_value("GDB Loan Offer", offer, "valid_until", "2020-01-01")
		self.assertTrue(self.kinds()["quick"]["can_apply"])

	def test_an_old_draft_cannot_be_submitted_past_an_open_case(self):
		# Two drafts left over from before the rule: the second may not be put
		# before the Bank while the first is with it.
		first = self.save()["name"]
		frappe.db.set_value("Loan Application", first, "creation", "2026-01-01 00:00:00")
		with patch("gdb_bank.services.eligibility.require_none_open"):
			second = self.save()["name"]
		with self.set_user(TRADER):
			api.submit_application(name=first, accept_terms=1, credit_check_consent=1)
			with self.assertRaisesRegex(frappe.ValidationError, "is with GDB"):
				api.submit_application(name=second, accept_terms=1, credit_check_consent=1)
