"""NID sign-up and sign-in (gdb_bank/tin_auth.py).

Keycloak is stubbed: these tests are about what the portal decides — the form's
rules, the one-time code, what a completed sign-up creates and that a failed one
leaves nothing behind, and which accounts this door may open. The live realm is
exercised by hand (docker compose) rather than from a unit test.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_tin_auth
"""

import base64
import re
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import tin_auth
from gdb_bank.security import sign_in_policy


def _pdf() -> str:
	objs = [
		b"<< /Type /Catalog /Pages 2 0 R >>",
		b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
	]
	out, offsets = b"%PDF-1.4\n", []
	for i, obj in enumerate(objs, 1):
		offsets.append(len(out))
		out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
	xref = len(out)
	out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
	out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
	out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
	return base64.b64encode(out).decode()


def _png() -> str:
	"""A real one-pixel PNG."""
	import struct
	import zlib

	def chunk(kind, data):
		return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

	raw = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
	raw += chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b"")
	return base64.b64encode(raw).decode()


NID = "987654321"
FORM = {
	"first_name": "Test",
	"last_name": "Signup",
	"email": "",
	"phone": "+592 600 4321",
	"national_id": NID,
	"password": "Garden2026",
	"confirm_password": "Garden2026",
	"document_kind": "Driver's Licence",
	"document_number": "r 012-3456",
	"date_of_birth": "1990-05-17",
}


