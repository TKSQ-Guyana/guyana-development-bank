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
TRADE = {"trade_activity": "Sell vegetables", "trade_location": "Fixed location", "trading_since": "1 to 3 years", "trade_region": "Region 4"}


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


def longest_term(**layers):
	return configured(policy.QUICK_TERM_KEY, policy.QUICK_TERM_ENV, **layers)


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

	def test_the_longest_term_defaults_to_twelve_months(self):
		with longest_term():
			self.assertEqual(policy.quick_loan_max_term(), 12)

	def test_a_configured_longest_term_is_used(self):
		with longest_term(site_config="9"):
			self.assertEqual(policy.quick_loan_max_term(), 9)

	def test_a_longest_term_that_is_not_a_whole_number_of_months_is_refused(self):
		for bad in ("a year", "0", "6.5", "400"):
			with longest_term(site_config=bad):
				self.assertEqual(policy.quick_loan_max_term(), 12, bad)


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

	def test_the_standard_product_stays_uncapped(self):
		install.ensure_quick_loan_product()
		with ceiling(site_config="200000"):
			install.ensure_product_terms()
		standard = frappe.db.get_value("Loan Product", {"product_name": install.LOAN_PRODUCT_NAME})
		self.assertEqual(frappe.db.get_value("Loan Product", standard, "maximum_loan_amount"), 0)

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
		self.assertEqual(draft["sections"]["trade_location"], "Fixed location")
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
		self.assertFalse(self.save()["business_name"])
		self.assertEqual(self.save(business_name="Singh Fresh Greens")["business_name"], "Singh Fresh Greens")

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

	def submitted(self) -> str:
		name = self.save()["name"]
		with self.set_user(TRADER):
			api.submit_application(name=name, accept_terms=1, credit_check_consent=1)
		return name

	def in_queue(self, name: str) -> dict:
		with self.set_user(UNDERWRITER):
			return next(case for case in api.all_loans() if case["name"] == name)

	def test_a_submitted_quick_loan_reaches_the_review_queue_as_a_quick_loan(self):
		case = self.in_queue(self.submitted())
		self.assertEqual(case["product"], "quick")
		self.assertEqual(case["status"], "Submitted")
		self.assertEqual(case["applicant_eid"], TRADER_EID)

	def test_the_bank_expects_identity_and_a_photo_of_the_trade_not_accounts(self):
		self.assertEqual(self.in_queue(self.submitted())["evidence_missing"], ["Identity", "Trading Photo"])


class TestTradingEvidence(QuickLoanCase):
	"""A trader proves they trade with a phone camera, not with formal records."""

	def setUp(self):
		super().setUp()
		self.application = self.save()["name"]

	def attach(self, document_type: str, file_name: str, content: bytes):
		"""Open a shelf row and attach a file to it, as Frappe's upload_file does."""
		with self.set_user(TRADER):
			row = documents.new_document(document_type=document_type, application=self.application)["name"]
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
			self.attach("Identity", "id.jpg", JPEG)

	def test_a_real_pdf_is_still_accepted_for_other_evidence(self):
		self.attach("Identity", "id.pdf", PDF)

	def test_the_upload_control_is_told_what_each_type_accepts(self):
		with self.set_user(TRADER):
			accepts = documents.document_settings()["accepts_by_type"]
		self.assertEqual(accepts["Trading Photo"], ".jpg,.jpeg,.png")
		self.assertEqual(accepts["Identity"], ".pdf")


DISBURSER = "test-gdb-quick-disburser@example.gy"
FINANCE = "test-gdb-quick-finance@example.gy"
REASON = "Stall seen at Bourda Market; trading two years."


