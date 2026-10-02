"""Field Officer: assist requests, the assisted application, field tasks, and
documents staged on an applicant's behalf.

Every test acts through the portal's own endpoints as the person acting, and
reads the outcome back through another endpoint. The endpoints commit, so
commit is suppressed and each test is rolled back: nothing stays on the site.

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_field_flow
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import api, documents, field_officer, profiles
from gdb_bank.security import role_policy

OFFICER = "test-gdb-fo@example.gy"
FAR_OFFICER = "test-gdb-fo-far@example.gy"
UNDERWRITER = "test-gdb-fo-underwriter@example.gy"
CITIZEN = "test-gdb-fo-citizen@example.gy"
CITIZEN_EID = "592-9200-0001"

REGION = "Region 4 — Demerara-Mahaica"
FAR_REGION = "Region 9 — Upper Takutu-Upper Essequibo"



def _user(email: str, *roles: str, first_name: str | None = None) -> None:
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": first_name or email.split("@")[0].removeprefix("test-gdb-").title(),
			"send_welcome_email": 0,
			"roles": [{"role": role} for role in roles],
		}
	).insert(ignore_permissions=True)


class TestFieldFlow(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(patch.object(frappe.local.db, "commit"))
		self.addCleanup(frappe.db.rollback)

		_user(CITIZEN, "Citizen", first_name="Jane Doe")
		frappe.db.set_value("User", CITIZEN, "gdb_eid", CITIZEN_EID)
		_user(OFFICER, "Field Officer")
		frappe.db.set_value("User", OFFICER, "gdb_region", REGION)
		_user(FAR_OFFICER, "Field Officer")
		frappe.db.set_value("User", FAR_OFFICER, "gdb_region", FAR_REGION)
		_user(UNDERWRITER, "Loan Underwriter")
		with self.set_user(CITIZEN):
			profiles.save_profile(region="Region 4", phone="600 1234", address="12 Main St")

	# -- helpers ---------------------------------------------------------------

	def granted(self) -> str:
		with self.set_user(OFFICER):
			consent = field_officer.request_assist_consent(eid=CITIZEN_EID)["name"]
		with self.set_user(CITIZEN):
			field_officer.respond_to_assist_consent(name=consent, accept=1)
		return consent

	def submitted_case(self) -> str:
		with self.set_user(CITIZEN):
			name = api.save_application(
				loan_amount=500000, purpose="New oven", term_months=12, sections={"moratorium_months": 1}
			)["name"]
			api.submit_application(name=name)
		return name

	# -- the role --------------------------------------------------------------

	def test_field_officer_is_held_alone(self):
		self.assertIsNotNone(role_policy.refusal_to_combine(["Field Officer", "Loan Underwriter"]))
		self.assertIsNone(role_policy.refusal_to_combine(["Field Officer"]))

	def test_whoami_says_field_officer(self):
		with self.set_user(OFFICER):
			me = api.whoami()
		self.assertTrue(me["is_field_officer"])
		self.assertFalse(me["is_underwriter"])

	# -- W2 assist requests ----------------------------------------------------

	def test_assist_request_reaches_only_its_regions_pool(self):
		with self.set_user(CITIZEN):
			req = api.request_field_officer(
				applicant_name="Jane Doe", phone="600 1234", business_type="Retail", region="Region 4", product="Standard"
			)["name"]
		with self.set_user(OFFICER):
			desk = field_officer.desk(tab="assist")
			self.assertIn(req, [r["name"] for r in desk["rows"]])
			self.assertGreaterEqual(desk["counts"]["assist"], 1)
			self.assertIsNone(field_officer.assist_request(name=req)["phone"])  # not until taken
		with self.set_user(FAR_OFFICER):
			self.assertNotIn(req, [r["name"] for r in field_officer.desk(tab="assist")["rows"]])
			with self.assertRaises(frappe.PermissionError):
				field_officer.accept_assist_request(name=req)

	def test_assist_request_is_taken_called_and_closed(self):
		with self.set_user(CITIZEN):
			req = api.request_field_officer(
				applicant_name="Jane Doe", phone="600 1234", business_type="Retail", region="Region 4"
			)["name"]
		with self.set_user(OFFICER):
			taken = field_officer.accept_assist_request(name=req)
			self.assertEqual(taken["status"], "Accepted")
			self.assertEqual(taken["phone"], "600 1234")
			with self.assertRaises(frappe.ValidationError):
				field_officer.set_assist_outcome(name=req, outcome="Couldn't reach")
			field_officer.log_contact_attempt(name=req, result="No answer")
			done = field_officer.set_assist_outcome(name=req, outcome="Couldn't reach", note="Three tries")
		self.assertEqual(done["status"], "Couldn't reach")
		self.assertEqual(len(done["attempts"]), 1)
		with self.set_user(FAR_OFFICER), self.assertRaises(frappe.PermissionError):
			field_officer.log_contact_attempt(name=req, result="Reached")

	# -- W3 the assisted application -------------------------------------------

	def test_lookup_gives_a_partial_name_and_nothing_else(self):
		with self.set_user(OFFICER):
			found = field_officer.find_applicant(eid=CITIZEN_EID)
		self.assertEqual(found["masked_name"], "Jane D.")
		self.assertEqual(set(found), {"eid", "registered", "masked_name", "is_you"})

	def test_no_record_is_read_before_the_applicant_says_yes(self):
		with self.set_user(OFFICER):
			consent = field_officer.request_assist_consent(eid=CITIZEN_EID)["name"]
			with self.assertRaises(frappe.PermissionError):
				profiles.my_profile(acting=consent)
			self.assertEqual(field_officer.assist_consent(name=consent)["drafts"], [])
		with self.set_user(CITIZEN):
			self.assertEqual(field_officer.my_assist_consents()[0]["status"], "Pending")
			field_officer.respond_to_assist_consent(name=consent, accept=0)
		with self.set_user(OFFICER), self.assertRaises(frappe.PermissionError):
			profiles.my_profile(acting=consent)

	def test_officer_fills_the_draft_and_the_applicant_submits_it(self):
		consent = self.granted()
		with self.set_user(OFFICER):
			self.assertEqual(profiles.my_profile(acting=consent)["user"], CITIZEN)
			draft = api.save_application(
				loan_amount=400000, purpose="Stock", term_months=12, sections={"moratorium_months": 1}, acting=consent
			)
			self.assertEqual(draft["applicant"], CITIZEN)
			self.assertEqual(draft["assisted_by"], OFFICER)
			# The officer cannot put it before the Bank.
			with self.assertRaises(frappe.PermissionError):
				api.submit_application(name=draft["name"])
			field_officer.hand_off_application(consent=consent, name=draft["name"])
			# Handing it back ends the officer's access.
			with self.assertRaises(frappe.PermissionError):
				api.loan_detail(name=draft["name"], acting=consent)
			row = next(r for r in field_officer.desk(tab="assisted")["rows"] if r["name"] == consent)
			self.assertEqual(row["status"], "Waiting for applicant")
		with self.set_user(CITIZEN):
			mine = api.loan_detail(name=draft["name"])
			self.assertEqual(mine["stage_label"], "Ready for you to check and submit")
			self.assertEqual(api.submit_application(name=draft["name"])["status"], "Submitted")

	def test_officer_submits_for_the_applicant_and_they_are_told(self):
		consent = self.granted()
		with self.set_user(OFFICER):
			draft = api.save_application(
				loan_amount=300000, purpose="Oven", term_months=12, sections={"moratorium_months": 1}, acting=consent
			)["name"]
			case = field_officer.submit_assisted_application(consent=consent, name=draft)
			self.assertEqual(case["status"], "Submitted")
			self.assertEqual(case["submitted_by"], OFFICER)
			# The consent ended with the submission.
			with self.assertRaises(frappe.PermissionError):
				api.loan_detail(name=draft, acting=consent)
			row = next(r for r in field_officer.desk(tab="assisted")["rows"] if r["name"] == consent)
			self.assertEqual(row["status"], "Submitted")
		with self.set_user(CITIZEN):
			mine = api.loan_detail(name=draft)
			self.assertEqual(mine["submitted_by"], OFFICER)
			inbox = frappe.get_list("Notification Log", fields=["subject", "link"])
		self.assertIn(f"/loans/{draft}", [n.link for n in inbox])

	def test_officer_cannot_change_what_the_applicant_declared(self):
		consent = self.granted()
		with self.set_user(OFFICER):
			profiles.save_profile(acting=consent, occupation="Baker")  # was blank: may fill
			with self.assertRaises(frappe.PermissionError):
				profiles.save_profile(acting=consent, phone="600 9999")

	def test_officer_cannot_assist_themselves(self):
		frappe.db.set_value("User", OFFICER, "gdb_staff_eid", CITIZEN_EID)
		with self.set_user(OFFICER), self.assertRaises(frappe.PermissionError):
			field_officer.request_assist_consent(eid=CITIZEN_EID)

	# -- W4 field tasks ----------------------------------------------------------

	def test_reference_check_is_raised_taken_and_reported(self):
		case = self.submitted_case()
		with self.set_user(UNDERWRITER):
			task = field_officer.request_field_task(
				application=case, kind="Reference Check", instructions="Call two suppliers"
			)["name"]
		with self.set_user(FAR_OFFICER), self.assertRaises(frappe.PermissionError):
			field_officer.accept_field_task(name=task)
		with self.set_user(OFFICER):
			pool = field_officer.field_task(name=task)
			self.assertIsNone(pool["address"])  # not until taken
			field_officer.accept_field_task(name=task)
			one_call = {"reference_calls": [{"contact_name": "A Supplier", "result": "Reached", "verdict": "Positive"}]}
			with self.assertRaises(frappe.ValidationError):
				field_officer.submit_field_report(name=task, report=one_call)
			report = {
				"reference_calls": [
					*one_call["reference_calls"],
					{"contact_name": "B Neighbour", "result": "No answer"},
				]
			}
			self.assertEqual(field_officer.submit_field_report(name=task, report=report)["status"], "Submitted")
			view = field_officer.case_view(application=case)
			self.assertIn("Reference Check report filed", [e["what"] for e in view["history"]])
		with self.set_user(UNDERWRITER):
			self.assertEqual(field_officer.field_tasks_for(application=case)[0]["status"], "Submitted")
		with self.set_user(FAR_OFFICER), self.assertRaises(frappe.PermissionError):
			field_officer.case_view(application=case)

	def test_site_visit_needs_checks_pin_photo_and_notes(self):
		case = self.submitted_case()
		with self.set_user(UNDERWRITER):
			task = field_officer.request_field_task(application=case, kind="Site Visit", instructions="See the bakery")
		self.assertEqual(task["region"], REGION)
		self.assertEqual(len(task["checks"]), 5)
		with self.set_user(OFFICER):
			field_officer.accept_field_task(name=task["name"])
			frappe.get_doc("GDB Field Task", task["name"]).check_permission("write")
			report = {
				"checks": [{"item": c["item"], "result": "Yes"} for c in task["checks"]],
				"latitude": 6.80,
				"longitude": -58.15,
				"findings": "Trading as described",
			}
			with self.assertRaises(frappe.ValidationError):  # no photo yet
				field_officer.submit_field_report(name=task["name"], report=report)
			frappe.get_doc(
				{
					"doctype": "File",
					"file_name": "shop.png",
					"content": _png(),
					"attached_to_doctype": "GDB Field Task",
					"attached_to_name": task["name"],
					"is_private": 1,
				}
			).insert(ignore_permissions=True)
			done = field_officer.submit_field_report(name=task["name"], report=report)
		self.assertEqual(done["status"], "Submitted")
		self.assertEqual(len(done["photos"]), 1)

	# -- W5 documents on behalf ---------------------------------------------------

	def test_officer_stages_a_reply_and_only_the_applicant_sends_it(self):
		case = self.submitted_case()
		with self.set_user(UNDERWRITER):
			ask = documents.request_information(application=case, item="Last month's bank statement")["name"]
		consent = self.granted()
		with self.set_user(OFFICER):
			row = documents.new_document(
				document_type="Bank Statement", application=case, request=ask, acting=consent
			)
			self.assertEqual(row["uploaded_by"], OFFICER)
			# What upload_file asks before it accepts a file against the row.
			frappe.get_doc(documents.DOCTYPE, row["name"]).check_permission("write")
			frappe.get_doc(
				{
					"doctype": "File",
					"file_name": "statement.pdf",
					"content": _pdf(),
					"attached_to_doctype": documents.DOCTYPE,
					"attached_to_name": row["name"],
					"is_private": 1,
				}
			).insert(ignore_permissions=True)
			with self.assertRaises(frappe.PermissionError):
				documents.confirm_document(name=row["name"], acting=consent)
		with self.set_user(CITIZEN):
			staged = documents.list_requests(application=case)["requests"][0]["staged"]
			self.assertEqual(staged["name"], row["name"])
			documents.confirm_document(name=row["name"])
			self.assertEqual(documents.list_requests(application=case)["open"], 0)


def _png() -> bytes:
	from io import BytesIO

	from PIL import Image

	out = BytesIO()
	Image.new("RGB", (4, 4), (0, 128, 0)).save(out, format="PNG")
	return out.getvalue()


def _pdf() -> bytes:
	from io import BytesIO

	from pypdf import PdfWriter

	writer, out = PdfWriter(), BytesIO()
	writer.add_blank_page(width=72, height=72)
	writer.write(out)
	return out.getvalue()
