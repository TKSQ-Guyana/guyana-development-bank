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

	def test_the_applicant_cannot_read_it(self):
		name, _offer = self.signed()
		with self.set_user(TRADER), self.assertRaises(frappe.PermissionError):
			api.loan_checklist(application=name)
