"""The loan officer's checklist — what must be in place before a case moves to
the disbursement officer. Every loan, SME or Quick, individual or group (the
group's head, in whose name the case is filed).

  e-ID           on the account — or asked for: the Letter of Offer gives the
                 borrower 90 days to get one, so an open request is enough
  National ID    on the account or the applicant's profile
  Bank account   the account the loan is paid into, nominated in the portal
  Payslip        uploaded, and not rejected

Each item is "ok", "requested" (an information request is open for it) or
"missing". The case is READY when every item is ok — the e-ID alone may be
"requested". Booking (api.book_loan) refuses a case that is not ready, so the
disbursement officer cannot start on it before the loan officer's checks are
done; the loan officer asks the applicant for anything missing from the
checklist itself (documents.request_information, with the item texts below).
"""

import frappe
from frappe import _

from gdb_bank.services.evidence import EID_REQUEST, OPEN, REPLACED, REQUEST_DOCTYPE

REJECTED = "Rejected"

DOCUMENTS = "GDB Applicant Document"

# What each item asks the applicant for when it is missing — also how an open
# request is recognised as answering that item.
ASK = {
	"eid": (EID_REQUEST, "Please get your e-ID and add it to your GDB account."),
	"national_id": (None, "Please add your National ID number to your profile (My details)."),
	"bank_account": (None, "Please add the bank account your loan should be paid into (My details → Bank account)."),
	"payslip": ("Payslip", "Please upload your most recent payslip."),
}

LABELS = {
	"eid": "e-ID",
	"national_id": "National ID",
	"bank_account": "Bank account",
	"payslip": "Payslip",
}

# Items that may stand at "requested" without holding the case back.
GRACE = {"eid"}


def _open_request(application: str, key: str) -> bool:
	document_type, item = ASK[key]
	filters = {"application": application, "status": OPEN}
	if document_type:
		filters["document_type"] = document_type
	else:
		filters["item"] = item
	return bool(frappe.db.exists(REQUEST_DOCTYPE, filters))


def _facts(owner: str) -> dict:
	user = frappe.db.get_value("User", owner, ["gdb_eid", "gdb_national_id"], as_dict=True) or {}
	profile_nid = frappe.db.get_value("GDB Citizen Profile", {"user": owner}, "national_id")
	customer = frappe.db.get_value("Customer", {"gdb_user": owner})
	account = (
		frappe.db.get_value(
			"Bank Account", {"party_type": "Customer", "party": customer}, ["bank", "bank_account_no"], as_dict=True
		)
		if customer
		else None
	)
	payslip = frappe.db.get_value(
		DOCUMENTS,
		{
			"applicant": owner,
			"document_type": "Payslip",
			"file_url": ["is", "set"],
			"status": ["not in", [REJECTED, REPLACED]],
		},
		["name", "status"],
		as_dict=True,
		order_by="creation desc",
	)
	return {
		"eid": user.get("gdb_eid"),
		"national_id": user.get("gdb_national_id") or profile_nid,
		"bank_account": f"{account.bank} ····{(account.bank_account_no or '')[-4:]}" if account else None,
		"payslip": f"Uploaded · {payslip.status}" if payslip else None,
	}


def checklist(application: str) -> dict:
	"""The checklist for one case: {items, ready, outstanding}."""
	owner = frappe.db.get_value("Loan Application", application, "gdb_owner")
	if not owner:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	facts = _facts(owner)
	items = []
	for key in ("eid", "national_id", "bank_account", "payslip"):
		have = facts[key]
		status = "ok" if have else ("requested" if _open_request(application, key) else "missing")
		document_type, ask = ASK[key]
		items.append(
			{
				"key": key,
				"label": LABELS[key],
				"status": status,
				"detail": have,
				"request_type": document_type,
				"request_item": ask,
				# Whether this item is what keeps the case from disbursement.
				"blocking": status != "ok" and not (status == "requested" and key in GRACE),
			}
		)
	outstanding = [i["label"] for i in items if i["blocking"]]
	return {"items": items, "ready": not outstanding, "outstanding": outstanding}


def require_ready(application: str) -> None:
	"""Refuse to move a case to disbursement until its checklist is done."""
	result = checklist(application)
	if not result["ready"]:
		frappe.throw(
			_("The loan officer's checklist is not complete for {0}: {1}. Ask the applicant for it from the case's Credit risk tab.").format(
				application, ", ".join(result["outstanding"])
			),
			title=_("Checklist not complete"),
		)
