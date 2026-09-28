"""Whitelisted REST endpoints for the GDB citizen portal.

All endpoints are called as POST /api/method/gdb_bank.api.<name> with a JSON
body. Authentication is the standard Frappe session cookie obtained from
POST /api/method/login.

Storage is the official frappe/lending app's **Loan Application** doctype;
this module maps the stable portal contract (loan_amount, purpose,
term_months, monthly_income, phone, status Submitted/Approved/Rejected) onto
it. Portal-only facts live in gdb_* custom fields (see install.CUSTOM_FIELDS).
"""

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import flt, now_datetime, nowdate

# The citizen-portal business logic now lives in services/, over a shared utils/
# foundation (api -> services -> utils, one way). api.py keeps every
# @frappe.whitelist() name so the URLs never move, and re-imports the helpers
# below so `from gdb_bank.api import X` keeps resolving for the sibling modules
# (collections, conditions, documents, identity, offers, permissions, profiles,
# rules) that already import them from here.
from gdb_bank.utils.constants import (  # noqa: F401  (re-exported for siblings)
	LOAN_FIELDS,
	STAFF_ROLES,
	STATUS_FROM_PORTAL,
	STATUS_TO_PORTAL,
)
from gdb_bank.utils.formatters import _portal_dict, _stage_context
from gdb_bank.utils.session import (  # noqa: F401  (re-exported for siblings)
	_as_system,
	_eids,
	_is_disbursement,
	_is_finance,
	_is_staff,
	_is_underwriter,
	_logger,
	_require_disbursement,
	_require_finance,
	_require_staff,
	_require_underwriter,
	_session_user,
)
from gdb_bank.services import (
	application as application_service,
	cluster as cluster_service,
	finance as finance_service,
	underwriting as underwriting_service,
	user as user_service,
)
# Re-exported for siblings; _get_or_create_customer is also used by save_bank_details.
from gdb_bank.services.application import _readable_application  # noqa: F401
from gdb_bank.services.finance import repayment_plan  # noqa: F401
from gdb_bank.services.user import _get_or_create_customer

@frappe.whitelist(allow_guest=True)
def signup(full_name: str, email: str, password: str):
	"""Citizen self-registration: creates a Website User with the Citizen role."""
	return user_service.signup(full_name, email, password)


@frappe.whitelist()
def whoami():
	return user_service.whoami(_session_user())


@frappe.whitelist()
def save_application(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
	name: str | None = None,
):
	"""Create or update the applicant's own DRAFT application."""
	return application_service.save_application(
		_session_user(),
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
		name=name,
	)


@frappe.whitelist()
def submit_application(name: str):
	"""Put a draft before the Bank. Evidence is EXPECTED but never blocking."""
	return application_service.submit_application(_session_user(), name)


@frappe.whitelist()
def discard_application(name: str):
	"""Abandon a draft. Only ever a draft — once submitted it is the Bank record
	of what was asked for, and withdrawal is a decision rather than a delete."""
	return application_service.discard_application(_session_user(), name)


@frappe.whitelist()
def apply_loan(
	loan_amount,
	purpose: str,
	term_months,
	monthly_income=None,
	phone: str | None = None,
	cluster: str | None = None,
	business_stage: str | None = None,
	dcra_number: str | None = None,
	business_name: str | None = None,
	sections=None,
):
	"""Save and submit in one call, for an applicant with evidence already filed.

	Kept because it is the published contract (docs/openapi.yaml, the Postman
	collection). It is the two steps back to back, gate included: it cannot
	submit what save_application would not have saved.
	"""
	return application_service.apply_loan(
		_session_user(),
		loan_amount,
		purpose,
		term_months,
		monthly_income=monthly_income,
		phone=phone,
		cluster=cluster,
		business_stage=business_stage,
		dcra_number=dcra_number,
		business_name=business_name,
		sections=sections,
	)


@frappe.whitelist()
def my_loans():
	"""The logged-in citizen's applications, newest first."""
	return application_service.my_loans(_session_user())


@frappe.whitelist()
def loan_detail(name: str):
	return application_service.loan_detail(_session_user(), name)


# --------------------------------------------------------------------------
# Underwriting — the rules live in services/underwriting.py
# --------------------------------------------------------------------------


