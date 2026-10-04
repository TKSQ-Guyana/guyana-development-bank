"""Close the requests already answered from My documents, and restore the
identity cards an upload of another kind wrongly marked Replaced (2026-10-04).

Before this, an e-ID card or payslip uploaded outside the request left the
request Open (so the applicant was asked again), and an e-ID card retired the
applicant's National ID card as if it were a newer one."""

import frappe

from gdb_bank.documents import DOCTYPE, satisfy_open_requests
from gdb_bank.services.evidence import OPEN, REPLACED, REQUEST_DOCTYPE

REJECTED = "Rejected"


def execute():
	if not frappe.db.table_exists(REQUEST_DOCTYPE) or not frappe.db.table_exists(DOCTYPE):
		return
	fields = ["name", "applicant", "document_type", "id_document_kind", "file_url", "superseded_by", "status"]

	# Identity cards retired by a card of another kind come back — the newest
	# of each kind only, and for GDB to look at again.
	for row in frappe.get_all(
		DOCTYPE, filters={"document_type": "Identity", "status": REPLACED}, fields=fields, order_by="creation desc"
	):
		by_kind = frappe.db.get_value(DOCTYPE, row.superseded_by, "id_document_kind") if row.superseded_by else None
		if not by_kind or by_kind == row.id_document_kind:
			continue
		newer = frappe.db.exists(
			DOCTYPE,
			{
				"applicant": row.applicant,
				"document_type": "Identity",
				"id_document_kind": row.id_document_kind,
				"status": ["not in", [REPLACED, REJECTED]],
				"file_url": ["is", "set"],
			},
		)
		if not newer:
			frappe.db.set_value(DOCTYPE, row.name, {"status": "Received", "superseded_by": None}, update_modified=False)

	# "Applicant e-ID" left blank where the e-ID card on file gives it.
	from gdb_bank.services.application_edit import fill_eid_from_card

	for applicant in set(
		frappe.get_all(
			DOCTYPE,
			filters={"document_type": "Identity", "id_document_kind": "e-ID", "file_url": ["is", "set"]},
			pluck="applicant",
		)
	):
		fill_eid_from_card(applicant)

	# Open requests whose answer is already on the shelf.
	for request in frappe.get_all(
		REQUEST_DOCTYPE, filters={"status": OPEN}, fields=["name", "applicant", "document_type", "requested_on"]
	):
		filters = {
			"applicant": request.applicant,
			"file_url": ["is", "set"],
			"status": ["not in", [REPLACED, REJECTED]],
		}
		if request.document_type == "e-ID":
			# An e-ID card on file answers it, whenever it was uploaded.
			filters |= {"document_type": "Identity", "id_document_kind": "e-ID"}
		elif request.document_type:
			# A payslip asked for is a newer one than what was on file.
			filters |= {"document_type": request.document_type, "creation": [">=", request.requested_on]}
		else:
			continue
		doc = frappe.get_all(DOCTYPE, filters=filters, fields=fields, order_by="creation desc", limit=1)
		if doc:
			satisfy_open_requests(doc[0])
	frappe.db.commit()
