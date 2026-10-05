"""A single SME application made ready to submit, for tests about what follows.

services/application.submit_application asks an SME for its E-ID, DCRA number
and date of registration, the applicant's declarations, an email address and
the Certificate of Registration (optional, but filed). Tests about the review, the offer or the
statement are not about those, so they complete them here in one call.
"""

from io import BytesIO

import frappe

from gdb_bank import documents, profiles
from gdb_bank.services.evidence import CERTIFICATE_OF_REGISTRATION

SME_ANSWERS = {
	"gdb_applicant_eid": "592-2001-0101",
	"gdb_dcra_number": "BN-2024-000001",
	"gdb_registration_date": "2024-01-15",
	"gdb_has_eid": "Yes",
	"gdb_employed": "No",
	"gdb_sector": "Manufacturing",
	"gdb_sub_sector": "",
}


def _pdf() -> bytes:
	from pypdf import PdfWriter

	writer, out = PdfWriter(), BytesIO()
	writer.add_blank_page(width=72, height=72)
	writer.write(out)
	return out.getvalue()


def complete_sme(user: str, application: str) -> None:
	"""Give `user`'s SME draft everything submission asks for."""
	held = frappe.db.get_value("Loan Application", application, list(SME_ANSWERS), as_dict=True)
	# Only what the test left blank: an answer it gave is the point of the test.
	blank = {k: v for k, v in SME_ANSWERS.items() if not held.get(k)}
	if blank:
		frappe.db.set_value("Loan Application", application, blank, update_modified=False)
	profile = profiles._ensure(user)
	if not frappe.db.get_value("GDB Citizen Profile", profile, "email"):
		frappe.db.set_value("GDB Citizen Profile", profile, "email", "applicant@example.gy")
	# The portal's three steps: open the shelf row, upload, confirm.
	previous = frappe.session.user
	frappe.set_user(user)
	try:
		row = documents.new_document(document_type=CERTIFICATE_OF_REGISTRATION, application=application)["name"]
		frappe.get_doc(
			{
				"doctype": "File",
				"file_name": "certificate.pdf",
				"content": _pdf(),
				"attached_to_doctype": documents.DOCTYPE,
				"attached_to_name": row,
				"is_private": 1,
			}
		).insert(ignore_permissions=True)
		documents.confirm_document(name=row)
	finally:
		frappe.set_user(previous)