@frappe.whitelist()
def all_loans(status: str | None = None):
	"""The Bank's review queue. Any staff role may read it; only review_loan decides."""
	_require_staff()
	return underwriting_service.all_loans(status)


@frappe.whitelist()
def review_loan(name: str, action: str, remarks: str | None = None):
	"""Underwriter decision on an application: approve | reject."""
	return underwriting_service.review_loan(_require_underwriter(), name, action, remarks)


@frappe.whitelist()
def convert_lead(lead: str, cluster: str | None = None, purpose: str | None = None):
	return underwriting_service.convert_lead(_require_underwriter(), lead, cluster, purpose)


# --------------------------------------------------------------------------
# Clusters — the rules live in services/cluster.py
# --------------------------------------------------------------------------


@frappe.whitelist()
def create_cluster(
	cluster_name: str,
	region: str | None = None,
	sector: str | None = None,
	loan_purpose: str | None = None,
	business_plan: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
	facilitator_eid: str | None = None,
	facilitator_requested: int | None = None,
):
	return cluster_service.create_cluster(
		_session_user(),
		cluster_name,
		region=region,
		sector=sector,
		loan_purpose=loan_purpose,
		business_plan=business_plan,
		group_purpose=group_purpose,
		locality=locality,
		is_registered=is_registered,
		facilitator_eid=facilitator_eid,
		facilitator_requested=facilitator_requested,
	)


@frappe.whitelist()
def invite_member(eid: str, full_name: str | None = None, cluster: str | None = None):
	return cluster_service.invite_member(_session_user(), eid, full_name=full_name, cluster=cluster)


@frappe.whitelist()
def my_invitations():
	return cluster_service.my_invitations(_session_user())


@frappe.whitelist()
def respond_to_invitation(cluster: str, accept=1):
	return cluster_service.respond_to_invitation(_session_user(), cluster, accept=accept)


@frappe.whitelist()
def my_cluster():
	return cluster_service.my_cluster(_session_user())


@frappe.whitelist()
def my_clusters():
	return cluster_service.my_clusters(_session_user())


@frappe.whitelist()
def cluster_view(cluster: str):
	return cluster_service.cluster_view(_session_user(), cluster)


@frappe.whitelist()
def save_plan(
	loan_purpose: str | None = None,
	business_plan: str | None = None,
	cluster: str | None = None,
):
	return cluster_service.save_plan(
		_session_user(), loan_purpose=loan_purpose, business_plan=business_plan, cluster=cluster
	)


@frappe.whitelist()
def save_cluster_plan(cluster: str, **sections):
	return cluster_service.save_cluster_plan(_session_user(), cluster, sections)


@frappe.whitelist()
def save_cluster_details(
	cluster: str,
	region: str | None = None,
	sector: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
):
	return cluster_service.save_cluster_details(
		_session_user(),
		cluster,
		region=region,
		sector=sector,
		group_purpose=group_purpose,
		locality=locality,
		is_registered=is_registered,
	)


@frappe.whitelist()
def facilitators(region: str | None = None):
	_session_user()
	return cluster_service.facilitators(region)


@frappe.whitelist()
@rate_limit(limit=40, seconds=60 * 5)
def lookup_eid(eid: str):
	"""Rate-limited per caller: a name-for-a-number endpoint is otherwise a directory."""
	return cluster_service.lookup_eid(_session_user(), eid)


@frappe.whitelist()
def attach_facilitator(cluster: str, eid: str | None = None, requested: int | None = None):
	return cluster_service.attach_facilitator(_session_user(), cluster, eid=eid, requested=requested)


# --------------------------------------------------------------------------
# The loan account a borrower sees once the application is booked
# --------------------------------------------------------------------------


@frappe.whitelist()
def loan_account(application: str):
	"""Booked loan, repayment schedule and what is left to pay.

	Returns loan: None while the application is still with the underwriter.
	"""
	return application_service.loan_account(_session_user(), application)


@frappe.whitelist()
def make_repayment(application: str, amount):
	"""Record a repayment against the loan booked from this application.

	Any member of the cluster may pay the group's facility — the ledger records
	who made the payment, not only whose facility it is. GDB staff may not: see
	finance._may_repay.
	"""
	return finance_service.make_repayment(_session_user(), application, amount)


