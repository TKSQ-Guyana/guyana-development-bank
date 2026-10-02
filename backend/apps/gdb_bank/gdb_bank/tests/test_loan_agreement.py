"""The loan agreement Word document (gdb_bank/loan_agreement.py).

    bench --site gdb.localhost run-tests --module gdb_bank.tests.test_loan_agreement
"""

import io
import re
import zipfile

import frappe
from frappe.tests import IntegrationTestCase

from gdb_bank import loan_agreement

VALUES = {
	"borrower_name": "Asha O'Neil & Daughters",
	"borrower_address": "Lot 5 Main Street, Linden, Region 10",
	"bank_account": "0009111122223333 (Republic Bank)",
	"amount": "G$2,500,000.00",
	"amount_words": "two million, five hundred thousand Guyana dollars",
	"purpose": "Buy a refrigerated display cabinet <for the shop>",
	"term_months": "24",
	"moratorium_clause": "A moratorium of 3 months applies: no instalment is due for the first 3 months after the loan is disbursed. ",
	"instalment": "G$104,166.67",
	"first_repayment": "15-11-2026",
	"repayment_day": "15th day",
	"loan_account": "ACC-LOAN-2026-00042",
	"borrower_signature_name": "ASHA O'NEIL & DAUGHTERS",
}


def _text(docx: bytes) -> str:
	xml = zipfile.ZipFile(io.BytesIO(docx)).read("word/document.xml").decode("utf-8")
	return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml)), xml


class TestLoanAgreement(IntegrationTestCase):
	def test_every_blank_is_filled_and_no_token_is_left(self):
		text, xml = _text(loan_agreement.render(VALUES))
		self.assertNotIn("{{", xml)
		self.assertIn("A Loan of G$2,500,000.00 (two million, five hundred thousand Guyana dollars)", text)
		self.assertIn("Repayable in 24 months", text)
		self.assertIn("monthly instalments of G$104,166.67 commencing from 15-11-2026", text)
		self.assertIn("on the 15th day monthly thereafter", text)
		self.assertIn("account number is ACC-LOAN-2026-00042.", text)
		self.assertIn("disbursed to your bank account no. 0009111122223333 (Republic Bank).", text)

	def test_values_are_escaped_so_the_document_stays_well_formed(self):
		docx = loan_agreement.render(VALUES)
		_, xml = _text(docx)
		self.assertIn("O'Neil &amp; Daughters", xml)
		self.assertIn("&lt;for the shop&gt;", xml)
		# The whole document still parses as XML.
		from xml.dom import minidom

		minidom.parseString(xml.encode("utf-8"))

	def test_the_rest_of_the_package_is_untouched(self):
		names = zipfile.ZipFile(loan_agreement.TEMPLATE).namelist()
		self.assertEqual(zipfile.ZipFile(io.BytesIO(loan_agreement.render(VALUES))).namelist(), names)

	def test_a_missing_value_is_refused_rather_than_left_blank(self):
		with self.assertRaises(frappe.ValidationError):
			loan_agreement.render({k: v for k, v in VALUES.items() if k != "purpose"})

	def test_ordinals(self):
		self.assertEqual(
			[loan_agreement._ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31)],
			["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"],
		)