class TestDecidingAndPayingAQuickLoan(QuickLoanCase):
	"""GDB's exception, taken 2026-09-30: a Quick Loan is decided AND paid by one
	Disbursement Officer — no underwriter, no Letter of Offer. These tests are the
	controls that stand in for the four eyes it gives up."""

	def setUp(self):
		super().setUp()
		_user(UNDERWRITER, "Loan Underwriter")
		_user(DISBURSER, "Disbursement Officer", "Citizen")
		self.payout_account(TRADER)

	def payout_account(self, user: str, status: str = "Verified"):
		with self.set_user(user):
			api.save_bank_details(bank="Citizens Bank Guyana", bank_account_no="0009111122223333")
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

	def decide(self, name: str, action: str = "approve", remarks: str = REASON, user: str = DISBURSER):
		with self.set_user(user):
			return api.decide_quick_loan(application=name, action=action, remarks=remarks)

	def loan(self, application: str):
		return frappe.db.get_value(
			"Loan",
			{"loan_application": application},
			["name", "status", "loan_amount", "disbursed_amount", "repayment_periods"],
			as_dict=True,
		)

	# -- the one step ----------------------------------------------------------

	def test_one_officer_approves_and_pays_a_quick_loan_in_one_step(self):
		name = self.submitted()
		self.decide(name)
		loan = self.loan(name)
		self.assertEqual(loan.disbursed_amount, 150000)
		self.assertEqual(loan.repayment_periods, 6)
		self.assertEqual(loan.status, "Disbursed")
		self.assertEqual(frappe.db.get_value("Loan Application", name, "status"), "Approved")

	def test_the_decision_and_the_release_both_name_the_officer_and_the_reason(self):
		name = self.submitted()
		self.decide(name)
		decided = frappe.db.get_value(
			"Loan Application", name, ["gdb_reviewed_by", "gdb_remarks"], as_dict=True
		)
		self.assertEqual(decided.gdb_reviewed_by, DISBURSER)
		self.assertEqual(decided.gdb_remarks, REASON)
		released_by = frappe.db.get_value(
			"Loan Disbursement", {"against_loan": self.loan(name).name}, "gdb_disbursed_by"
		)
		self.assertEqual(released_by, DISBURSER)

	def test_asking_twice_pays_once(self):
		name = self.submitted()
		self.decide(name)
		with self.assertRaises(frappe.ValidationError):
			self.decide(name)
		self.assertEqual(frappe.db.count("Loan Disbursement", {"against_loan": self.loan(name).name}), 1)

	def test_a_decline_books_nothing_and_pays_nothing(self):
		name = self.submitted()
		self.decide(name, action="decline")
		self.assertEqual(frappe.db.get_value("Loan Application", name, "status"), "Rejected")
		self.assertIsNone(self.loan(name))

	# -- what stands in for the second pair of eyes ----------------------------

	def test_a_decision_needs_a_reason(self):
		name = self.submitted()
		for blank in ("", "   "):
			with self.assertRaises(frappe.ValidationError):
				self.decide(name, remarks=blank)

	def test_an_officer_can_never_pay_their_own_quick_loan(self):
		self.payout_account(DISBURSER)
		name = self.submitted(user=DISBURSER)
		with self.assertRaises(frappe.PermissionError):
			self.decide(name)
		self.assertIsNone(self.loan(name))

	def test_an_underwriter_may_also_decide_and_pay_a_quick_loan(self):
		self.payout_account(TRADER)
		name = self.submitted()
		self.decide(name, user=UNDERWRITER)
		self.assertEqual(self.loan(name).disbursed_amount, 150000)
		self.assertEqual(frappe.db.get_value("Loan Application", name, "gdb_reviewed_by"), UNDERWRITER)

	def test_only_an_underwriter_or_disbursement_officer_may_decide_a_quick_loan(self):
		_user(FINANCE, "Finance Officer")
		name = self.submitted()
		for user in (TRADER, FINANCE):
			with self.assertRaises(frappe.PermissionError, msg=user):
				self.decide(name, user=user)

	def test_the_underwriters_review_is_not_a_door_to_a_quick_loan(self):
		name = self.submitted()
		with self.set_user(UNDERWRITER), self.assertRaises(frappe.ValidationError):
			api.review_loan(name=name, action="approve")

	def test_a_quick_loan_has_no_letter_of_offer(self):
		from gdb_bank import offers

		name = self.submitted()
		frappe.get_doc("Loan Application", name).db_set("status", "Approved")
		with self.set_user(UNDERWRITER), self.assertRaises(frappe.ValidationError):
			offers.issue_offer(application=name)

	def test_a_standard_loan_cannot_be_paid_this_way(self):
		with self.set_user(TRADER):
			name = api.save_application(loan_amount=500000, purpose="New oven", term_months=12)["name"]
			api.submit_application(name=name)
		with self.assertRaises(frappe.ValidationError):
			self.decide(name)

	def test_an_account_the_bank_could_not_verify_does_not_stop_payment(self):
		# GDB's decision, 2026-09-30: the check is recorded on the account, not a gate.
		self.payout_account(TRADER, status="Not Found")
		name = self.submitted()
		self.decide(name)
		self.assertEqual(self.loan(name).disbursed_amount, 150000)

	def test_nothing_is_paid_without_an_account_on_file(self):
		name = self.submitted()
		customer = frappe.db.get_value("Customer", {"gdb_user": TRADER})
		frappe.db.delete("Bank Account", {"party_type": "Customer", "party": customer})
		with self.assertRaises(frappe.ValidationError):
			self.decide(name)
		self.assertIsNone(self.loan(name))

	def test_the_ceiling_is_checked_again_at_the_moment_of_payment(self):
		name = self.submitted()
		product = frappe.db.get_value("Loan Application", name, "loan_product")
		frappe.db.set_value("Loan Product", product, "maximum_loan_amount", 100000)
		with self.assertRaises(frappe.ValidationError):
			self.decide(name)
		self.assertIsNone(self.loan(name))

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
				bank="Citizens Bank Guyana", bank_account_no="0009111122223333", account_name="Stall Co"
			)
		self.assertEqual(saved["account_name"], "Stall Co")


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
