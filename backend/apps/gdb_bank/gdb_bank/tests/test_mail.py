"""Outgoing email (gdb_bank/integrations/mail.py) and the notices that use it.

frappe.sendmail is stubbed: these are the portal's rules about WHO is mailed
and WHEN; delivery is Frappe's and the SMTP server's.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_mail
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank.integrations import mail
from gdb_bank.services.notification import notify

ON = {"gdb_smtp_user": "gdb.portal@example.gy", "gdb_smtp_password": "app-password"}
PERSON = "test-gdb-mail-person@example.gy"


class TestMail(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)
		self.sendmail = self.enterContext(patch.object(frappe, "sendmail"))

	def test_mail_is_off_until_the_login_and_app_password_are_set(self):
		with patch.dict(frappe.conf, {"gdb_smtp_user": "", "gdb_smtp_password": ""}), patch.dict(
			"os.environ", {"GDB_SMTP_USER": "", "GDB_SMTP_PASSWORD": ""}
		):
			self.assertFalse(mail.configured())
			self.assertFalse(mail.send("someone@example.gy", "Hello"))
		self.sendmail.assert_not_called()

	def test_a_real_address_is_mailed_with_a_link_to_the_portal(self):
		with patch.dict(frappe.conf, ON):
			self.assertTrue(mail.send("someone@gdb.gov.gy", "Your offer is ready", "<p>x</p>", "/loans/ACC-1"))
		message = self.sendmail.call_args.kwargs["message"]
		self.assertEqual(self.sendmail.call_args.kwargs["recipients"], ["someone@gdb.gov.gy"])
		self.assertIn("/loans/ACC-1", message)
		self.assertIn("never ask you for your password", message)

	def test_placeholder_and_system_addresses_are_never_mailed(self):
		with patch.dict(frappe.conf, ON):
			for address in ("987654321@tin.gdb.invalid", "Administrator", "Guest", "", None, "not-an-address"):
				self.assertFalse(mail.send(address, "Hello"), address)
		self.sendmail.assert_not_called()

	def test_a_notice_in_the_portal_is_also_emailed(self):
		frappe.get_doc(
			{"doctype": "User", "email": PERSON, "first_name": "Mail", "send_welcome_email": 0}
		).insert(ignore_permissions=True)
		with patch.dict(frappe.conf, ON):
			notify(PERSON, "Your Letter of Offer is ready to sign", "/loans/ACC-2")
		self.assertTrue(frappe.db.exists("Notification Log", {"for_user": PERSON}))
		self.assertEqual(self.sendmail.call_args.kwargs["recipients"], [PERSON])
		self.assertIn("Hello Mail", self.sendmail.call_args.kwargs["message"])

	def test_a_mail_failure_never_undoes_the_notice(self):
		frappe.get_doc(
			{"doctype": "User", "email": PERSON, "first_name": "Mail", "send_welcome_email": 0}
		).insert(ignore_permissions=True)
		self.sendmail.side_effect = RuntimeError("smtp down")
		with patch.dict(frappe.conf, ON):
			notify(PERSON, "Something happened", "/")
		self.assertTrue(frappe.db.exists("Notification Log", {"for_user": PERSON}))
