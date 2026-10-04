"""One loan at a time.

A citizen may have ONE loan with GDB — a Quick Loan or an SME Loan, not one
of each (GDB, 2026-10-04). Any open case blocks a new application of either
kind until it is CLEARED. A case stays open while it is:

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


def open_case(user: str, include_drafts: bool = True, except_name: str | None = None) -> dict | None:
	"""The citizen's newest open case of either kind, with its `product` — or None."""
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
	for row in rows:
		if row.name == except_name:
			continue
		reason = _blocking(row)
		if reason:
			return {
				"name": row.name,
				"product": _portal_product(row.loan_product),
				"loan_amount": row.loan_amount,
				**reason,
			}
	return None


def message(case: dict) -> str:
	"""Why a new application must wait, naming the case that is open."""
	what = PRODUCT_NAMES.get(case.get("product"), "loan")
	kind = case["kind"]
	article = "an" if what.startswith("SME") else "a"
	if kind == "draft":
		return _("You already have {2} {0} application in progress ({1}). Continue it, or discard it, before starting a new one.").format(what, case["name"], article)
	if kind == "review":
		return _("Your {0} application {1} is under review with GDB.").format(what, case["name"])
	if kind == "approved":
		return _("Your {0} application {1} has been approved. You can apply for another loan once it is repaid.").format(what, case["name"])
	return _("You have {2} {0} ({1}) that is not yet repaid. Clear it to apply for another loan.").format(
		what, case.get("loan") or case["name"], article
	)


def require_none_open(user: str, product: str | None = None, include_drafts: bool = True, except_name: str | None = None) -> None:
	"""Refuse a new application while any case is open. `product` is the one
	being applied for; it no longer matters which — one loan in total."""
	case = open_case(user, include_drafts=include_drafts, except_name=except_name)
	if case:
		frappe.throw(message(case), title=_("One loan at a time"))


def summary(user: str) -> dict:
	"""Per product: can this citizen start one, and if not, what stands in the
	way — for the loan chooser to say before they begin, not after. One open
	case blocks both."""
	case = open_case(user)
	return {
		product: {"can_apply": case is None, "open_case": case, "message": message(case) if case else None}
		for product in PORTAL_PRODUCTS
	}