# --------------------------------------------------------------------------
# Booking and disbursement — the bank's side of an approved application
#
# Both steps are lending's own. `create_loan` is lending's mapper from a
# submitted Loan Application onto a Loan; disbursement is lending's Loan
# Disbursement doctype, whose submit is what generates the repayment schedule.
# Nothing here computes money: the schedule, the interest and the balances are
# lending's answer, exactly as they are in loan_account. What this module adds
# is who may ask, and when.
# --------------------------------------------------------------------------


BOOKED_LOAN_FIELDS = [
	"name",
	"status",
	"company",
	"applicant",
	"applicant_type",
	"loan_amount",
	"disbursed_amount",
]


def _booked_loan(application: str):
	"""The Loan booked from this application, if one exists yet."""
	return frappe.db.get_value(
		"Loan", {"loan_application": application}, BOOKED_LOAN_FIELDS, as_dict=True
	)


@frappe.whitelist()
def book_loan(application: str):
	"""Create the Loan for an approved application. DISBURSEMENT OFFICER ONLY.

	Booking is a decision the bank makes after approval, not a consequence of
	it — which is why this is a separate act with its own audit line rather
	than a hook on review_loan.

	It belongs to the disbursement officer rather than to the underwriter
	because booking is the first step on the money side: it puts a real Loan on
	GDB's books with its own schedule and its own GL entries, and everything
	after it is a drawdown. The officer who assessed the credit says whether
	GDB will lend; the officer who moves money says when the facility exists.
	Keeping the two in one pair of hands would make the four-eyes gate on
	disburse_loan the only thing standing between a decision and cash.
	"""
	user = _require_disbursement()

	row = frappe.db.get_value(
		"Loan Application", application, ["name", "status", "gdb_owner"], as_dict=True
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if row.status != "Approved":
		frappe.throw(
			_("Only an approved application can be booked ({0} is {1}).").format(
				application, STATUS_TO_PORTAL.get(row.status, row.status)
			)
		)

	existing = _booked_loan(application)
	if existing:
		frappe.throw(_("Loan {0} is already booked for {1}.").format(existing.name, application))

	# An approval is a credit decision; it does not bind either side. What puts
	# a borrower on GDB's books is their acceptance of the Letter of Offer, so
	# booking waits for the executed agreement rather than the decision.
	from gdb_bank.offers import accepted_offer

	agreement = accepted_offer(application)
	if not agreement:
		frappe.throw(
			_("No accepted offer for {0}. Issue a Letter of Offer and wait for the "
			  "applicant to accept it before booking.").format(application)
		)

	# lending guards its own mapper with has_permission("Loan", "create"), a
	# permission no portal role holds. Who may ask has been settled above, so
	# the write runs as the system — the same shape as make_repayment.
	from lending.loan_management.doctype.loan_application.loan_application import create_loan

	with _as_system():
		loan = create_loan(application, submit=1)
		frappe.db.commit()

	_logger().info(f"loan {loan.name} booked from {application} by {user}")
	return loan_account(application)


@frappe.whitelist()
def disburse_loan(application: str, amount=None):
	"""Release funds on a booked loan. DISBURSEMENT OFFICER ONLY, and never the
	person who approved it.

	TWO GATES, because one would not hold. The role gate says money movement
	belongs to the disbursement officer, not to the officer who assessed the
	credit and not to finance, who manages the books but never releases funds.
	The four-eyes gate below says that even a person holding both the deciding
	and releasing roles — which happens in a small bank, and which nothing
	stops an administrator from granting — cannot be both the decider and the
	releaser on the SAME case. Without the second gate the first is a naming
	convention: R-131 was proven end to end on this stack, one login carrying
	an application from decision to G$99,000,000 disbursed.

	Omit `amount` to disburse everything lending says is still drawable. Both
	the default and the ceiling are lending's: get_disbursal_amount decides what
	is available, validate_disbursal_amount rules on whatever is asked for, so
	neither number is computed here.
	"""
	user = _require_disbursement()

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
	# The same principle one step further out: an officer must not pay
	# themselves, whatever roles they hold.
	if decision and decision.gdb_owner == user:
		frappe.throw(
			_("You cannot release funds on your own application."), frappe.PermissionError
		)

	loan = _booked_loan(application)
	if not loan:
		frappe.throw(_("No loan has been booked for {0} yet.").format(application))
	if loan.status not in ("Sanctioned", "Partially Disbursed"):
		frappe.throw(
			_("Loan {0} is not awaiting disbursement (status {1}).").format(loan.name, loan.status)
		)

	from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
		get_disbursal_amount,
	)


	# Conditions precedent are not advice. The Letter of Offer says no funds
	# move until they are met, so release checks the checklist rather than
	# trusting that somebody looked.
	from gdb_bank.conditions import outstanding

	blocking = outstanding(application)
	if blocking:
		frappe.throw(
			_("{0} condition(s) precedent are still outstanding: {1}").format(
				len(blocking), "; ".join(blocking[:3])
			)
		)

	with _as_system() as caller:
		amount = flt(amount) if amount else flt(get_disbursal_amount(loan.name)[0])
		if amount <= 0:
			frappe.throw(
				_("Nothing is available to disburse on {0} right now.").format(loan.name)
			)
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
	return loan_account(application)


