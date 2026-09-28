"""Underwriting: the Bank's review queue, the credit decision, lead conversion.

Callers have already checked the role; the rules here are about the case. The
one that matters most: nobody decides their own application.
"""

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from gdb_bank.services.evidence import missing_by_application
from gdb_bank.utils.constants import LOAN_FIELDS, STATUS_FROM_PORTAL
from gdb_bank.utils.formatters import _portal_dict, _stage_context
from gdb_bank.utils.session import _eids, _logger


def _case(name: str) -> dict:
	return _portal_dict(frappe.db.get_value("Loan Application", name, LOAN_FIELDS, as_dict=True))


def all_loans(status: str | None = None) -> list[dict]:
	"""Every SUBMITTED application, newest first, optionally by portal status.

	Drafts are never before the Bank, so they are never in the queue.
	"""
	filters = {"docstatus": 1}
	if status:
		filters["status"] = STATUS_FROM_PORTAL.get(status, status)
	rows = frappe.get_all("Loan Application", filters=filters, fields=LOAN_FIELDS, order_by="creation desc")

	eids = _eids([r.gdb_owner for r in rows])
	ctx = _stage_context([r.name for r in rows])
	missing = missing_by_application(rows)
	return [dict(_portal_dict(r, eids, ctx), evidence_missing=missing.get(r.name, [])) for r in rows]


def review_loan(user: str, name: str, action: str, remarks: str | None = None) -> dict:
	"""Approve or reject an open application."""
	doc = frappe.get_doc("Loan Application", name)

	# Segregation of duties: an underwriter may also be a borrower, and must
	# never decide their own case.
	if doc.gdb_owner == user:
		frappe.throw(
			_("You cannot review your own application. Ask another underwriter."), frappe.PermissionError
		)

	new_status = {"approve": "Approved", "reject": "Rejected"}.get(action)
	if not new_status:
		frappe.throw(_("Unknown action: {0}").format(action))
	if doc.status != "Open":
		frappe.throw(_("Cannot {0} an application in status {1}.").format(action, doc.status))

	# db_set: the doc is submitted; status is permlevel-guarded and the review
	# fields are allow_on_submit.
	doc.db_set("status", new_status)
	if remarks:
		doc.db_set("gdb_remarks", remarks.strip())
	doc.db_set("gdb_reviewed_by", user)
	doc.db_set("gdb_reviewed_on", now_datetime())
	frappe.db.commit()
	_logger().info(f"loan {name}: {action} by {user} -> {new_status}")
	return _case(name)


def convert_lead(user: str, lead: str, cluster: str | None = None, purpose: str | None = None) -> dict:
	"""Turn a submitted Loan Lead into a Loan Application.

	lending's converter types its argument as a Document, so REST cannot reach
	it; this hands it the real doc, then adds the facts only GDB knows.
	"""
	lead_doc = frappe.get_doc("Loan Lead", lead)
	if lead_doc.docstatus != 1:
		frappe.throw(_("Submit lead {0} before converting it.").format(lead))

	from lending.loan_origination.doctype.loan_lead.loan_lead import convert_to_loan_application

	# The converter returns nothing, so diff the table to find what it made.
	before = set(frappe.get_all("Loan Application", pluck="name"))
	convert_to_loan_application(lead_doc)
	created = set(frappe.get_all("Loan Application", pluck="name")) - before
	if not created:
		frappe.throw(_("Lead {0} produced no application.").format(lead))

	doc = frappe.get_doc("Loan Application", created.pop())
	doc.is_term_loan = 1
	doc.repayment_method = "Repay Over Number of Periods"
	doc.gdb_owner = frappe.db.get_value("User", {"email": lead_doc.email}) or user
	doc.gdb_purpose = (purpose or "").strip()
	doc.gdb_monthly_income = flt(lead_doc.income)
	if cluster:
		doc.gdb_cluster = cluster
	doc.save()
	frappe.db.commit()
	_logger().info(f"lead {lead} -> application {doc.name} by {user}")
	return _case(doc.name)
