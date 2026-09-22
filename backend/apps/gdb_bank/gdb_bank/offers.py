"""Letter of Offer — and, once accepted, the loan agreement.

An approval is a credit decision. It is not a contract, and it does not bind
GDB. What binds both sides is a Letter of Offer stating amount, term,
repayment and conditions precedent, valid until a named date, which the
applicant accepts or declines in their own name.

So the lifecycle runs:

    Approved -> Offer Issued -> Accepted -> Booked -> Disbursed

and `api.book_loan` refuses to move until an accepted offer exists. Nobody
goes on GDB's books because a decision was recorded; they go on the books
because they agreed to terms.

Endpoints are POST /api/method/gdb_bank.offers.<name>, same session cookie as
the rest of the portal.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, fmt_money, formatdate, getdate, now_datetime, nowdate

from gdb_bank.api import (
	LOAN_FIELDS,
	STATUS_TO_PORTAL,
	_as_system,
	_logger,
	_readable_application,
	_require_underwriter,
	_session_user,
)
from gdb_bank.install import LOAN_PRODUCT_NAME

OFFER_FIELDS = [
	"name",
	"application",
	"applicant",
	"applicant_name",
	"business_name",
	"status",
	"valid_until",
	"loan_product",
	"offered_amount",
	"term_months",
	"rate_of_interest",
	"monthly_instalment",
	"total_repayable",
	"first_repayment_date",
	"conditions",
	"agreement_text",
	"issued_by",
	"issued_on",
	"accepted_name",
	"responded_on",
	"decline_reason",
]

DEFAULT_OFFER_VALIDITY_DAYS = 14

# Conditions precedent that attach to every GDB facility. An underwriter may
# add case-specific ones when issuing; these are the floor.
STANDARD_CONDITIONS = (
	"Bank account in the borrower's own name verified by GDB.",
	"Business registration with the Deeds and Commercial Registries Authority "
	"in good standing, or evidence that registration has been applied for.",
	"Proof of identity supplied and accepted.",
)


SIGNATURE_FIELDS = [
	"name",
	"member",
	"member_eid",
	"member_name",
	"is_head",
	"signature_status",
	"signed_name",
	"signed_on",
]


def _roster_for(application: str) -> list[dict]:
	"""The signature lines an offer on this application needs.

	Empty for an individual application, and that emptiness is what keeps the
	single-applicant path exactly as it was: no rows, no roster, `accept_offer`
	behaves the way it has since the offer was invented.

	For a cluster application it is the ACTIVE roster at the moment of issue,
	frozen. A member who joins the group afterwards has not been offered
	anything and must not appear as an unsigned line on somebody else's
	agreement; a member who leaves has still signed what they signed.
	"""
	cluster = frappe.db.get_value("Loan Application", application, "gdb_cluster")
	if not cluster:
		return []
	rows = frappe.get_all(
		"GDB Cluster Member",
		filters={"parent": cluster, "member_status": "Active"},
		fields=["member", "member_eid", "member_name", "is_head"],
		order_by="is_head desc, idx asc",
	)
	return [
		{
			"member": r.member,
			"member_eid": r.member_eid,
			"member_name": r.member_name,
			"is_head": cint(r.is_head),
			"signature_status": "Pending",
		}
		for r in rows
	]


def _signatures(offer: str) -> list[dict]:
	rows = frappe.get_all(
		"GDB Offer Signature",
		filters={"parent": offer, "parenttype": "GDB Loan Offer"},
		fields=SIGNATURE_FIELDS,
		order_by="is_head desc, idx asc",
	)
	# A Check field comes back as 0/1. Relayed raw, JSX renders the 0 — a
	# member's name read "Asha Persaud0" on the signing screen. The portal was
	# promised a boolean, so answer with one.
	for row in rows:
		row["is_head"] = bool(row.get("is_head"))
	return rows


def _execution_state(offer: str, rows: list | None = None) -> dict:
	"""Is this offer fully executed? The one place that question is answered.

	`accept_offer`, `sign_offer` and the portal all read it from here, so the
	agreement cannot be considered executed by one of them and pending by
	another. An offer with no signature lines is an individual offer, whose
	execution is its own `status` and nothing else.
	"""
	rows = _signatures(offer) if rows is None else rows
	if not rows:
		return {"joint": False, "signed": 0, "total": 0, "outstanding": [], "complete": None}
	signed = [r for r in rows if r.signature_status == "Signed"]
	declined = [r for r in rows if r.signature_status == "Declined"]
	return {
		"joint": True,
		"signed": len(signed),
		"total": len(rows),
		"outstanding": [r.member_name for r in rows if r.signature_status == "Pending"],
		"declined": [r.member_name for r in declined],
		"complete": len(signed) == len(rows),
	}


def _offer_dict(row, user: str | None = None) -> dict:
	get = row.get if isinstance(row, dict) else lambda f: row.get(f)
	status = get("status")
	valid_until = get("valid_until")
	# An offer nobody touched past its date reads as Expired whatever the
	# stored value says: a borrower must never see a live Accept button on a
	# lapsed offer.
	if status == "Issued" and valid_until and getdate(valid_until) < getdate(nowdate()):
		status = "Expired"
	signatures = _signatures(get("name"))
	execution = _execution_state(get("name"), signatures)
	return {
		"name": get("name"),
		"application": get("application"),
		"applicant_name": get("applicant_name"),
		"business_name": get("business_name"),
		"status": status,
		"valid_until": valid_until,
		"loan_product": get("loan_product"),
		"offered_amount": get("offered_amount"),
		"term_months": get("term_months"),
		"rate_of_interest": get("rate_of_interest"),
		"monthly_instalment": get("monthly_instalment"),
		"total_repayable": get("total_repayable"),
		"first_repayment_date": get("first_repayment_date"),
		"conditions": [c.strip() for c in (get("conditions") or "").splitlines() if c.strip()],
		"agreement_text": get("agreement_text"),
		"issued_by": get("issued_by"),
		"issued_on": get("issued_on"),
		"accepted_name": get("accepted_name"),
		"responded_on": get("responded_on"),
		"decline_reason": get("decline_reason"),
		"can_accept": status == "Issued" and not execution["joint"],
		# A cluster's Letter of Offer is signed, not accepted: it is one
		# agreement and every member is a party to it. `can_sign` is this
		# viewer's own line on it, which is the only line they can act on.
		"signatures": signatures,
		"execution": execution,
		"can_sign": bool(
			status == "Issued"
			and execution["joint"]
			and user
			and any(
				sig.member == user and sig.signature_status == "Pending" for sig in signatures
			)
		),
	}


def _agreement_text(offer) -> str:
	"""The wording the applicant accepts, frozen onto the record at issue.

	Plain language on purpose: a borrower in Region 2 has to be able to read
	what they are agreeing to without a lawyer.
	"""
	# Frappe renders GYD as a bare "$", which on a Guyanese loan agreement reads
	# as USD — a ~200x difference in what the borrower is agreeing to. The
	# Guyanese dollar's own mark is G$, so the agreement carries that.
	def money(value) -> str:
		return "G$" + fmt_money(flt(value), currency="GYD").replace("$", "").strip()
	conditions = [c.strip() for c in (offer.conditions or "").splitlines() if c.strip()]

	lines = [
		"GUYANA DEVELOPMENT BANK",
		"LETTER OF OFFER",
		"",
		f"Offer reference : {offer.name}",
		f"Application     : {offer.application}",
		f"Borrower        : {offer.applicant_name}",
	]
	if offer.business_name:
		lines.append(f"Business        : {offer.business_name}")
	lines += [
		f"Date of issue   : {formatdate(nowdate())}",
		"",
		"1. THE FACILITY",
		f"   Guyana Development Bank offers you a loan of {money(offer.offered_amount)}",
		f"   under the {offer.loan_product} product.",
		f"   Interest rate : {flt(offer.rate_of_interest)}% per annum.",
		f"   Term          : {cint(offer.term_months)} months.",
		f"   Instalment    : {money(offer.monthly_instalment)} per month (indicative).",
		f"   Total repayable: {money(offer.total_repayable)}.",
		"",
		"2. REPAYMENT",
		"   You agree to repay this loan by monthly instalments. The binding",
		"   schedule is the one issued when the loan is disbursed, and it is",
		"   available to you at any time in the GDB portal.",
		"",
		"3. CONDITIONS PRECEDENT",
		"   No funds will be released until all of the following are met:",
	]
	lines += (
		[f"   ({i}) {c}" for i, c in enumerate(conditions, start=1)] if conditions else ["   (none)"]
	)
	lines += [
		"",
		"4. VALIDITY",
		f"   This offer lapses on {formatdate(offer.valid_until)} unless you accept it",
		"   before that date.",
		"",
		"5. ACCEPTANCE",
		"   By accepting you confirm that the information you gave GDB is true,",
		"   that the bank account you nominated is your own, and that you agree",
		"   to the terms set out above.",
		"",
	]
	return "\n".join(lines)


@frappe.whitelist()
def issue_offer(
	application: str,
	offered_amount=None,
	term_months=None,
	conditions: str | None = None,
	valid_days=None,
):
	"""Issue a Letter of Offer on an approved application. Underwriter only."""
	staff = _require_underwriter()

	row = frappe.db.get_value("Loan Application", application, LOAN_FIELDS, as_dict=True)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.status != "Approved":
		frappe.throw(
			_("Only an approved application can be offered ({0} is {1}).").format(
				application, STATUS_TO_PORTAL.get(row.status, row.status)
			)
		)

	live = frappe.db.get_value(
		"GDB Loan Offer",
		{"application": application, "status": ["in", ["Issued", "Accepted"]], "docstatus": 1},
		["name", "status"],
		as_dict=True,
	)
	if live:
		frappe.throw(
			_("Offer {0} is already {1} for this application.").format(live.name, live.status.lower())
		)

	product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	amount = flt(offered_amount) or flt(row.loan_amount)
	term = cint(term_months) or cint(row.repayment_periods)

	# The product ceiling belongs to the bank, not to whoever is issuing.
	ceiling = flt(frappe.db.get_value("Loan Product", product, "maximum_loan_amount"))
	if ceiling and amount > ceiling:
		frappe.throw(
			_("Offer of {0} exceeds the {1} ceiling for this product.").format(
				fmt_money(amount, currency="GYD"), fmt_money(ceiling, currency="GYD")
			)
		)

	body = "\n".join(STANDARD_CONDITIONS)
	if conditions and conditions.strip():
		body = body + "\n" + conditions.strip()

	with _as_system():
		offer = frappe.get_doc(
			{
				"doctype": "GDB Loan Offer",
				"application": application,
				"applicant": row.gdb_owner,
				"applicant_name": row.applicant_name,
				"business_name": row.gdb_business_name,
				"loan_product": product,
				"offered_amount": amount,
				"term_months": term,
				"rate_of_interest": flt(
					frappe.db.get_value("Loan Product", product, "rate_of_interest")
				),
				"conditions": body,
				"valid_until": add_days(nowdate(), cint(valid_days) or DEFAULT_OFFER_VALIDITY_DAYS),
				"status": "Issued",
				"issued_by": staff,
				"issued_on": now_datetime(),
			}
		)
		# The roster goes on before the insert, and therefore before the
		# submit: a signature line is part of the agreement as issued, not
		# something added to a submitted document afterwards. Signing only ever
		# fills a line in that already stands.
		for line in _roster_for(application):
			offer.append("signatures", line)
		offer.insert()
		# Freeze the wording onto the record before it is submitted, so what the
		# applicant sees and what is retained are the same text.
		offer.agreement_text = _agreement_text(offer)
		offer.save()
		offer.submit()
		frappe.db.commit()

	_logger().info(f"offer {offer.name} issued on {application} by {staff} for {amount}")
	return _offer_dict(frappe.db.get_value("GDB Loan Offer", offer.name, OFFER_FIELDS, as_dict=True))


@frappe.whitelist()
def my_offer(application: str):
	"""The current offer on an application, for anyone who may read the case."""
	user = _session_user()
	_readable_application(application, user)
	rows = frappe.get_all(
		"GDB Loan Offer",
		filters={"application": application, "docstatus": ["<", 2]},
		fields=OFFER_FIELDS,
		order_by="creation desc",
		limit=1,
	)
	return _offer_dict(rows[0], user) if rows else None


def _respond(name: str, user: str):
	offer = frappe.get_doc("GDB Loan Offer", name)
	# A cluster's offer is answered by its parties, each on their own line.
	# Everyone else still has to be the applicant it was made to.
	if offer.applicant != user and not _my_signature(name, user):
		frappe.throw(_("You may only respond to your own offer."), frappe.PermissionError)
	if not offer.is_open():
		frappe.throw(
			_("This offer is {0} and can no longer be answered.").format(offer.expiry_state().lower())
		)
	return offer


def _my_signature(offer: str, user: str):
	"""This user's own signature line on this offer, if they have one."""
	if not user:
		return None
	rows = frappe.get_all(
		"GDB Offer Signature",
		filters={"parent": offer, "parenttype": "GDB Loan Offer", "member": user},
		fields=SIGNATURE_FIELDS,
		limit=1,
	)
	return rows[0] if rows else None


