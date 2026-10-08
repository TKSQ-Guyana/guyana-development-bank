"""Telling the applicant what staff did on their case (services/case_notice.py).

Every test acts through the portal's own endpoints as the person acting. Mail
and SMS are stubbed: these tests are about who is told, by which channel, and
that the officer's action never depends on it.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_case_notice
"""

from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, conditions, documents
from gdb_bank.services import case_notice
from gdb_bank.services.citizen_import import _room_for_new_users
from gdb_bank.tests.sme_fixture import complete_sme

CITIZEN = "test-gdb-notice-citizen@tin.gdb.invalid"
MAILED = "test-gdb-notice-mailed@example.gy"
OFFICER = "test-gdb-notice-officer@example.gy"
PHONE = "+5926001234"


def _user(email: str, *roles: str, user_type: str = "Website User", mobile: str | None = None) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": "Notice",
			"last_name": "Test",
			"user_type": user_type,
			"mobile_no": mobile,
			"send_welcome_email": 0,
			"roles": [{"role": role} for role in roles],
		}
	).insert(ignore_permissions=True)


class NoticeCase(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		self.enterContext(_room_for_new_users())
		self.sms = self.enterContext(patch("gdb_bank.integrations.sms.send", return_value=True))
		self.mail = self.enterContext(patch("gdb_bank.integrations.mail.send", return_value=False))
		_user(CITIZEN, "Citizen", mobile=PHONE)
		_user(OFFICER, "Loan Underwriter", user_type="System User")

	@contextmanager
	def as_user(self, user: str):
		previous = frappe.session.user
		frappe.set_user(user)
		try:
			yield
		finally:
			frappe.set_user(previous)

	def submitted(self, user: str = CITIZEN) -> str:
		with self.as_user(user):
			name = api.save_application(
				loan_amount=500000,
				purpose="Cold store",
				term_months=12,
				sections={"moratorium_months": 1, "has_existing_debts": "No"},
			)["name"]
			complete_sme(user, name)
			api.submit_application(name=name)
		self.sms.reset_mock()
		self.mail.reset_mock()
		return name

	def inbox(self, user: str = CITIZEN) -> list[str]:
		return frappe.get_all("Notification Log", filters={"for_user": user}, pluck="subject", order_by="creation asc")


class TestTheLoanOfficersActionsAreTold(NoticeCase):
	def test_a_decision_reaches_the_applicant_by_text_without_the_remarks(self):
		application = self.submitted()
		with self.as_user(OFFICER):
			api.review_loan(name=application, action="reject", remarks="Internal: weak cash flow")

		self.assertIn(f"Your loan application {application} was not approved", self.inbox())
		phone, text = self.sms.call_args.args
		self.assertEqual(phone, PHONE)
		self.assertIn(application, text)
		self.assertIn("Sign in at gdb.gov.gy for details.", text)
		self.assertNotIn("weak cash flow", text)
		self.assertNotIn("weak cash flow", " ".join(self.inbox()))
		self.assertLessEqual(len(text), 160)

	def test_requests_and_conditions_are_told(self):
		application = self.submitted()
		with self.as_user(OFFICER):
			request = documents.request_information(application=application, item="Last three bank statements")["name"]
			documents.withdraw_request(name=request)
			condition = conditions.add_condition(application=application, description="Insurance on the cold store")["name"]
			conditions.verify_condition(name=condition, status="Waived")

		inbox = self.inbox()
		self.assertIn(f"GDB has asked for more information on your application {application}", inbox)
		self.assertIn(f"GDB has withdrawn a request on your application {application}", inbox)
		self.assertIn(f"A condition was added to your loan {application}", inbox)
		self.assertIn(f"A condition on your loan {application} is now waived", inbox)
		self.assertEqual(self.sms.call_count, 4)

	def test_a_reviewed_document_is_told_to_its_owner(self):
		application = self.submitted()
		row = frappe.get_all(documents.DOCTYPE, filters={"application": application}, pluck="name")[0]
		with self.as_user(OFFICER):
			documents.review_document(name=row, status="Rejected", note="Blurry")
		self.assertTrue(any(s.endswith("was not accepted — please upload it again") for s in self.inbox()))


class TestTheChannel(NoticeCase):
	def test_a_real_email_gets_the_email_and_no_text(self):
		_user(MAILED, "Citizen", mobile="+5926001235")
		self.mail.return_value = True
		application = self.submitted(MAILED)
		with self.as_user(OFFICER):
			documents.request_information(application=application, item="Proof of address")
		self.mail.assert_called_once()
		self.assertEqual(self.mail.call_args.args[0], MAILED)
		self.sms.assert_not_called()
		self.assertEqual(len(self.inbox(MAILED)), 1)

	def test_a_placeholder_login_is_emailed_at_the_profiles_address(self):
		self.mail.return_value = True
		application = self.submitted()
		frappe.db.set_value("GDB Citizen Profile", {"user": CITIZEN}, "email", "applicant.real@gmail.com")
		with self.as_user(OFFICER):
			documents.request_information(application=application, item="Bank account")
		self.assertEqual(self.mail.call_args.args[0], "applicant.real@gmail.com")
		self.sms.assert_not_called()

	def test_a_failing_channel_never_undoes_the_officers_action(self):
		application = self.submitted()
		self.sms.side_effect = RuntimeError("Infobip down")
		# The action has committed before anyone is told; a failure telling them
		# is logged and rolled back on its own. (Commits are suppressed in a test,
		# so that rollback is stubbed here to keep the test's own rows.)
		with self.as_user(OFFICER), patch.object(frappe.db, "rollback"):
			case = api.review_loan(name=application, action="reject")
		self.assertEqual(frappe.db.get_value("Loan Application", application, "status"), "Rejected")
		self.assertTrue(case)


class TestAGroupCase(NoticeCase):
	def test_every_active_member_and_the_facilitator_are_told(self):
		application = self.submitted()
		_user("test-gdb-notice-member@tin.gdb.invalid", "Citizen", mobile="+5926004321")
		_user("test-gdb-notice-invitee@tin.gdb.invalid", "Citizen", mobile="+5926004322")
		_user("test-gdb-notice-facilitator@example.gy", "Facilitator", user_type="System User")
		cluster = frappe.get_doc(
			{
				"doctype": "GDB Cluster",
				"cluster_name": "Test notice group",
				"facilitator": "test-gdb-notice-facilitator@example.gy",
				"members": [
					{"member": CITIZEN, "member_name": "Head", "member_status": "Active", "is_head": 1},
					{"member": "test-gdb-notice-member@tin.gdb.invalid", "member_name": "Member", "member_status": "Active"},
					{"member": "test-gdb-notice-invitee@tin.gdb.invalid", "member_name": "Invitee", "member_status": "Invited"},
				],
			}
		).insert(ignore_permissions=True)
		frappe.db.set_value("Loan Application", application, "gdb_cluster", cluster.name)

		told = dict(case_notice.recipients(application))
		self.assertEqual(
			set(told),
			{CITIZEN, "test-gdb-notice-member@tin.gdb.invalid", "test-gdb-notice-facilitator@example.gy"},
		)
		self.assertEqual(told["test-gdb-notice-facilitator@example.gy"], f"/facilitator/groups/{cluster.name}")
		self.assertEqual(told[CITIZEN], f"/loans/{application}")


class TestTheWording(IntegrationTestCase):
	def test_every_text_fits_one_sms(self):
		values = {"app": "ACC-LOAP-2026-00123", "document": "Proof of Address", "status": "outstanding",
			"kind": "site visit", "amount": case_notice.money(3000000)}
		for event in case_notice.EVENTS:
			subject, text = case_notice._words(event, values)
			self.assertLessEqual(len(text), 160, event)
			self.assertTrue(text.endswith(case_notice.SIGN_IN), event)

	def test_money_reads_as_guyana_dollars(self):
		self.assertEqual(case_notice.money(3000000), "G$3,000,000")