# --------------------------------------------------------------------------
# Where the money goes — the citizen's own bank account
#
# GDB pays out through the commercial banks citizens already hold accounts
# with, so a disbursement needs a destination and the applicant is the only
# one who knows it. This is ERPNext's stock Bank Account doctype, linked to
# the citizen's Customer by party — the same record ERPNext's Payment Order
# reads when a payment run is assembled. No doctype of our own, and nothing
# here formats a payment file: this only captures the destination.
#
# Citizens hold no permission on Bank or Bank Account (deliberately — the
# generic REST surface would expose every other citizen's account), so the
# portal brokers both the list of banks and the write.
# --------------------------------------------------------------------------

BANK_ACCOUNT_FIELDS = [
	"name",
	"bank",
	"bank_account_no",
	"branch_code",
	"account_name",
	# The verification check, recorded the way plan.md 6.1 asks every external
	# check to be recorded: result, source, timestamp, reference.
	"gdb_verification_status",
	"gdb_verification_source",
	"gdb_verified_on",
	"gdb_verification_reference",
]


@frappe.whitelist()
def bank_options():
	"""Banks a citizen may nominate. Names only — nothing else is theirs to see."""
	_session_user()
	return frappe.get_all("Bank", fields=["name"], order_by="name asc", pluck="name")


@frappe.whitelist()
def my_bank_details():
	"""The nominated account for the logged-in citizen, or None."""
	user = _session_user()
	customer = frappe.db.get_value("Customer", {"gdb_user": user})
	if not customer:
		return None
	row = frappe.db.get_value(
		"Bank Account", {"party_type": "Customer", "party": customer}, BANK_ACCOUNT_FIELDS, as_dict=True
	)
	return row or None


