"""The loan officer's checklist before disbursement (services/checklist.py).

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_checklist
"""

from unittest.mock import patch

import frappe

from gdb_bank import api, documents
from gdb_bank.services import checklist
from gdb_bank.tests.test_quick_loan import DISBURSER, TRADER, UNDERWRITER, RoadToPayment

# Captured before any test stands the gate aside (RoadToPayment.setUp does).
REAL_REQUIRE_READY = checklist.require_ready


class TestTheLoanOfficersChecklist(RoadToPayment):
	def setUp(self):
		super().setUp()
		# Signed up by National ID, so no e-ID yet — the case the checklist is for.
		frappe.db.set_value("User", TRADER, "gdb_eid", None)

	def items(self, application: str) -> dict:
		with self.set_user(UNDERWRITER):
			result = api.loan_checklist(application=application)
		return {i["key"]: i for i in result["items"]} | {"_ready": result["ready"], "_outstanding": result["outstanding"]}

	def payslip(self, status: str = "Received") -> str:
		return frappe.get_doc(
			{
				"doctype": "GDB Applicant Document",
				"applicant": TRADER,
				"applicant_name": "Trader",
				"document_type": "Payslip",
				"status": status,
				"file_url": "/private/files/payslip.pdf",
				"file_name": "payslip.pdf",
			}
		).insert(ignore_permissions=True).name

	def book(self, application: str):
		with patch("gdb_bank.services.checklist.require_ready", REAL_REQUIRE_READY), self.set_user(DISBURSER):
			return api.book_loan(application=application)

	def test_a_new_case_shows_what_is_missing(self):
		name, _offer = self.signed()
		got = self.items(name)
		self.assertEqual(got["bank_account"]["status"], "ok")
		for key in ("eid", "national_id", "payslip"):
			self.assertEqual(got[key]["status"], "missing", key)
		self.assertFalse(got["_ready"])
		self.assertEqual(got["_outstanding"], ["e-ID", "National ID", "Payslip"])

	def test_the_disbursement_officer_cannot_book_until_it_is_done(self):
		name, _offer = self.signed()
		with self.assertRaisesRegex(frappe.ValidationError, "checklist is not complete.*National ID"):
			self.book(name)

	def test_an_e_id_asked_for_does_not_hold_the_case_back(self):
		name, _offer = self.signed()
		with self.set_user(UNDERWRITER):
			documents.request_information(application=name, item=checklist.ASK["eid"][1], document_type="e-ID")
		got = self.items(name)
		self.assertEqual(got["eid"]["status"], "requested")
		self.assertFalse(got["eid"]["blocking"])
		self.assertNotIn("e-ID", got["_outstanding"])

	def test_a_national_id_or_bank_account_asked_for_still_holds_it_back(self):
		name, _offer = self.signed()
		with self.set_user(UNDERWRITER):
			documents.request_information(application=name, item=checklist.ASK["national_id"][1])
		got = self.items(name)
		self.assertEqual(got["national_id"]["status"], "requested")
		self.assertTrue(got["national_id"]["blocking"])

	def test_a_rejected_payslip_does_not_count(self):
		name, _offer = self.signed()
		self.payslip(status="Rejected")
		self.assertEqual(self.items(name)["payslip"]["status"], "missing")

	def test_once_everything_is_in_place_the_case_books(self):
		name, _offer = self.signed()
		frappe.db.set_value("User", TRADER, "gdb_national_id", "900100555")
		self.payslip()
		with self.set_user(UNDERWRITER):
			documents.request_information(application=name, item=checklist.ASK["eid"][1], document_type="e-ID")
		self.assertTrue(self.items(name)["_ready"])
		self.assertTrue(self.book(name)["loan"])

	def approve(self, application: str):
		with patch("gdb_bank.services.checklist.require_ready", REAL_REQUIRE_READY), self.set_user(UNDERWRITER):
			return api.review_loan(name=application, action="approve", remarks="Checked")

	def test_the_loan_officer_cannot_approve_until_it_is_done(self):
		name = self.submitted()
		with self.assertRaisesRegex(frappe.ValidationError, "checklist is not complete"):
			self.approve(name)
		self.assertEqual(frappe.db.get_value("Loan Application", name, "status"), "Open")
		frappe.db.set_value("User", TRADER, "gdb_national_id", "900100555")
		self.payslip()
		with self.set_user(UNDERWRITER):
			documents.request_information(application=name, item=checklist.ASK["eid"][1], document_type="e-ID")
		self.approve(name)
		self.assertEqual(frappe.db.get_value("Loan Application", name, "status"), "Approved")

	def test_declining_needs_no_checklist(self):
		name = self.submitted()
		with patch("gdb_bank.services.checklist.require_ready", REAL_REQUIRE_READY), self.set_user(UNDERWRITER):
			api.review_loan(name=name, action="reject", remarks="Not trading")
		self.assertEqual(frappe.db.get_value("Loan Application", name, "status"), "Rejected")

	def test_the_applicant_sees_what_was_asked_on_their_dashboard(self):
		name, _offer = self.signed()
		with self.set_user(UNDERWRITER):
			documents.request_information(application=name, item=checklist.ASK["payslip"][1], document_type="Payslip")
		with self.set_user(TRADER):
			mine = api.my_requests()
		self.assertEqual([(r.application, r.document_type) for r in mine["information"]], [(name, "Payslip")])
		with self.set_user(DISBURSER):
			self.assertEqual(api.my_requests()["information"], [])

	def test_an_sme_loan_does_not_need_an_e_id(self):
		name, _offer = self.signed()
		from gdb_bank.utils.constants import PORTAL_PRODUCTS, STANDARD_PRODUCT

		sme = frappe.db.get_value("Loan Product", {"product_name": PORTAL_PRODUCTS[STANDARD_PRODUCT]})
		self.assertTrue(sme)
		frappe.db.set_value("Loan Application", name, "loan_product", sme)
		frappe.db.set_value("User", TRADER, "gdb_national_id", "900100555")
		self.payslip()
		got = self.items(name)
		self.assertEqual(got["eid"]["status"], "missing")
		self.assertTrue(got["eid"]["optional"])
		self.assertFalse(got["eid"]["blocking"])
		self.assertTrue(got["_ready"])

	def test_the_applicant_cannot_read_it(self):
		name, _offer = self.signed()
		with self.set_user(TRADER), self.assertRaises(frappe.PermissionError):
			api.loan_checklist(application=name)

	def test_the_applicant_sees_what_their_case_still_needs(self):
		name, _offer = self.signed()
		with self.set_user(TRADER):
			got = api.my_checklists()
		self.assertEqual([i["key"] for i in got[name]], ["eid", "national_id", "payslip"])
		self.payslip()
		frappe.db.set_value("User", TRADER, "gdb_national_id", "900100555")
		with self.set_user(TRADER):
			got = api.my_checklists()
		self.assertEqual([i["key"] for i in got[name]], ["eid"])

	def test_the_facilitated_banks_link_to_their_sites(self):
		from gdb_bank import install

		install.ensure_banks()
		with self.set_user(TRADER):
			sites = {b["name"]: b["website"] for b in api.facilitated_bank_sites()}
		for bank in sites:
			self.assertTrue((sites[bank] or "").startswith("https://"), bank)

	def eid_card(self, status: str = "Received"):
		return frappe.get_doc(
			{
				"doctype": "GDB Applicant Document",
				"applicant": TRADER,
				"applicant_name": "Trader",
				"document_type": "Identity",
				"id_document_kind": "e-ID",
				"id_document_number": "59220010101",
				"status": status,
				"file_url": "/private/files/eid.pdf",
				"file_name": "eid.pdf",
			}
		).insert(ignore_permissions=True)

	def test_an_e_id_card_uploaded_from_my_documents_answers_the_request(self):
		name, _offer = self.signed()
		with self.set_user(UNDERWRITER):
			ask = documents.request_information(
				application=name, item=checklist.ASK["eid"][1], document_type="e-ID"
			)
		closed = documents.satisfy_open_requests(self.eid_card())
		self.assertEqual(closed, [ask.name])
		self.assertEqual(frappe.db.get_value("GDB Information Request", ask.name, "status"), "Satisfied")
		self.assertEqual(self.items(name)["eid"]["status"], "ok")

	def test_a_rejected_e_id_card_is_asked_for_again(self):
		name, _offer = self.signed()
		self.eid_card("Rejected")
		self.assertEqual(self.items(name)["eid"]["status"], "missing")

	def test_a_national_id_card_does_not_answer_an_e_id_request(self):
		name, _offer = self.signed()
		with self.set_user(UNDERWRITER):
			documents.request_information(application=name, item=checklist.ASK["eid"][1], document_type="e-ID")
		card = self.eid_card()
		card.id_document_kind = "National ID Card"
		self.assertEqual(documents.satisfy_open_requests(card), [])

	def test_an_e_id_is_not_asked_for_when_the_card_is_on_file(self):
		name, _offer = self.signed()
		self.eid_card()
		with self.set_user(UNDERWRITER), self.assertRaises(frappe.ValidationError):
			documents.request_information(application=name, item=checklist.ASK["eid"][1], document_type="e-ID")

	def test_the_e_id_card_answers_applicant_e_id_on_the_application(self):
		from gdb_bank.services import application_edit

		name = self.submitted()
		frappe.db.set_value("Loan Application", name, "gdb_applicant_eid", None)
		with self.set_user(TRADER):
			keys = [g["fieldname"] for g in api.application_gaps(name=name)["fields"]]
		self.assertIn("gdb_applicant_eid", keys)
		self.eid_card()
		with self.set_user(TRADER):
			keys = [g["fieldname"] for g in api.application_gaps(name=name)["fields"]]
		self.assertNotIn("gdb_applicant_eid", keys)
		self.assertEqual(application_edit.fill_eid_from_card(TRADER), [name])
		self.assertEqual(frappe.db.get_value("Loan Application", name, "gdb_applicant_eid"), "592-2001-0101")
