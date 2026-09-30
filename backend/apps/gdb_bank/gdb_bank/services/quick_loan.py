"""The Quick Loan decision: one officer — an underwriter or a Disbursement Officer —
decides AND pays, in one act.

THIS IS A DELIBERATE EXCEPTION to the rule every other GDB loan is held to — the
underwriter decides, a different officer releases (api.disburse_loan), and a
Letter of Offer binds both sides in between. GDB took it on 2026-09-30 for the
Quick Loan alone: an informal trader's loan, capped by configuration at
G$300,000 (utils/policy), where the paperwork of an SME loan would defeat the
product. Nothing here applies to any other application; decide() refuses one.

What stands in for the second pair of eyes it gives up:

  - the CEILING — lending's own maximum on the product, re-checked at the
    moment of payment rather than trusted from the application
  - the officer is NEVER the applicant, on any account (security/conflict)
  - a recorded REASON, and the officer's name on the decision and on the release
  - a payout account ON FILE. Its bank check is recorded on the account and in
    the release log line, but — GDB's decision, 2026-09-30 — does not stop payment
  - the borrower's ACCEPTANCE of the terms, recorded at submission, in place of
    the signed offer (services/application.submit_application)
  - ONE transaction: the decision, the booking and the release commit together,
    and a retry finds the case decided and pays nothing more

The underwriter's review_loan and offers.issue_offer both refuse a Quick Loan, so
this is the only door to its money.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from gdb_bank.install import QUICK_LOAN_PRODUCT_NAME, QUICK_TRADE_LOCATIONS, QUICK_TRADING_SINCE
from gdb_bank.security.conflict import is_same_person
from gdb_bank.services.disbursement import book_on_terms, release_funds
from gdb_bank.utils import policy
from gdb_bank.utils.constants import QUICK_PRODUCT
from gdb_bank.utils.formatters import _portal_product
from gdb_bank.utils.session import _as_system, _logger

ACTIONS = {"approve": "Approved", "decline": "Rejected"}


def is_quick(loan_product: str | None) -> bool:
	return _portal_product(loan_product) == QUICK_PRODUCT


def terms() -> dict:
	"""What the Quick Loan form needs, from the server that enforces it — the
	same arrangement as documents.document_settings. The ceiling and the rate are
	the Loan Product's own (lending refuses past them), so the form states the
	figure that will actually be applied rather than a copy that could drift."""
	product = frappe.db.get_value(
		"Loan Product",
		{"product_name": QUICK_LOAN_PRODUCT_NAME},
		["maximum_loan_amount", "rate_of_interest"],
		as_dict=True,
	)
	return {
		"ceiling": flt(product.maximum_loan_amount) if product else policy.quick_loan_ceiling(),
		"max_term": cint(policy.quick_loan_max_term()),
		"rate_of_interest": flt(product.rate_of_interest) if product else policy.rate_of_interest(),
		"trade_locations": list(QUICK_TRADE_LOCATIONS),
		"trading_since": list(QUICK_TRADING_SINCE),
	}


FIELD_OFFICER_REQUEST = "GDB Field Officer Request"
FIELD_OFFICER_FIELDS = [
	"name",
	"applicant_name",
	"phone",
	"business_type",
	"region",
	"best_time",
	"status",
	"requested_on",
]
BEST_TIMES = ("Morning", "Afternoon", "Evening")


def my_field_officer_request(user: str):
	"""The caller's most recent request, whatever its status."""
	rows = frappe.get_all(
		FIELD_OFFICER_REQUEST,
		filters={"applicant": user},
		fields=FIELD_OFFICER_FIELDS,
		order_by="creation desc",
		limit=1,
	)
	return rows[0] if rows else None