class TinCase(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		patches = [
			patch.object(tin_auth.keycloak_admin, "citizen_username_taken", return_value=False),
			patch.object(tin_auth.keycloak_admin, "create_citizen_account", return_value="kc-id"),
			patch.object(tin_auth.keycloak_admin, "delete_citizen_account"),
			patch.object(tin_auth, "_require_door"),
			patch.object(tin_auth.frappe.db, "commit"),
			# The fixed demo code, whatever this machine's SMS settings: the
			# SMS path has its own tests (TestCodesBySms).
			patch.object(tin_auth.sms_otp, "configured", return_value=False),
			# The face check has its own tests below; here it applies to nobody.
			# Kept LAST: those tests reach it as self.mocks[-1].
			patch.object(tin_auth.face_check, "policy", return_value=("skip", None)),
		]
		self.mocks = [p.start() for p in patches]
		for p in patches:
			self.addCleanup(p.stop)

	def request(self, **overrides) -> dict:
		return tin_auth.request_signup_otp(**{**FORM, **overrides})


class TestTheSignupForm(TinCase):
	def assertRefused(self, pattern: str, **overrides):
		with self.assertRaisesRegex(frappe.ValidationError, pattern):
			self.request(**overrides)

	def test_date_of_birth_is_required_and_adult(self):
		self.assertRefused("date of birth", date_of_birth="")
		self.assertRefused("at least 18", date_of_birth=frappe.utils.add_years(frappe.utils.today(), -17))

	def test_names_phone_and_document_are_required(self):
		self.assertRefused("first name", first_name=" ")
		self.assertRefused("last name", last_name="")
		self.assertRefused("valid phone", phone="call me")
		self.assertRefused("number printed on your Driver's Licence", document_number="")
		self.assertRefused("letters and digits only", document_number="R01#3456")
		self.assertRefused("identity document", document_kind="Library card")
		self.assertRefused("identity document", document_kind="Passport")

	def test_the_national_id_is_required_and_may_be_typed_with_dashes(self):
		self.assertRefused("National ID, Passport or E-ID number", national_id="")
		self.assertRefused("National ID, Passport or E-ID number", national_id="12#45")
		self.assertEqual(self.request(national_id="987-654-321")["phone"], "•••-4321")

	def test_a_national_id_card_carries_the_national_id(self):
		self.assertRefused(
			"must match your National ID number", document_kind="National ID Card", document_number="123456780"
		)
		self.assertIn("challenge", self.request(document_kind="National ID Card", document_number=NID))

	def test_a_national_id_already_registered_is_refused(self):
		self.mocks[0].return_value = True
		self.assertRefused("already has an account")

	def test_the_tin_is_optional_but_nine_digits_and_nobody_elses(self):
		self.assertIn("challenge", self.request(tin=""))
		self.assertIn("challenge", self.request(tin="123-456-789"))
		self.assertRefused("9-digit", tin="12345")
		frappe.get_doc(
			{"doctype": "User", "email": "test-gdb-tin-holder@example.gy", "first_name": "Holder", "send_welcome_email": 0}
		).insert(ignore_permissions=True)
		frappe.db.set_value("User", "test-gdb-tin-holder@example.gy", "gdb_tin", "123456789")
		self.assertRefused("already linked", tin="123456789")

	def test_the_password_rules(self):
		self.assertRefused("8 to 128", password="Short1", confirm_password="Short1")
		self.assertRefused("letter and one number", password="onlyletters", confirm_password="onlyletters")
		self.assertRefused("cannot contain your ID number", password=f"x{NID}", confirm_password=f"x{NID}")
		self.assertRefused("do not match", confirm_password="Garden2027")

	def test_email_is_optional_but_must_be_unused(self):
		self.assertIn("challenge", self.request(email=""))
		taken = "test-gdb-tin-taken@example.gy"
		if not frappe.db.exists("User", taken):
			frappe.get_doc({"doctype": "User", "email": taken, "first_name": "Taken", "send_welcome_email": 0}).insert(
				ignore_permissions=True
			)
		self.assertRefused("already uses this email", email=taken)

	def test_asking_for_a_code_creates_nothing(self):
		self.request()
		self.mocks[1].assert_not_called()
		self.assertFalse(frappe.db.exists("User", {tin_auth.NID_FIELD: NID}))


class TestTheCode(TinCase):
	def test_a_wrong_code_counts_down_and_a_used_code_is_gone(self):
		challenge = self.request()["challenge"]
		with self.assertRaisesRegex(frappe.ValidationError, "4 tries left"):
			tin_auth._redeem(challenge, "000000", tin_auth.SIGNUP)
		self.assertEqual(tin_auth._redeem(challenge, tin_auth._static_otp(), tin_auth.SIGNUP)["national_id"], NID)
		with self.assertRaisesRegex(frappe.ValidationError, "expired"):
			tin_auth._redeem(challenge, tin_auth._static_otp(), tin_auth.SIGNUP)

	def test_five_wrong_codes_end_the_challenge(self):
		challenge = self.request()["challenge"]
		for _ in range(tin_auth.OTP_ATTEMPTS):
			with self.assertRaises(frappe.ValidationError):
				tin_auth._redeem(challenge, "000000", tin_auth.SIGNUP)
		with self.assertRaisesRegex(frappe.ValidationError, "Too many|expired"):
			tin_auth._redeem(challenge, tin_auth._static_otp(), tin_auth.SIGNUP)

	def test_a_sign_up_code_cannot_finish_a_sign_in(self):
		challenge = self.request()["challenge"]
		with self.assertRaisesRegex(frappe.ValidationError, "expired"):
			tin_auth._redeem(challenge, tin_auth._static_otp(), tin_auth.LOGIN)


class TestCompletingSignup(TinCase):
	def complete(self, **overrides):
		# The code is requested for the same form the sign-up completes.
		challenge = self.request(**{k: v for k, v in overrides.items() if k in FORM})["challenge"]
		args = {**FORM, "challenge": challenge, "otp": tin_auth._static_otp(), "document_name": "passport.pdf", "document_data": _pdf()}
		args.update(overrides)
		with patch.object(tin_auth, "_sign_in", return_value={"user": "ok"}) as signed_in:
			tin_auth.complete_signup(**args)
		return signed_in

	def test_it_creates_the_citizen_their_document_and_signs_them_in(self):
		signed_in = self.complete()
		user = frappe.db.get_value("User", {tin_auth.NID_FIELD: NID}, ["name", "user_type", "first_name", "last_name"], as_dict=True)
		self.assertEqual(user.name, f"{NID}@{tin_auth.PLACEHOLDER_DOMAIN}")
		self.assertEqual(user.user_type, "Website User")
		self.assertEqual(frappe.get_roles(user.name).count("Citizen"), 1)
		doc = frappe.db.get_value(
			"GDB Applicant Document",
			{"applicant": user.name},
			["document_type", "file_name", "application", "id_document_kind", "id_document_number"],
			as_dict=True,
		)
		self.assertEqual(doc.document_type, "Identity")
		# The number typed from the document, kept for the officer to check.
		self.assertEqual((doc.id_document_kind, doc.id_document_number), ("Driver's Licence", "R0123456"))
		self.assertTrue(doc.file_name.startswith("Driver's Licence - "))
		self.assertIsNone(doc.application)
		profile = frappe.db.get_value("GDB Citizen Profile", {"user": user.name}, ["date_of_birth", "phone"], as_dict=True)
		self.assertEqual(str(profile.date_of_birth), "1990-05-17")
		signed_in.assert_called_once()

	def test_no_identity_document_is_needed(self):
		# Its own National ID and phone: this class's tests share one transaction.
		nid, phone = "987654323", "+592 600 4323"
		bare = {k: v for k, v in FORM.items() if k not in ("document_kind", "document_number")}
		challenge = tin_auth.request_signup_otp(**{**bare, "national_id": nid, "phone": phone})["challenge"]
		with patch.object(tin_auth, "_sign_in", return_value={"user": "ok"}):
			tin_auth.complete_signup(**{**bare, "national_id": nid, "phone": phone, "challenge": challenge, "otp": tin_auth._static_otp()})
		user = frappe.db.get_value("User", {tin_auth.NID_FIELD: nid})
		self.assertTrue(user)
		self.assertFalse(frappe.db.exists("GDB Applicant Document", {"applicant": user}))

	def test_appointment_request_needs_a_name_and_a_number(self):
		with self.assertRaisesRegex(frappe.ValidationError, "first name"):
			tin_auth.request_appointment(first_name="", last_name="Persaud", phone="6001234")
		with self.assertRaisesRegex(frappe.ValidationError, "valid phone"):
			tin_auth.request_appointment(first_name="Asha", last_name="Persaud", phone="call me")
		name = tin_auth.request_appointment(first_name="Asha", last_name="Persaud", phone="+592 600 1234", reason="No National ID")["name"]
		row = frappe.db.get_value("GDB Appointment Request", name, ["first_name", "phone", "reason", "status"], as_dict=True)
		self.assertEqual((row.first_name, row.reason, row.status), ("Asha", "No National ID", "New"))

	def test_a_photo_of_the_document_is_accepted(self):
		# Its own NID: this class's tests share one transaction, and the others
		# expect NID to be unused until test_it_creates_... makes it.
		self.complete(national_id="987654322", phone="+592 600 4322", document_name="national-id.png", document_data=_png())
		user = frappe.db.get_value("User", {tin_auth.NID_FIELD: "987654322"})
		doc = frappe.db.get_value("GDB Applicant Document", {"applicant": user}, "file_name")
		self.assertTrue(doc.endswith("national-id.png"))

	def test_a_document_that_is_neither_pdf_nor_photo_is_refused_before_the_code_is_spent(self):
		with self.assertRaisesRegex(frappe.ValidationError, "attach a PDF or a photo"):
			self.complete(document_name="passport.docx")
		self.mocks[1].assert_not_called()

	def test_a_file_renamed_to_look_like_a_photo_is_refused(self):
		# PDF bytes under a .png name: the contents decide, not the name.
		with self.assertRaisesRegex(frappe.ValidationError, "not a real PNG"):
			self.complete(document_name="passport.png")
		self.mocks[1].assert_not_called()

	def test_a_wrong_code_creates_nothing(self):
		with self.assertRaises(frappe.ValidationError):
			self.complete(otp="000000")
		self.mocks[1].assert_not_called()
		self.assertFalse(frappe.db.exists("User", {tin_auth.NID_FIELD: NID}))


class TestWhoThisDoorOpens(IntegrationTestCase):
	def test_never_a_staff_account(self):
		self.assertIsNotNone(sign_in_policy.refusal("Administrator", sign_in_policy.TIN))


REGISTER = [
	{
		"id_number": NID,
		"forenames": "TESTA",
		"surname": "MC REGISTER",
		"date_of_birth": "3/9/1989",
		"sex": "Female",
		"contact_number": "",
		"cg_contact_number": "665-5532",
		"region": "Region 07",
		"village_name": "KAMARANG/WARAWATTA",
		"lot_street": "12",
		"street": "",
		"address": "Half Mile Wismar",
	}
]


class TestTheKycRegister(TinCase):
	"""Sign-up fills itself from the KYC register — and never shows the phone."""

	def setUp(self):
		super().setUp()
		import json
		import tempfile

		fh = tempfile.NamedTemporaryFile("w", suffix=".local", delete=False, encoding="utf-8")
		json.dump(REGISTER, fh)
		fh.close()
		self.addCleanup(lambda: __import__("os").remove(fh.name))
		conf = patch.dict(frappe.conf, {"gdb_kyc_registry_path": fh.name})
		conf.start()
		self.addCleanup(conf.stop)
		# These tests own their register: the file above, not the GDB KYC
		# Records the site happens to hold.
		records = patch.object(tin_auth.kyc_registry, "_from_erpnext", return_value=False)
		records.start()
		self.addCleanup(records.stop)

	def test_a_known_tin_fills_the_form_with_the_phone_masked(self):
		found = tin_auth.lookup_national_id(national_id="987-654-321")
		self.assertTrue(found["found"])
		self.assertEqual((found["first_name"], found["last_name"]), ("Testa", "Mc Register"))
		self.assertEqual(found["date_of_birth"], "1989-03-09")
		self.assertTrue(found["region"].startswith("Region 7 "))
		self.assertEqual(found["phone_masked"], "•••-5532")
		# The whole number is never sent to the form.
		self.assertNotIn("6655532", str(found))
		self.assertNotIn("665-5532", str(found))

	def test_an_unknown_or_malformed_tin_finds_nothing(self):
		self.assertEqual(tin_auth.lookup_national_id(national_id="111222333"), {"found": False})
		self.assertEqual(tin_auth.lookup_national_id(national_id="12"), {"found": False})

	def test_the_code_goes_to_the_phone_on_record_once_confirmed(self):
		sent = self.request(phone="", use_registry_phone=1)
		self.assertEqual(sent["phone"], "•••-5532")

	def test_a_different_number_cannot_be_used_when_one_is_on_record(self):
		# Changing the number on record is done in person, with a Field Officer.
		for phone in ("+592 600 4321", "+592 665 5532", ""):
			with self.assertRaisesRegex(frappe.ValidationError, "visit a GDB Field Officer"):
				self.request(phone=phone, use_registry_phone=0)

	def test_without_a_phone_on_record_the_person_must_type_one(self):
		REGISTER_NO_PHONE = [{**REGISTER[0], "cg_contact_number": ""}]
		import json

		with open(frappe.conf["gdb_kyc_registry_path"], "w", encoding="utf-8") as fh:
			json.dump(REGISTER_NO_PHONE, fh)
		with self.assertRaisesRegex(frappe.ValidationError, "no phone on record"):
			self.request(phone="", use_registry_phone=1)

	def test_e_id_is_an_identity_document_and_a_birth_certificate_is_not(self):
		self.assertEqual(self.request(document_kind="e-ID", document_number="59220010101", phone="", use_registry_phone=1)["phone"], "•••-5532")
		with self.assertRaises(frappe.ValidationError):
			self.request(document_kind="Birth Certificate")


class TestTheRegisterInErpnext(TinCase):
	def test_a_loaded_record_is_what_sign_up_reads(self):
		from gdb_bank.integrations import kyc_registry

		kyc_registry.import_rows(
			[
				{
					"profile_id": "TEST-KYC-1",
					"surname": "LOADED",
					"forenames": "ROW",
					"id_number": "555-444-333",
					"date_of_birth": "12/30/1991",
					"cg_contact_number": "6815150",
					"region": "Region 04",
					"village_name": "PARADISE",
				}
			]
		)
		found = tin_auth.lookup_national_id(national_id="555444333")
		self.assertEqual((found["first_name"], found["last_name"]), ("Row", "Loaded"))
		self.assertEqual(found["date_of_birth"], "1991-12-30")
		self.assertEqual(found["phone_masked"], "•••-5150")

	def test_loading_a_row_again_updates_it(self):
		from gdb_bank.integrations import kyc_registry

		row = {"profile_id": "TEST-KYC-2", "surname": "ONCE", "forenames": "A", "id_number": "555444334"}
		self.assertEqual(kyc_registry.import_rows([row])["created"], ["TEST-KYC-2"])
		self.assertEqual(kyc_registry.import_rows([{**row, "surname": "TWICE"}])["updated"], ["TEST-KYC-2"])
		self.assertEqual(frappe.db.get_value("GDB KYC Record", "TEST-KYC-2", "surname"), "TWICE")


class TestTheFaceCheck(TinCase):
	"""Before the code: the person on camera, alive, and the person on record.
	The face service is stubbed — these are the backend's rules around it."""

	def setUp(self):
		super().setUp()
		from gdb_bank import face_check

		self.face = face_check
		self.mocks[-1].return_value = ("check", "CG-KYC-P-TEST")  # a photo on record applies
		self.addCleanup(lambda: frappe.cache.delete_value(f"gdb:face:attempts:{NID}"))
		self.verdict = {"decision": "pass", "match": 0.62, "same_person": 0.8, "reasons": []}
		calls = patch.object(face_check, "_call", side_effect=lambda path, payload, **kw: self.verdict)
		self.call = calls.start()
		self.addCleanup(calls.stop)

	def frames(self, steps):
		return [{"step": s, "image": "aGVsbG8="} for s in steps]

	def test_the_prompts_are_center_then_three_random_challenges(self):
		started = tin_auth.start_face_check(national_id=NID)
		self.assertTrue(started["required"])
		self.assertEqual(started["steps"][0], "center")
		challenges = started["steps"][1:]
		self.assertEqual(len(challenges), 3)
		self.assertEqual(len(set(challenges)), 3)
		self.assertTrue(set(challenges) <= {"left", "right", "up", "blink"})

	def test_no_code_is_sent_without_a_passed_check(self):
		with self.assertRaisesRegex(frappe.ValidationError, "face check"):
			self.request()

	def test_a_pass_unlocks_the_code_for_that_tin_only(self):
		started = tin_auth.start_face_check(national_id=NID)
		passed = tin_auth.submit_face_check(check=started["check"], frames=self.frames(started["steps"]))
		self.assertTrue(passed["passed"])
		self.assertEqual(self.request(face_token=passed["face_token"])["phone"], "•••-4321")
		with self.assertRaisesRegex(frappe.ValidationError, "face check"):
			self.request(national_id="123456780", face_token=passed["face_token"])

	def test_a_failure_says_why_and_counts_down(self):
		self.verdict = {"decision": "fail", "match": 0.12, "reasons": ["does_not_match_record"]}
		started = tin_auth.start_face_check(national_id=NID)
		failed = tin_auth.submit_face_check(check=started["check"], frames=self.frames(started["steps"]))
		self.assertFalse(failed["passed"])
		self.assertIn("photo GDB has on record", failed["messages"][0])
		self.assertEqual(failed["attempts_left"], 2)

	def test_a_borderline_score_is_not_a_pass(self):
		self.verdict = {"decision": "review", "match": 0.35, "reasons": ["borderline_match"]}
		started = tin_auth.start_face_check(national_id=NID)
		self.assertFalse(tin_auth.submit_face_check(check=started["check"], frames=self.frames(started["steps"]))["passed"])

	def test_after_three_attempts_it_sends_the_person_to_a_branch(self):
		self.verdict = {"decision": "fail", "reasons": ["head_turn_not_seen"]}
		for _ in range(3):
			started = tin_auth.start_face_check(national_id=NID)
			tin_auth.submit_face_check(check=started["check"], frames=self.frames(started["steps"]))
		with self.assertRaisesRegex(frappe.ValidationError, "branch"):
			tin_auth.start_face_check(national_id=NID)

	def test_a_check_is_used_once(self):
		started = tin_auth.start_face_check(national_id=NID)
		tin_auth.submit_face_check(check=started["check"], frames=self.frames(started["steps"]))
		with self.assertRaisesRegex(frappe.ValidationError, "expired"):
			tin_auth.submit_face_check(check=started["check"], frames=self.frames(started["steps"]))

	def test_a_tin_not_on_the_register_is_not_asked(self):
		self.mocks[-1].return_value = ("skip", None)
		self.assertEqual(tin_auth.start_face_check(national_id=NID), {"required": False})
		self.assertEqual(self.request()["phone"], "•••-4321")

	def test_on_the_register_without_a_photo_there_is_no_online_sign_up(self):
		# GDB, 2026-10-03: nothing to check the face against -> a branch or a field officer.
		self.mocks[-1].return_value = ("blocked", None)
		with self.assertRaisesRegex(frappe.ValidationError, "branch"):
			tin_auth.start_face_check(national_id=NID)
		with self.assertRaisesRegex(frappe.ValidationError, "branch"):
			self.request()


class _Reply:
	def __init__(self, status: int, body: dict):
		self.status_code, self._body = status, body

	def json(self):
		return self._body


class TestCodesBySms(TinCase):
	"""Codes sent through Infobip, stubbed at the HTTP call."""

	def setUp(self):
		super().setUp()
		self.mocks[-2].return_value = True  # sms_otp.configured
		env = patch.dict(
			"os.environ",
			{"INFOBIP_BASE_URL": "https://x.api.infobip.com", "INFOBIP_API_KEY": "k", "INFOBIP_SENDER": "GDB"},
		)
		env.start()
		self.addCleanup(env.stop)
		self.post = patch.object(tin_auth.sms_otp.sms.requests, "post").start()
		self.post.return_value = _Reply(200, {"messages": [{"messageId": "M1", "status": {"groupName": "PENDING"}}]})
		self.addCleanup(patch.stopall)

	def sent_code(self) -> str:
		text = self.post.call_args[1]["json"]["messages"][0]["content"]["text"]
		return re.search(r"code is (\d{6})", text).group(1)

	def test_the_code_is_sent_to_the_phone_and_never_shown(self):
		out = self.request()
		self.assertFalse(out["static_code"])
		self.assertNotIn("demo_code", out)
		message = self.post.call_args[1]["json"]["messages"][0]
		self.assertEqual(message["destinations"], [{"to": "5926004321"}])
		# Only a hash of the code is kept.
		held = frappe.cache.get_value(tin_auth._key(out["challenge"]))
		self.assertNotIn(self.sent_code(), str(held))

	def test_only_the_sent_code_is_right(self):
		challenge = self.request()["challenge"]
		with self.assertRaisesRegex(frappe.ValidationError, "4 tries left"):
			tin_auth._redeem(challenge, "000000" if self.sent_code() != "000000" else "111111", tin_auth.SIGNUP)
		# The demo code means nothing once codes are sent.
		if tin_auth._static_otp() != self.sent_code():
			with self.assertRaisesRegex(frappe.ValidationError, "3 tries left"):
				tin_auth._redeem(challenge, tin_auth._static_otp(), tin_auth.SIGNUP)
		self.assertEqual(tin_auth._redeem(challenge, self.sent_code(), tin_auth.SIGNUP)["national_id"], NID)

	def test_a_refused_send_says_why_and_opens_no_challenge(self):
		self.post.return_value = _Reply(
			200, {"messages": [{"status": {"groupName": "REJECTED", "name": "REJECTED_DESTINATION"}}]}
		)
		with self.assertRaisesRegex(frappe.ValidationError, "cannot receive text messages"):
			self.request()

	def test_an_unreachable_infobip_is_a_plain_message(self):
		self.post.side_effect = tin_auth.sms_otp.sms.requests.ConnectionError("down")
		with self.assertRaisesRegex(frappe.ValidationError, "could not send your code"):
			self.request()


class TestTheCodeSwitch(IntegrationTestCase):
	"""Codes are texted once Infobip is set up, unless GDB_SMS_OTP=0."""

	INFOBIP = {"INFOBIP_BASE_URL": "https://x.api.infobip.com", "INFOBIP_API_KEY": "k", "INFOBIP_SENDER": "GDB"}

	def test_codes_follow_infobip_and_the_switch(self):
		from gdb_bank.integrations import sms_otp

		with patch.dict("os.environ", {**self.INFOBIP, "GDB_SMS_OTP": ""}):
			self.assertTrue(sms_otp.configured())
		with patch.dict("os.environ", {**self.INFOBIP, "GDB_SMS_OTP": "0"}):
			self.assertFalse(sms_otp.configured())
		with patch.dict("os.environ", {**self.INFOBIP, "INFOBIP_API_KEY": "", "GDB_SMS_OTP": ""}):
			self.assertFalse(sms_otp.configured())


class TestAgeLimits(TinCase):
	def test_an_applicant_over_60_is_refused(self):
		from frappe.utils import add_years, today

		with self.assertRaisesRegex(frappe.ValidationError, "between 18 and 60"):
			self.request(date_of_birth=str(add_years(today(), -62)))