def _typed_name_matches(typed: str, expected: str) -> None:
	"""A typed name stands as a signature, so it has to be their own."""
	if not typed:
		frappe.throw(_("Type your full name to sign."))
	if typed.casefold() != (expected or "").strip().casefold():
		frappe.throw(_("Type your name exactly as it appears on the offer: {0}").format(expected))


@frappe.whitelist()
def sign_offer(name: str, signed_name: str):
	"""One cluster member signs the group's Letter of Offer.

	Every active member signs the same agreement, and the agreement is not
	executed until the last of them has. That is what the head choosing a
	cluster application asked for: one facility, and every member a party to
	it rather than a name on somebody else's paperwork.

	The line is filled by `db_set` on a child row that already exists, which
	is why a submitted offer can be signed at all — nothing is inserted into,
	or removed from, a submitted document.
	"""
	user = _session_user()
	offer = _respond(name, user)

	row = _my_signature(name, user)
	if not row:
		frappe.throw(_("You are not a party to this offer."), frappe.PermissionError)
	if row.signature_status == "Signed":
		frappe.throw(_("You have already signed this offer."))
	if row.signature_status == "Declined":
		frappe.throw(_("You have already declined this offer."))

	typed = (signed_name or "").strip()
	_typed_name_matches(typed, row.member_name)

	with _as_system():
		frappe.db.set_value(
			"GDB Offer Signature",
			row.name,
			{"signature_status": "Signed", "signed_name": typed, "signed_on": now_datetime()},
			update_modified=False,
		)
		state = _execution_state(name)
		# The LAST signature is what executes the agreement. Until then the
		# offer stays Issued, so `api.book_loan` — which asks only for an
		# accepted offer — cannot book a facility the group has not finished
		# agreeing to.
		if state["complete"]:
			offer.db_set("status", "Accepted")
			offer.db_set("accepted_name", typed)
			offer.db_set("responded_on", now_datetime())
			from gdb_bank.conditions import raise_for_offer

			raise_for_offer(offer)
		frappe.db.commit()

	_logger().info(
		f"offer {name} signed by {user} ({state['signed']}/{state['total']})"
		+ (" — executed" if state["complete"] else "")
	)
	return _offer_dict(
		frappe.db.get_value("GDB Loan Offer", name, OFFER_FIELDS, as_dict=True), user
	)


