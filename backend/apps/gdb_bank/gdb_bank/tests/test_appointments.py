"""The home page's "Book appointment" form, the GDB Representative's queue, and
the texts that say a request or an application was received.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_appointments
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, tin_auth
from gdb_bank.integrations import sms

REP = "test-gdb-representative@example.gy"
FORM = {
	"first_name": "Nadia",
	"last_name": "Persaud",
	"phone": "600 4321",
	"email": "nadia@example.gy",
	"region": "Region 4",
	"industry_sector": "Poultry",
	"reason": "Book appointment",
}


class AppointmentCase(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		for p in (patch.object(tin_auth.frappe.db, "commit"), patch.object(frappe.db, "commit")):
			p.start()
			self.addCleanup(p.stop)
		if not frappe.db.exists("User", REP):
			frappe.get_doc(
				{"doctype": "User", "email": REP, "first_name": "Rep", "send_welcome_email": 0,
				 "roles": [{"role": "GDB Representative"}]}
			).insert(ignore_permissions=True)
		self.sent = patch.object(sms, "send", return_value=True).start()
		self.addCleanup(patch.stopall)

	def book(self, **overrides) -> dict:
		with self.set_user("Guest"):
			return tin_auth.request_appointment(**{**FORM, **overrides})


class TestBookingAnAppointment(AppointmentCase):
	def test_the_request_is_kept_with_everything_the_form_asked(self):
		row = frappe.get_doc("GDB Appointment Request", self.book()["name"])
		self.assertEqual((row.status, row.reason), ("New", "Book appointment"))
		self.assertEqual((row.email, row.region, row.industry_sector), ("nadia@example.gy", "Region 4", "Poultry"))
		self.assertEqual(row.phone, "+5926004321")

	def test_the_person_is_texted_by_first_name_and_industry(self):
		self.book()
		phone, body = self.sent.call_args[0]
		self.assertEqual(phone, "+5926004321")
		self.assertEqual(
			body,
			"Hi Nadia, we received your SMB loan request for Poultry. "
			"Our team will contact you soon. Thank you - GDB Team",
		)

	def test_the_email_is_optional_but_must_be_one(self):
		self.assertTrue(self.book(email="")["name"])
		with self.assertRaisesRegex(frappe.ValidationError, "valid email"):
			self.book(email="not-an-email")

	def test_the_industry_is_gdbs_own(self):
		with self.assertRaisesRegex(frappe.ValidationError, "industry sector"):
			self.book(industry_sector="Mining")
		with self.assertRaisesRegex(frappe.ValidationError, "industry sector"):
			self.book(industry_sector="")


class TestTheRepresentativesQueue(AppointmentCase):
	def test_a_representative_sees_and_moves_requests_on(self):
		name = self.book()["name"]
		with self.set_user(REP):
			queue = api.appointment_queue(status="New")
			self.assertIn(name, [r.name for r in queue["rows"]])
			row = api.update_appointment(name=name, status="Contacted", note="Called, booked for Tuesday")
		self.assertEqual((row.status, row.handled_by), ("Contacted", REP))

	def test_nobody_else_may_read_the_queue(self):
		with self.set_user("test-gdb-trader@example.gy"), self.assertRaises(frappe.PermissionError):
			api.appointment_queue()

	def test_the_role_is_held_alone_and_opens_the_staff_door(self):
		from gdb_bank.security import role_policy, sign_in_policy

		self.assertIn("GDB Representative", role_policy.GRANTABLE_ROLES)
		self.assertIn("GDB Representative", role_policy.EXCLUSIVE_ROLES)
		self.assertTrue(sign_in_policy.is_staff_account(REP))


class TestTheText(IntegrationTestCase):
	def test_nothing_is_sent_until_twilio_is_set_up(self):
		with patch.dict("os.environ", {"TWILIO_ACCOUNT_SID": "", "TWILIO_AUTH_TOKEN": ""}), patch.object(
			frappe, "enqueue"
		) as enqueue:
			self.assertFalse(sms.send("+5926004321", "Hello"))
		enqueue.assert_not_called()

	def test_a_configured_text_goes_to_the_worker(self):
		env = {"TWILIO_ACCOUNT_SID": "ACx", "TWILIO_AUTH_TOKEN": "t", "TWILIO_MESSAGING_SERVICE_SID": "MGx"}
		with patch.dict("os.environ", env), patch.object(frappe, "enqueue") as enqueue:
			self.assertTrue(sms.send("600 4321", "Hello"))
		self.assertEqual(enqueue.call_args[1]["to"], "+5926004321")


class _Reply:
	def __init__(self, status: int, body: dict):
		self.status_code, self._body = status, body

	def json(self):
		return self._body


ON = {"TWILIO_ACCOUNT_SID": "ACx", "TWILIO_AUTH_TOKEN": "t", "TWILIO_MESSAGING_SERVICE_SID": "MGx"}


class TestDelivery(IntegrationTestCase):
	"""Twilio stubbed at the HTTP call; the outcome lands on the request."""

	def setUp(self):
		super().setUp()
		p = patch.object(frappe.db, "commit")
		p.start()
		self.addCleanup(p.stop)
		self.row = frappe.get_doc(
			{"doctype": "GDB Appointment Request", "first_name": "Nadia", "last_name": "Persaud",
			 "phone": "+5926004321", "status": "New"}
		).insert(ignore_permissions=True)
		self.record = ("GDB Appointment Request", self.row.name)

	def status(self):
		return frappe.db.get_value(*self.record, ["sms_status", "sms_sid", "sms_error"], as_dict=True)

	def test_a_delivered_text_is_recorded_with_its_twilio_id(self):
		with patch.dict("os.environ", ON), patch.object(sms.requests, "post", return_value=_Reply(201, {"sid": "SM123", "status": "queued"})) as post:
			self.assertTrue(sms.deliver("+5926004321", "Hello", record=self.record)["sent"])
		self.assertEqual(post.call_args[1]["data"], {"To": "+5926004321", "Body": "Hello", "MessagingServiceSid": "MGx"})
		self.assertEqual((self.status().sms_status, self.status().sms_sid), ("Sent", "SM123"))

	def test_a_refused_text_is_recorded_with_twilios_reason(self):
		with patch.dict("os.environ", ON), patch.object(sms.requests, "post", return_value=_Reply(400, {"code": 21408, "message": "Permission to send an SMS has not been enabled for the region"})):
			self.assertFalse(sms.deliver("+5926004321", "Hello", record=self.record)["sent"])
		self.assertEqual(self.status().sms_status, "Failed")
		self.assertIn("21408", self.status().sms_error)

	def test_only_guyana_numbers_are_texted(self):
		with patch.dict("os.environ", ON), patch.object(frappe, "enqueue") as enqueue:
			self.assertFalse(sms.send("+1 212 555 0100", "Hello", record=self.record))
		enqueue.assert_not_called()
		self.assertEqual(self.status().sms_status, "No Guyana number")

	def test_without_twilio_the_request_says_so(self):
		with patch.dict("os.environ", {"TWILIO_ACCOUNT_SID": "", "TWILIO_AUTH_TOKEN": ""}):
			self.assertFalse(sms.send("600 4321", "Hello", record=self.record))
		self.assertEqual(self.status().sms_status, "SMS not set up")


class TestDeliveryReports(TestDelivery):
	URL = "https://portal.example.gy/api/method/gdb_bank.integrations.sms.status_callback"

	def signed(self, params: dict) -> str:
		import base64
		import hashlib
		import hmac

		payload = self.URL + "".join(f"{k}{params[k]}" for k in sorted(params))
		return base64.b64encode(hmac.new(b"t", payload.encode(), hashlib.sha1).digest()).decode()

	def report(self, params: dict, signature: str | None):
		env = {**ON, "GDB_PUBLIC_URL": "https://portal.example.gy"}
		frappe.local.form_dict = frappe._dict(params)
		with patch.dict("os.environ", env), patch.object(frappe, "get_request_header", return_value=signature):
			sms.status_callback()

	def test_an_undelivered_report_reaches_the_request(self):
		frappe.db.set_value(*self.record, {"sms_status": "Sent", "sms_sid": "SM9"})
		params = {"MessageSid": "SM9", "MessageStatus": "undelivered", "ErrorCode": "30008"}
		self.report(params, self.signed(params))
		self.assertEqual((self.status().sms_status, self.status().sms_error), ("Undelivered", "Twilio 30008"))

	def test_a_delivered_report_reaches_the_request(self):
		frappe.db.set_value(*self.record, {"sms_status": "Sent", "sms_sid": "SM9"})
		params = {"MessageSid": "SM9", "MessageStatus": "delivered"}
		self.report(params, self.signed(params))
		self.assertEqual(self.status().sms_status, "Delivered")

	def test_an_unsigned_report_changes_nothing(self):
		frappe.db.set_value(*self.record, {"sms_status": "Sent", "sms_sid": "SM9"})
		self.report({"MessageSid": "SM9", "MessageStatus": "delivered"}, "forged")
		self.assertEqual(self.status().sms_status, "Sent")

	def test_the_callback_is_given_to_twilio_with_a_public_address(self):
		env = {**ON, "GDB_PUBLIC_URL": "https://portal.example.gy"}
		with patch.dict("os.environ", env), patch.object(
			sms.requests, "post", return_value=_Reply(201, {"sid": "SM1"})
		) as post:
			sms.deliver("+5926004321", "Hello")
		self.assertEqual(post.call_args[1]["data"]["StatusCallback"], self.URL)
