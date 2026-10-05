"""Statement of account: the portal shows what lending's own report shows.

Lending's Loan Statement of Account is the borrower's statement in the ERPNext
desk. The portal's statement is that report, cut to the period asked for, so a
borrower and a GDB officer reading the same loan read the same figures.

Every test books a real loan through the portal's own endpoints, releases
G$120,000, takes one payment of G$10,000, and reads the statement back through
loan_account as the borrower. The endpoints commit, so commit is suppressed and
each test is rolled back: nothing stays on the site.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_statement
"""

from unittest.mock import patch

import frappe

from gdb_bank.tests.sme_fixture import complete_sme
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from gdb_bank import api, conditions, offers

BORROWER = "test-gdb-statement-borrower@example.gy"
UNDERWRITER = "test-gdb-statement-underwriter@example.gy"
DISBURSER = "test-gdb-statement-disburser@example.gy"


def _user(email: str, *roles: str) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": email.split("@")[0].removeprefix("test-gdb-statement-").title(),
			"send_welcome_email": 0,
			"roles": [{"role": role} for role in roles],
		}
	).insert(ignore_permissions=True)


class TestStatement(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		# The loan officer's checklist (services/checklist) has its own tests;
		# here it stands aside so booking and payment can be tested on their own.
		self.enterContext(patch("gdb_bank.services.checklist.require_ready"))

		_user(BORROWER, "Citizen")
		_user(UNDERWRITER, "Loan Underwriter")
		_user(DISBURSER, "Disbursement Officer")

		self.application = self.released_and_repaid()

	# -- helpers ---------------------------------------------------------------

	def released_and_repaid(self) -> str:
		"""G$120,000 over 12 months, fully released, then G$10,000 paid."""
		with self.set_user(BORROWER):
			application = api.save_application(
				loan_amount=360000, purpose="Statement test", term_months=12, sections={"moratorium_months": 1, "has_existing_debts": "No"}
			)["name"]
			complete_sme(BORROWER, application)
			api.submit_application(name=application)
		with self.set_user(UNDERWRITER):
			api.review_loan(name=application, action="approve")
			offer = offers.issue_offer(application=application)["name"]
		with self.set_user(BORROWER):
			offers.accept_offer(name=offer, accepted_name="Borrower")
		with self.set_user(DISBURSER):
			api.book_loan(application=application)
			for condition in conditions.list_conditions(application=application)["conditions"]:
				conditions.verify_condition(name=condition.name, status="Met")
			api.disburse_loan(application=application)
		with self.set_user(BORROWER):
			api.make_repayment(application=application, amount=10000)
		return application

	def statement(self, from_date: str, to_date: str) -> dict:
		with self.set_user(BORROWER):
			return api.loan_account(
				application=self.application, from_date=from_date, to_date=to_date
			)["statement"]

	# -- the period ------------------------------------------------------------

	def test_a_statement_over_the_whole_loan_opens_at_nothing_and_closes_at_what_is_owed(self):
		statement = self.statement(add_days(nowdate(), -365), nowdate())

		self.assertEqual(statement["opening_balance"], 0)
		self.assertEqual(
			[
				(t["transaction_doctype"], t["debit"], t["credit"], t["balance"])
				for t in statement["transactions"]
			],
			[("Loan Disbursement", 360000, 0, 360000), ("Loan Repayment", 0, 10000, 350000)],
		)
		self.assertEqual(statement["closing_balance"], 350000)

	def test_a_later_period_opens_at_the_balance_carried_forward(self):
		statement = self.statement(add_days(nowdate(), 1), add_days(nowdate(), 30))

		self.assertEqual(
			(statement["opening_balance"], statement["transactions"], statement["closing_balance"]),
			(350000, [], 350000),
		)

	def test_a_period_that_ends_before_the_loan_existed_has_nothing_on_it(self):
		statement = self.statement(add_days(nowdate(), -60), add_days(nowdate(), -1))

		self.assertEqual(
			(statement["opening_balance"], statement["transactions"], statement["closing_balance"]),
			(0, [], 0),
		)

	# -- the ledger ------------------------------------------------------------

	def test_the_statement_closes_where_erpnexts_general_ledger_closes(self):
		"""Both lending documents reached ERPNext's books, and the books agree.

		The statement is read from lending's documents; the General Ledger is
		what their accounting hooks posted. Two different records of the same
		loan, so each is held to the figure the loan should stand at, not to the
		other.
		"""
		from frappe.desk.query_report import run

		loan = frappe.db.get_value(
			"Loan", {"loan_application": self.application}, ["name", "company", "loan_account"], as_dict=True
		)
		ledger = run(
			"General Ledger",
			filters={
				"company": loan.company,
				"from_date": add_days(nowdate(), -365),
				"to_date": nowdate(),
				"account": [loan.loan_account],
				"against_voucher_no": loan.name,
				"group_by": "Group by Voucher (Consolidated)",
			},
		)["result"]
		posted = [row for row in ledger if isinstance(row, dict) and row.get("voucher_type")]
		closing = next(row for row in ledger if row.get("account") == "'Closing (Opening + Total)'")

		self.assertEqual(
			[(row["voucher_type"], row["debit"], row["credit"]) for row in posted],
			[("Loan Disbursement", 360000, 0), ("Loan Repayment", 0, 10000)],
		)
		self.assertEqual(closing["balance"], 350000)
		self.assertEqual(self.statement(add_days(nowdate(), -365), nowdate())["closing_balance"], 350000)