@frappe.whitelist()
def accept_offer(name: str, accepted_name: str):
	"""Applicant accepts. This is the moment the agreement is executed."""
	user = _session_user()

	# A cluster offer is signed line by line, and for the head "accepting" IS
	# signing their line. Delegating rather than refusing keeps a client that
	# only knows about acceptance working, and keeps one implementation of
	# what a signature does.
	if _execution_state(name)["joint"]:
		return sign_offer(name, accepted_name)

	offer = _respond(name, user)

	typed = (accepted_name or "").strip()
	if not typed:
		frappe.throw(_("Type your full name to accept this offer."))
	_typed_name_matches(typed, offer.applicant_name)

	with _as_system():
		offer.db_set("status", "Accepted")
		offer.db_set("accepted_name", typed)
		offer.db_set("responded_on", now_datetime())
		# Acceptance is what turns the offer's stated conditions into a
		# checklist someone has to work through. Raised from the offer's own
		# wording so the two can never disagree.
		from gdb_bank.conditions import raise_for_offer

		raise_for_offer(offer)
		frappe.db.commit()

	_logger().info(f"offer {offer.name} accepted by {user}")
	return _offer_dict(
		frappe.db.get_value("GDB Loan Offer", offer.name, OFFER_FIELDS, as_dict=True), user
	)