@frappe.whitelist()
def save_bank_details(bank: str, bank_account_no: str, branch_code: str | None = None):
	"""Record (or update) where this citizen should be paid.

	One account per citizen: a second call replaces the first rather than
	adding another, so a payment run can never find two destinations for the
	same person and have to guess.
	"""
	user = _session_user()
	bank = (bank or "").strip()
	bank_account_no = (bank_account_no or "").strip()
	branch_code = (branch_code or "").strip()

	if not bank or not frappe.db.exists("Bank", bank):
		frappe.throw(_("Choose a bank from the list."))
	if not bank_account_no:
		frappe.throw(_("Account number is required."))
	if not bank_account_no.isdigit():
		frappe.throw(_("Account number should contain digits only."))

	customer = _get_or_create_customer(user)
	full_name = frappe.utils.get_fullname(user)

	# Check the account before recording it, whether it was picked from the
	# switch or typed. Advisory, never a gate: a bank holding a maiden name is
	# a case for an underwriter, not a dead end on an application form. What
	# this does guarantee is that nobody downstream has to wonder whether the
	# destination was ever checked — the answer, including "we could not tell",
	# is on the record.
	from gdb_bank.integrations import bank_registry

	check = bank_registry.verify(bank, bank_account_no, full_name)
	verification = {
		"gdb_verification_status": _check_result(check),
		"gdb_verification_source": check.get("source"),
		"gdb_verified_on": frappe.utils.now_datetime(),
		"gdb_verification_reference": check.get("reference") or check.get("account_name"),
	}

	# Writing a Bank Account is a bank-side operation; the citizen has no
	# permission on the doctype, and this endpoint has already established
	# that they are only ever touching their own.
	with _as_system():
		existing = frappe.db.get_value(
			"Bank Account", {"party_type": "Customer", "party": customer}, "name"
		)
		if existing:
			doc = frappe.get_doc("Bank Account", existing)
			doc.update(
				{
					"bank": bank,
					"bank_account_no": bank_account_no,
					"branch_code": branch_code,
					**verification,
				}
			)
			doc.save()
		else:
			# Named for the person, never "<name> — <bank>": a citizen may switch
			# banks, and ERPNext derives the record id from this at creation and
			# never revisits it. A label naming the old bank next to a field
			# naming the new one is how a payment gets misrouted.
			doc = frappe.get_doc(
				{
					"doctype": "Bank Account",
					"account_name": full_name,
					"bank": bank,
					"party_type": "Customer",
					"party": customer,
					"bank_account_no": bank_account_no,
					"branch_code": branch_code,
					"is_company_account": 0,
					**verification,
				}
			)
			doc.insert()
		frappe.db.commit()

	_logger().info(
		f"bank details saved for {user}: {bank} {bank_registry.mask(bank_account_no)} -> "
		f"{verification['gdb_verification_status']} ({verification['gdb_verification_source']})"
	)
	return frappe.db.get_value("Bank Account", doc.name, BANK_ACCOUNT_FIELDS, as_dict=True)


# --------------------------------------------------------------------------
# Is that account real, and is it theirs?
#
# A typed account number proves nothing: a transposed digit and a relative's
# account look identical on a form, and a payment instruction to either is
# money GDB does not get back. So the destination is discovered rather than
# typed — the national payment switch is asked which accounts the applicant's
# e-ID holds, and they pick one.
#
# Adapter: gdb_bank/integrations/bank_registry.py, contract in
# docs/integrations/bank-account-verification.md. Sandbox until the switch
# exists, and `source` says which answered on every result.
# --------------------------------------------------------------------------


def _check_result(result: dict) -> str:
	"""The recorded outcome of one account check.

	Five outcomes, not two. `Unavailable` is a state of its own and never
	becomes a pass (plan.md 6.1); `Inactive Account` means the account is real
	and the name matches and it still cannot receive funds.
	"""
	status = (result or {}).get("status")
	if status in (None, "Unavailable"):
		return "Unavailable"
	if status == "Not Found":
		return "Not Found"
	if result.get("name_match") is False:
		return "Name Mismatch"
	if status != "Active":
		return "Inactive Account"
	return "Verified"


@frappe.whitelist()
def my_bank_accounts():
	"""Accounts the national payment switch says this citizen holds.

	The portal fills the payout destination from this rather than asking for a
	number, so what reaches a payment run is a destination the switch already
	said is in the applicant's own name.

	Keyed on the e-ID bound to the *user*, not the session: identity.py writes
	gdb_eid on first e-ID sign-in and it persists, so a later email login
	searches just the same. A user who has never signed in with an e-ID has
	none, so there is nothing to search on and they get the manual path — which
	`verify_bank_account` then checks.
	"""
	user = _session_user()
	eid = frappe.db.get_value("User", user, "gdb_eid")
	if not eid:
		return []

	from gdb_bank.integrations import bank_registry

	found = bank_registry.accounts_for(eid, frappe.utils.get_fullname(user))
	# Only banks GDB can actually pay. An account at a bank with no Bank record
	# cannot be saved as a destination, so offering it is offering a dead end.
	known = set(frappe.get_all("Bank", pluck="name"))
	usable = [row for row in found if row.get("bank") in known]
	_logger().info(f"bank registry search for {user}: {len(found)} found, {len(usable)} payable")
	return usable


@frappe.whitelist()
def verify_bank_account(bank: str, bank_account_no: str):
	"""Check one account: does it exist, and is it in this person's name?

	For the manual path. The result is advisory here — it is recorded, shown,
	and never used to block an application, because a bank holding a maiden
	name is a case for a human, not a dead end on a form.
	"""
	user = _session_user()

	from gdb_bank.integrations import bank_registry

	result = bank_registry.verify(bank, bank_account_no, frappe.utils.get_fullname(user))
	result["result"] = _check_result(result)
	_logger().info(
		f"bank verify for {user}: {bank} {bank_registry.mask(bank_account_no)} -> "
		f"{result['result']} (source={result.get('source')})"
	)
	return result


