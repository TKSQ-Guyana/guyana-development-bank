"""One loan of each kind at a time.

A citizen may hold ONE SME Loan and ONE Quick Loan. The two products do not
block each other, but a second of the same kind waits until the first is
CLEARED. A case of a product stays open, and blocks another of that product,
while it is:

  a draft            — continue it, or discard it
  with GDB           — submitted and not yet decided
  approved           — unless its Letter of Offer was declined, withdrawn or
                       has expired, which ends the case
  a loan             — until lending marks it Closed or Settled; a loan
                       written off is not cleared, the money is still owed

A rejection ends a case. Only the citizen's own applications count: a group's
application is filed in its head's name but is the group's, not theirs.

Enforced where a case is opened (save_application, first save) and where it is
put before the Bank (submit_application), so no client — the SPA, a field
officer's assisted form, or a direct API call — can step around it.
"""

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

from gdb_bank.utils.constants import PORTAL_PRODUCTS, QUICK_PRODUCT, STANDARD_PRODUCT
from gdb_bank.utils.formatters import _portal_product

CLEARED_LOAN = ("Closed", "Settled")
ENDED_OFFER = ("Declined", "Withdrawn", "Expired")

PRODUCT_NAMES = {STANDARD_PRODUCT: "SME Loan", QUICK_PRODUCT: "Quick Loan"}


def _loan_of(application: str):
	return frappe.db.get_value(
		"Loan",
		{"loan_application": application, "docstatus": 1},
		["name", "status"],
		as_dict=True,
		order_by="creation desc",
	)


def _offer_ended(application: str) -> bool:
	"""The case's latest Letter of Offer was declined, withdrawn or lapsed."""
	offer = frappe.db.get_value(
		"GDB Loan Offer",
		{"application": application, "docstatus": ["<", 2]},
		["status", "valid_until"],
		as_dict=True,
		order_by="creation desc",
	)
	if not offer:
		return False
	if offer.status in ENDED_OFFER:
		return True
	return offer.status == "Issued" and bool(offer.valid_until) and getdate(offer.valid_until) < getdate(nowdate())


def _blocking(row) -> dict | None:
	"""What keeps this case open, or None when it is finished."""
	if row.docstatus == 0:
		return {"kind": "draft"}
	if row.status == "Rejected":
		return None
	if row.status != "Approved":
		return {"kind": "review"}
	loan = _loan_of(row.name)
	if loan:
		return None if loan.status in CLEARED_LOAN else {"kind": "loan", "loan": loan.name, "loan_status": loan.status}
	return None if _offer_ended(row.name) else {"kind": "approved"}


def open_cases(user: str, include_drafts: bool = True, except_name: str | None = None) -> dict:
	"""{product: the open case of that product} for this citizen's own
	applications — at most one entry per product, the newest."""
	rows = frappe.get_all(
		"Loan Application",
		filters={
			"gdb_owner": user,
			"docstatus": ["<", 2] if include_drafts else 1,
			"gdb_cluster": ["is", "not set"],
		},
		fields=["name", "docstatus", "status", "loan_product", "loan_amount", "creation"],
		order_by="creation desc",
	)
	found: dict = {}
	for row in rows:
		if row.name == except_name:
			continue
		product = _portal_product(row.loan_product)
		if product in found:
			continue
		reason = _blocking(row)
		if reason:
			found[product] = {"name": row.name, "loan_amount": row.loan_amount, **reason}
	return found


def message(product: str, case: dict) -> str:
	what = PRODUCT_NAMES.get(product, "loan")
	kind = case["kind"]
	article = "an" if what.startswith("SME") else "a"
	if kind == "draft":
		return _("You already have {2} {0} application in progress ({1}). Continue it, or discard it, before starting another.").format(what, case["name"], article)
	if kind == "review":
		return _("Your {0} application {1} is with GDB. You can apply for another {0} once it is decided and any loan is repaid.").format(what, case["name"])
	if kind == "approved":
		return _("Your {0} application {1} has been approved. You can apply for another {0} once that loan is repaid.").format(what, case["name"])
	return _("You have {2} {0} ({1}) that is not yet repaid. Clear it to apply for another {0}.").format(
		what, case.get("loan") or case["name"], article
	)


def require_none_open(user: str, product: str, include_drafts: bool = True, except_name: str | None = None) -> None:
	case = open_cases(user, include_drafts=include_drafts, except_name=except_name).get(product)
	if case:
		frappe.throw(message(product, case), title=_("One {0} at a time").format(PRODUCT_NAMES.get(product, "loan")))


def summary(user: str) -> dict:
	"""Per product: can this citizen start one, and if not, what stands in the
	way — for the loan chooser to say before they begin, not after."""
	cases = open_cases(user)
	out = {}
	for product in PORTAL_PRODUCTS:
		case = cases.get(product)
		out[product] = {"can_apply": case is None, "open_case": case, "message": message(product, case) if case else None}
	return out