@frappe.whitelist()
def decline_offer(name: str, reason: str | None = None):
	"""Applicant declines. The reason is kept — it is programme feedback."""
	user = _session_user()
	offer = _respond(name, user)
	reason = (reason or "").strip()

	with _as_system():
		# On a cluster offer the refusal is recorded against the member who
		# refused, and it ends the offer: the terms were agreed for the group
		# as it stood, so the Bank re-issues to whoever is actually willing
		# rather than holding a part-signed agreement open.
		row = _my_signature(name, user)
		if row:
			frappe.db.set_value(
				"GDB Offer Signature",
				row.name,
				{
					"signature_status": "Declined",
					"signed_on": now_datetime(),
					"declined_reason": reason,
				},
				update_modified=False,
			)
			reason = _("Declined by {0}: {1}").format(row.member_name, reason or _("no reason given"))

		offer.db_set("status", "Declined")
		offer.db_set("decline_reason", reason)
		offer.db_set("responded_on", now_datetime())
		frappe.db.commit()

	_logger().info(f"offer {offer.name} declined by {user}")
	return _offer_dict(
		frappe.db.get_value("GDB Loan Offer", offer.name, OFFER_FIELDS, as_dict=True), user
	)


def accepted_offer(application: str):
	"""The executed agreement for an application, if there is one.

	`api.book_loan` calls this: no accepted offer, no loan.
	"""
	return frappe.db.get_value(
		"GDB Loan Offer",
		{"application": application, "status": "Accepted", "docstatus": 1},
		["name", "offered_amount", "term_months"],
		as_dict=True,
	)
