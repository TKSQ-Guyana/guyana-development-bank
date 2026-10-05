"""The Quick Loan: its terms, and the field officer a trader may ask for.

Since 2026-10-02 a Quick Loan goes the same road as every GDB loan — the
underwriter decides (underwriting.review_loan), a Letter of Offer is issued and
signed (offers), and a different officer books and pays it (api.book_loan,
api.disburse_loan, four eyes). What stays its own is the short form, the
ceiling, the terms and the conditions an informal trader can meet
(offers.QUICK_CONDITIONS). The one-step approve-and-pay GDB had taken on
2026-09-30 is retired (api.decide_quick_loan says so).
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from gdb_bank.services import credit_classification
from gdb_bank.install import QUICK_LOAN_PRODUCT_NAME, QUICK_TRADE_LOCATIONS, QUICK_TRADING_SINCE
from gdb_bank.utils import policy
from gdb_bank.utils.constants import QUICK_PRODUCT
from gdb_bank.utils.formatters import _portal_product
from gdb_bank.utils.session import _logger

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
		"term_options": policy.quick_loan_terms(),
		"moratorium_options": policy.moratorium_options(),
		"rate_of_interest": flt(product.rate_of_interest) if product else policy.rate_of_interest(),
		"trade_locations": list(QUICK_TRADE_LOCATIONS),
		"trading_since": list(QUICK_TRADING_SINCE),
		# GDB's industries, so the form knows when a sub-sector is asked.
		"industries": credit_classification.sector_options(),
	}


FIELD_OFFICER_REQUEST = "GDB Field Officer Request"
FIELD_OFFICER_FIELDS = [
	"name",
	"applicant_name",
	"phone",
	"business_type",
	"product",
	"region",
	"best_time",
	"status",
	"requested_on",
]
BEST_TIMES = ("Morning", "Afternoon", "Evening")
FIELD_OFFICER_PRODUCTS = ("Standard", "Quick")
# Still with GDB: in the regional pool, or with an officer working it.
OPEN_FIELD_OFFICER_REQUEST = ("Waiting", "Accepted", "Visit booked")


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


def request_field_officer(user: str, applicant_name, phone, business_type, region, best_time=None, product=None):
	"""Record who a field officer should call. One open request per person: a
	second ask while one is open answers the first rather than adding another.
	The region is stored as the profile list spells it, because that is what an
	officer's pool is matched on (services/field_operations)."""
	from gdb_bank.gdb_bank.doctype.gdb_citizen_profile.gdb_citizen_profile import canonical_region

	waiting = frappe.db.get_value(
		FIELD_OFFICER_REQUEST, {"applicant": user, "status": ["in", list(OPEN_FIELD_OFFICER_REQUEST)]}
	)
	if waiting:
		return frappe.db.get_value(FIELD_OFFICER_REQUEST, waiting, FIELD_OFFICER_FIELDS, as_dict=True)

	values = {
		"applicant_name": (applicant_name or "").strip(),
		"phone": (phone or "").strip(),
		"business_type": (business_type or "").strip(),
		"region": canonical_region(region) or "",
		"best_time": (best_time or "").strip(),
		"product": (product or "Quick").strip().title(),
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
	if values["product"] not in FIELD_OFFICER_PRODUCTS:
		frappe.throw(_("Choose the standard loan or the Quick Loan."))

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