def request_field_officer(user: str, applicant_name, phone, business_type, region, best_time=None):
	"""Record who a field officer should call. One waiting request per person: a
	second ask while one is waiting answers the first rather than adding another."""
	waiting = frappe.db.get_value(FIELD_OFFICER_REQUEST, {"applicant": user, "status": "Waiting"})
	if waiting:
		return frappe.db.get_value(FIELD_OFFICER_REQUEST, waiting, FIELD_OFFICER_FIELDS, as_dict=True)

	values = {
		"applicant_name": (applicant_name or "").strip(),
		"phone": (phone or "").strip(),
		"business_type": (business_type or "").strip(),
		"region": (region or "").strip(),
		"best_time": (best_time or "").strip(),
	}
	for field, message in (
		("applicant_name", "Enter your name."),
		("phone", "Enter a phone number."),
		("business_type", "Choose the type of business."),
		("region", "Choose a region."),
	):
		if not values[field]:
			frappe.throw(_(message))
	if values["best_time"] and values["best_time"] not in BEST_TIMES:
		frappe.throw(_("Choose morning, afternoon or evening."))

	doc = frappe.get_doc(
		{
			"doctype": FIELD_OFFICER_REQUEST,
			"applicant": user,
			"status": "Waiting",
			"requested_on": now_datetime(),
			**values,
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"field officer request {doc.name} raised by {user} for {values['region']}")
	return frappe.db.get_value(FIELD_OFFICER_REQUEST, doc.name, FIELD_OFFICER_FIELDS, as_dict=True)


def cancel_field_officer_request(user: str, name: str):
	row = frappe.db.get_value(FIELD_OFFICER_REQUEST, name, ["applicant", "status"], as_dict=True)
	if not row or row.applicant != user:
		frappe.throw(_("Request {0} not found.").format(name), frappe.PermissionError)
	if row.status != "Waiting":
		frappe.throw(_("This request is already {0}.").format(row.status.lower()))
	doc = frappe.get_doc(FIELD_OFFICER_REQUEST, name)
	doc.status = "Cancelled"
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	_logger().info(f"field officer request {name} cancelled by {user}")
	return frappe.db.get_value(FIELD_OFFICER_REQUEST, name, FIELD_OFFICER_FIELDS, as_dict=True)


def _payout_account(customer: str):
	return frappe.db.get_value(
		"Bank Account",
		{"party_type": "Customer", "party": customer},
		["name", "gdb_verification_status"],
		as_dict=True,
	)


def decide(officer: str, application: str, action: str, remarks: str | None) -> None:
	"""Approve-and-pay or decline a submitted Quick Loan. `officer` holds the
	underwriter or Disbursement Officer role (api.decide_quick_loan settles that)."""
	new_status = ACTIONS.get((action or "").strip().lower())
	if not new_status:
		frappe.throw(_("Choose approve or decline."))
	remarks = (remarks or "").strip()
	if not remarks:
		frappe.throw(_("Enter a reason."))

	doc = frappe.get_doc("Loan Application", application)
	if not is_quick(doc.loan_product):
		frappe.throw(_("{0} is not a Quick Loan.").format(application))
	if doc.docstatus != 1:
		frappe.throw(_("{0} has not been submitted to GDB.").format(application))
	if doc.status != "Open":
		# The idempotency: a decided case cannot be decided — or paid — again.
		frappe.throw(_("{0} has already been decided ({1}).").format(application, doc.status))
	if is_same_person(officer, doc.gdb_owner):
		_logger().warning(f"quick loan: {officer} tried to decide their own application {application}")
		frappe.throw(_("You cannot decide or pay your own application."), frappe.PermissionError)

	if new_status == "Approved":
		ceiling = flt(frappe.db.get_value("Loan Product", doc.loan_product, "maximum_loan_amount"))
		if ceiling and flt(doc.loan_amount) > ceiling:
			frappe.throw(
				_("Exceeds the GYD {0} limit.").format(
					frappe.utils.fmt_money(ceiling, currency="GYD").replace("$", "").strip()
				)
			)
	account = _payout_account(doc.applicant) if new_status == "Approved" else None
	if new_status == "Approved" and not account:
		frappe.throw(_("The applicant has no payout account on file."))

	# db_set, exactly as review_loan decides: the doc is submitted, status is
	# permlevel-guarded and the review fields are allow_on_submit.
	doc.db_set("status", new_status)
	doc.db_set("gdb_remarks", remarks)
	doc.db_set("gdb_reviewed_by", officer)
	doc.db_set("gdb_reviewed_on", now_datetime())

	if new_status == "Approved":
		# lending's own booking and disbursement, on the accepted application's
		# terms. Elevated for the same reason book_loan and disburse_loan are:
		# lending gates both on Loan permissions no portal role holds.
		with _as_system():
			loan = book_on_terms(application, doc.loan_amount, doc.repayment_periods)
			release_funds(loan, doc.loan_amount, officer)

	frappe.db.commit()
	_logger().info(
		f"quick loan {application}: {action} by {officer}"
		+ (
			f", G${flt(doc.loan_amount)} released to {account.name}"
			f" (bank check: {account.gdb_verification_status or 'none'})"
			if account
			else ""
		)
	)