# --------------------------------------------------------------------------
# DCRA — the applicant's registered business
#
# The Deeds and Commercial Registries Authority is where a Guyanese business
# is registered, so a DCRA number is the strongest evidence an underwriter has
# that a development loan is going to a real trading concern rather than a
# name on a form.
#
# There is no DCRA API wired up. `dcra_lookup` therefore answers from what GDB
# already knows — a returning applicant's own earlier filings — and returns
# `source` so the caller can tell a confirmed registry hit from a recalled
# one. When DCRA exposes a service, it slots in at the marked seam and the
# portal contract does not change.
# --------------------------------------------------------------------------


def _dcra_from_history(dcra_number: str, user: str | None = None) -> dict | None:
	"""The most recent application carrying this registration number."""
	filters = {"gdb_dcra_number": dcra_number}
	if user:
		filters["gdb_owner"] = user
	rows = frappe.get_all(
		"Loan Application",
		filters=filters,
		fields=["gdb_dcra_number", "gdb_business_name", "creation"],
		order_by="creation desc",
		limit=1,
	)
	return rows[0] if rows else None


@frappe.whitelist()
def dcra_lookup(dcra_number: str):
	"""Resolve a DCRA registration number to a business.

	The registry is the authority, so this asks DCRA first through the adapter
	in gdb_bank.integrations.dcra. GDB's own earlier filings are consulted only
	when the registry has nothing to say, and the reply always states which of
	the two answered so nothing recalled is mistaken for something verified.
	"""
	user = _session_user()
	from gdb_bank.integrations import dcra

	number = dcra.normalize(dcra_number)
	if not number:
		frappe.throw(_("Enter a DCRA registration number."))

	result = dcra.lookup(number)
	if result.get("business_name"):
		# A number that resolves is not the same as it being the caller's own —
		# say so rather than let a correct lookup read as confirmed ownership.
		eid = frappe.db.get_value("User", user, "gdb_eid")
		result["owned_by_caller"] = dcra.owned_by(result, eid) if eid else None
		_logger().info(f"dcra lookup {number} -> {result.get('source')} ({result.get('status')})")
		return result

	# Registry silent. Fall back to what this citizen told GDB before, clearly
	# labelled — a remembered name is a convenience, never evidence.
	row = _dcra_from_history(number, user=user)
	if row:
		return {
			"registration_number": number,
			"business_name": row.gdb_business_name,
			"status": result.get("status"),
			"source": "gdb_history",
			"last_seen": row.creation,
		}
	return result


@frappe.whitelist()
def my_businesses():
	"""Businesses DCRA says this applicant is a proprietor of.

	The applicant never types a registration number: they sign in as
	themselves, and the register says which businesses are theirs. That is
	both the convenience and the control — a business they do not own cannot
	appear in this list, so it cannot be claimed on an application. Matched
	on e-ID, not name: a name is free text that two registers can disagree on,
	the e-ID is the identifier this citizen actually signed in with. A citizen
	who has never signed in with an e-ID has none on file yet and gets no
	matches — the same "nothing found" fallback as anyone else.
	"""
	user = _session_user()
	from gdb_bank.integrations import dcra

	eid = frappe.db.get_value("User", user, "gdb_eid")
	found = dcra.businesses_for(eid) if eid else []
	_logger().info(f"dcra proprietor search for {user} (eid={eid}): {len(found)} business(es)")
	return found


@frappe.whitelist()
def my_business():
	"""The business this citizen last applied with, for prefilling the form."""
	user = _session_user()
	rows = frappe.get_all(
		"Loan Application",
		filters={"gdb_owner": user, "gdb_dcra_number": ["is", "set"]},
		fields=["gdb_dcra_number", "gdb_business_name", "creation"],
		order_by="creation desc",
		limit=1,
	)
	if not rows:
		return None
	return {
		"dcra_number": rows[0].gdb_dcra_number,
		"business_name": rows[0].gdb_business_name,
		"last_seen": rows[0].creation,
	}
