"""Booking and releasing a loan — the Bank's money side of an approved case.

Both acts are lending's own (create_loan; the Loan Disbursement doctype, whose
submit generates the schedule). This module adds who may ask, and when, and
computes no money. Release has two gates: the role, checked by the caller, and
four eyes, checked here — whoever approved a case never releases it (R-131),
and nobody releases funds on their own application.
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from gdb_bank.conditions import outstanding
from gdb_bank.offers import accepted_offer
from gdb_bank.services.application import loan_account
from gdb_bank.utils.constants import STATUS_TO_PORTAL
from gdb_bank.utils.session import _as_system, _logger

BOOKED_LOAN_FIELDS = [
	"name",
	"status",
	"company",
	"applicant",
	"applicant_type",
	"loan_amount",
	"disbursed_amount",
]


def booked_loan(application: str):
	"""The Loan booked from this application, if one exists yet."""
	return frappe.db.get_value("Loan", {"loan_application": application}, BOOKED_LOAN_FIELDS, as_dict=True)


def book_loan(user: str, application: str) -> dict:
	"""Create the Loan for an approved application whose offer is executed.

	An approval binds nobody; the signed Letter of Offer is what puts a borrower
	on GDB's books, so booking waits for it.
	"""
	row = frappe.db.get_value("Loan Application", application, ["name", "status"], as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.status != "Approved":
		frappe.throw(
			_("Only an approved application can be booked ({0} is {1}).").format(
				application, STATUS_TO_PORTAL.get(row.status, row.status)
			)
		)
	existing = booked_loan(application)
	if existing:
		frappe.throw(_("Loan {0} is already booked for {1}.").format(existing.name, application))
	if not accepted_offer(application):
		frappe.throw(
			_("No accepted offer for {0}. Issue a Letter of Offer and wait for the "
			  "applicant to accept it before booking.").format(application)
		)

	# lending guards its mapper with a Loan create permission no portal role
	# holds; who may ask is settled, so the write runs as the system.
	from lending.loan_management.doctype.loan_application.loan_application import create_loan

	with _as_system():
		loan = create_loan(application, submit=1)
		frappe.db.commit()

	_logger().info(f"loan {loan.name} booked from {application} by {user}")
	return loan_account(user, application)


def disburse_loan(user: str, application: str, amount=None) -> dict:
	"""Release funds on a booked loan. Omit `amount` to release all lending says
	is drawable — both that default and the ceiling are lending's."""
	decision = frappe.db.get_value(
		"Loan Application", application, ["gdb_reviewed_by", "gdb_owner"], as_dict=True
	)
	if decision and decision.gdb_reviewed_by == user:
		_logger().warning(f"four-eyes: {user} approved {application} and tried to release it")
		frappe.throw(
			_("You approved this application, so you cannot release its funds. "
			  "Another officer must disburse it."),
			frappe.PermissionError,
		)
	if decision and decision.gdb_owner == user:
		frappe.throw(_("You cannot release funds on your own application."), frappe.PermissionError)

	loan = booked_loan(application)
	if not loan:
		frappe.throw(_("No loan has been booked for {0} yet.").format(application))
	if loan.status not in ("Sanctioned", "Partially Disbursed"):
		frappe.throw(_("Loan {0} is not awaiting disbursement (status {1}).").format(loan.name, loan.status))

	# The Letter of Offer says no funds move until its conditions are met.
	blocking = outstanding(application)
	if blocking:
		frappe.throw(
			_("{0} condition(s) precedent are still outstanding: {1}").format(
				len(blocking), "; ".join(blocking[:3])
			)
		)

	from lending.loan_management.doctype.loan_disbursement.loan_disbursement import get_disbursal_amount

	with _as_system() as caller:
		amount = flt(amount) if amount else flt(get_disbursal_amount(loan.name)[0])
		if amount <= 0:
			frappe.throw(_("Nothing is available to disburse on {0} right now.").format(loan.name))
		doc = frappe.get_doc(
			{
				"doctype": "Loan Disbursement",
				"against_loan": loan.name,
				"company": loan.company,
				"applicant_type": loan.applicant_type,
				"applicant": loan.applicant,
				"posting_date": nowdate(),
				"disbursement_date": nowdate(),
				"disbursed_amount": amount,
				"gdb_disbursed_by": caller,
			}
		)
		doc.insert()
		doc.submit()
		frappe.db.commit()

	_logger().info(f"disbursement {doc.name}: {amount} on {loan.name} by {user}")
	return loan_account(user, application)
