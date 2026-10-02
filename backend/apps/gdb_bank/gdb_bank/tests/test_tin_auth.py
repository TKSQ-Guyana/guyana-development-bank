"""TIN sign-up and sign-in (gdb_bank/tin_auth.py).

Keycloak is stubbed: these tests are about what the portal decides — the form's
rules, the one-time code, what a completed sign-up creates and that a failed one
leaves nothing behind, and which accounts this door may open. The live realm is
exercised by hand (docker compose) rather than from a unit test.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_tin_auth
"""

import base64
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


TIN = "987654321"
FORM = {
	"first_name": "Test",
	"last_name": "Signup",
	"email": "",
	"phone": "+592 600 4321",
	"tin": TIN,
	"password": "Garden2026",
	"confirm_password": "Garden2026",
	"document_kind": "Passport",
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
		self.assertRefused("identity document", document_kind="Library card")

	def test_the_tin_is_nine_digits_and_may_be_typed_with_dashes(self):
		self.assertRefused("9-digit", tin="12345")
		self.assertEqual(self.request(tin="987-654-321")["phone"], "•••-4321")

	def test_a_tin_already_registered_is_refused(self):
		self.mocks[0].return_value = True
		self.assertRefused("already has an account")

	def test_the_password_rules(self):
		self.assertRefused("8 to 128", password="Short1", confirm_password="Short1")
		self.assertRefused("letter and one number", password="onlyletters", confirm_password="onlyletters")
		self.assertRefused("cannot contain your TIN", password=f"x{TIN}", confirm_password=f"x{TIN}")
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
		self.assertFalse(frappe.db.exists("User", {tin_auth.TIN_FIELD: TIN}))


class TestTheCode(TinCase):
	def test_a_wrong_code_counts_down_and_a_used_code_is_gone(self):
		challenge = self.request()["challenge"]
		with self.assertRaisesRegex(frappe.ValidationError, "4 tries left"):
			tin_auth._redeem(challenge, "000000", tin_auth.SIGNUP)
		self.assertEqual(tin_auth._redeem(challenge, tin_auth._static_otp(), tin_auth.SIGNUP)["tin"], TIN)
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
		challenge = self.request()["challenge"]
		args = {**FORM, "challenge": challenge, "otp": tin_auth._static_otp(), "document_name": "passport.pdf", "document_data": _pdf()}
		args.update(overrides)
		with patch.object(tin_auth, "_sign_in", return_value={"user": "ok"}) as signed_in:
			tin_auth.complete_signup(**args)
		return signed_in

	def test_it_creates_the_citizen_their_document_and_signs_them_in(self):
		signed_in = self.complete()
		user = frappe.db.get_value("User", {tin_auth.TIN_FIELD: TIN}, ["name", "user_type", "first_name", "last_name"], as_dict=True)
		self.assertEqual(user.name, f"{TIN}@{tin_auth.PLACEHOLDER_DOMAIN}")
		self.assertEqual(user.user_type, "Website User")
		self.assertEqual(frappe.get_roles(user.name).count("Citizen"), 1)
		doc = frappe.db.get_value("GDB Applicant Document", {"applicant": user.name}, ["document_type", "file_name", "application"], as_dict=True)
		self.assertEqual(doc.document_type, "Identity")
		self.assertTrue(doc.file_name.startswith("Passport - "))
		self.assertIsNone(doc.application)
		profile = frappe.db.get_value("GDB Citizen Profile", {"user": user.name}, ["date_of_birth", "phone"], as_dict=True)
		self.assertEqual(str(profile.date_of_birth), "1990-05-17")
		signed_in.assert_called_once()

	def test_a_document_that_is_not_a_pdf_is_refused_before_the_code_is_spent(self):
		with self.assertRaisesRegex(frappe.ValidationError, "attach a PDF"):
			self.complete(document_name="passport.png")
		self.mocks[1].assert_not_called()

	def test_a_wrong_code_creates_nothing(self):
		with self.assertRaises(frappe.ValidationError):
			self.complete(otp="000000")
		self.mocks[1].assert_not_called()
		self.assertFalse(frappe.db.exists("User", {tin_auth.TIN_FIELD: TIN}))


class TestWhoThisDoorOpens(IntegrationTestCase):
	def test_never_a_staff_account(self):
		self.assertIsNotNone(sign_in_policy.refusal("Administrator", sign_in_policy.TIN))


REGISTER = [
	{
		"id_number": TIN,
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

	def test_a_known_tin_fills_the_form_with_the_phone_masked(self):
		found = tin_auth.lookup_tin(tin="987-654-321")
		self.assertTrue(found["found"])
		self.assertEqual((found["first_name"], found["last_name"]), ("Testa", "Mc Register"))
		self.assertEqual(found["date_of_birth"], "1989-03-09")
		self.assertTrue(found["region"].startswith("Region 7 "))
		self.assertEqual(found["phone_masked"], "•••-5532")
		# The whole number is never sent to the form.
		self.assertNotIn("6655532", str(found))
		self.assertNotIn("665-5532", str(found))

	def test_an_unknown_or_malformed_tin_finds_nothing(self):
		self.assertEqual(tin_auth.lookup_tin(tin="111222333"), {"found": False})
		self.assertEqual(tin_auth.lookup_tin(tin="12"), {"found": False})

	def test_the_code_goes_to_the_phone_on_record_once_confirmed(self):
		sent = self.request(phone="", use_registry_phone=1)
		self.assertEqual(sent["phone"], "•••-5532")

	def test_without_a_phone_on_record_the_person_must_type_one(self):
		REGISTER_NO_PHONE = [{**REGISTER[0], "cg_contact_number": ""}]
		import json

		with open(frappe.conf["gdb_kyc_registry_path"], "w", encoding="utf-8") as fh:
			json.dump(REGISTER_NO_PHONE, fh)
		with self.assertRaisesRegex(frappe.ValidationError, "no phone on record"):
			self.request(phone="", use_registry_phone=1)

	def test_e_id_is_an_identity_document_and_a_birth_certificate_is_not(self):
		self.assertEqual(self.request(document_kind="e-ID")["phone"], "•••-4321")
		with self.assertRaises(frappe.ValidationError):
			self.request(document_kind="Birth Certificate")
