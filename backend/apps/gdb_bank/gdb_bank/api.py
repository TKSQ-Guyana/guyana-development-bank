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
from gdb_bank.security.assist import officer_for, subject_for
from gdb_bank.security.conflict import is_same_person
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
	_require_facilitator,
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
from gdb_bank.services.user import _get_or_create_customer

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
	product: str | None = None,
	pending: str | None = None,
	acting: str | None = None,
):
	"""Create or update the applicant's own DRAFT application.

	`product` is `standard` (the default) or `quick` — the informal traders'
	loan, which asks sections.trade_* instead of a business stage and sections B-H.

	`acting` is a GDB Assist Consent: a Field Officer filling the applicant's
	draft with them (security/assist.py). The draft stays the applicant's, and
	records the officer as having assisted.
	"""
	return application_service.save_application(
		subject_for(acting),
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
		product=product,
		pending=pending,
		assisted_by=officer_for(acting),
	)


@frappe.whitelist()
def my_loan_eligibility(acting: str | None = None):
	"""Per product, whether this citizen may start an application now — one
	SME Loan and one Quick Loan at a time, each cleared before the next."""
	from gdb_bank.services import eligibility

	return eligibility.summary(subject_for(acting))


@frappe.whitelist()
def submit_application(name: str, accept_terms=None, credit_check_consent=None):
	"""Put a draft before the Bank. Evidence is EXPECTED but never blocking.

	A Quick Loan also needs `accept_terms` — it has no Letter of Offer to sign —
	and `credit_check_consent`, both recorded with the time.
	"""
	return application_service.submit_application(
		_session_user(), name, accept_terms=accept_terms, credit_check_consent=credit_check_consent
	)


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
	product: str | None = None,
	accept_terms=None,
	credit_check_consent=None,
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
		product=product,
		accept_terms=accept_terms,
		credit_check_consent=credit_check_consent,
	)


@frappe.whitelist()
def my_loans():
	"""The logged-in citizen's applications, newest first."""
	return application_service.my_loans(_session_user())


@frappe.whitelist()
def loan_detail(name: str, acting: str | None = None):
	return application_service.loan_detail(subject_for(acting), name)


# --------------------------------------------------------------------------
# Underwriting — the rules live in services/underwriting.py
# --------------------------------------------------------------------------


@frappe.whitelist()
def all_loans(
	status: str | None = None,
	stage: str | None = None,
	queue: str | None = None,
	sort: str | None = None,
	start=0,
	page_length=None,
	search: str | None = None,
	product: str | None = None,
	business_stage: str | None = None,
	evidence: str | None = None,
	min_amount=None,
	max_amount=None,
	from_date: str | None = None,
	to_date: str | None = None,
):
	"""One page of the Bank's queue, with the counts for the whole of it.

	Any staff role may read it; only review_loan decides. `stage` filters the
	review queue, `queue` picks one of the disbursement officer's lists.
	"""
	_require_staff()
	return underwriting_service.all_loans(
		status,
		stage,
		queue,
		sort,
		start,
		page_length,
		search=search,
		product=product,
		business_stage=business_stage,
		evidence=evidence,
		min_amount=min_amount,
		max_amount=max_amount,
		from_date=from_date,
		to_date=to_date,
	)


@frappe.whitelist()
def review_loan(name: str, action: str, remarks: str | None = None):
	"""Underwriter decision on an application: approve | reject."""
	return underwriting_service.review_loan(_require_underwriter(), name, action, remarks)


@frappe.whitelist()
def convert_lead(lead: str, cluster: str | None = None, purpose: str | None = None):
	return underwriting_service.convert_lead(_require_underwriter(), lead, cluster, purpose)


# --------------------------------------------------------------------------
# Clusters — the rules live in services/cluster.py
#
# Formed and run by a GDB facilitator (`_require_facilitator`, then
# cluster._require_facilitator_of for the group itself). Citizens only answer
# invitations and read the groups they have joined.
# --------------------------------------------------------------------------


@frappe.whitelist()
def create_cluster(
	cluster_name: str,
	region: str | None = None,
	sector: str | None = None,
	group_purpose: str | None = None,
	locality: str | None = None,
	is_registered: str | None = None,
):
	return cluster_service.create_cluster(
		_require_facilitator(),
		cluster_name,
		region=region,
		sector=sector,
		group_purpose=group_purpose,
		locality=locality,
		is_registered=is_registered,
	)


@frappe.whitelist()
def invite_member(eid: str, full_name: str | None = None, cluster: str | None = None):
	return cluster_service.invite_member(_require_facilitator(), eid, full_name=full_name, cluster=cluster)


@frappe.whitelist()
def remove_member(eid: str | None = None, member: str | None = None, cluster: str | None = None):
	"""The facilitator withdraws an invitation, or removes a member who joined.

	A withdrawn invitation is deleted (nothing had happened); a member who
	joined is marked Exited and kept, because they are part of the group's
	history. Refused while that member still owes a signature on a live offer.
	"""
	return cluster_service.remove_member(
		_require_facilitator(), eid=eid, member=member, cluster=cluster
	)


@frappe.whitelist()
def set_cluster_head(cluster: str, eid: str):
	"""Name the accepted member the group's application is filed for."""
	return cluster_service.set_head(_require_facilitator(), cluster, eid)


@frappe.whitelist()
def save_group_application(
	cluster: str,
	loan_amount,
	purpose: str,
	term_months,
	sections=None,
	name: str | None = None,
):
	"""The facilitator's draft of the group's application, in the head's name."""
	return application_service.save_group_application(
		_require_facilitator(), cluster, loan_amount, purpose, term_months, sections=sections, name=name
	)


@frappe.whitelist()
def submit_group_application(cluster: str, name: str):
	return application_service.submit_group_application(_require_facilitator(), cluster, name)


@frappe.whitelist()
def discard_group_application(cluster: str, name: str):
	return application_service.discard_group_application(_require_facilitator(), cluster, name)


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
def save_cluster_plan(cluster: str, **sections):
	return cluster_service.save_cluster_plan(_require_facilitator(), cluster, sections)


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
		_require_facilitator(),
		cluster,
		region=region,
		sector=sector,
		group_purpose=group_purpose,
		locality=locality,
		is_registered=is_registered,
	)


@frappe.whitelist()
@rate_limit(limit=40, seconds=60 * 5)
def lookup_eid(eid: str):
	"""Rate-limited per caller: a name-for-a-number endpoint is otherwise a directory."""
	return cluster_service.lookup_eid(_session_user(), eid)


# --------------------------------------------------------------------------
# The loan account a borrower sees once the application is booked
# --------------------------------------------------------------------------


@frappe.whitelist()
def loan_account(application: str, from_date: str | None = None, to_date: str | None = None):
	"""Booked loan, repayment schedule and what is left to pay.

	Returns loan: None while the application is still with the underwriter.
	With from_date and to_date it also answers `statement`: lending's Loan
	Statement of Account for this loan cut to that period (the balance before
	it, every disbursement and payment in it, the balance after it), and the
	schedule rows falling due in it.
	"""
	return application_service.loan_account(
		_session_user(), application, from_date=from_date, to_date=to_date
	)


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
	"repayment_periods",
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

	# On a GROUP application, "accepted" is not enough. The offer's status is a
	# single boolean and one person can set it — an offer carrying no signature
	# lines is read as an individual one, so the head executes the group's
	# agreement alone. Re-derived here from the signatures themselves rather
	# than trusted from the flag.
	from gdb_bank.offers import group_consent_missing

	unsigned = group_consent_missing(application)
	if unsigned:
		frappe.throw(unsigned)

	# Booked on the OFFER's amount and term, not the application's: those two are
	# the inputs lending is given, and every figure after this — the drawable
	# ceiling, the schedule, the instalment — is lending's own arithmetic on them.
	#
	# lending guards its own mapper with has_permission("Loan", "create"), a
	# permission no portal role holds. Who may ask has been settled above, so
	# the write runs as the system — the same shape as make_repayment.
	from gdb_bank.services.disbursement import create_loan_on_offer

	with _as_system():
		loan = create_loan_on_offer(application, agreement)
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
	# Both checks compare PEOPLE, not accounts (security/conflict.py): staff sign
	# in with a work email and citizens with their e-ID, so one person can hold
	# two accounts, and an account-name comparison alone would miss them.
	if decision and is_same_person(user, decision.gdb_reviewed_by):
		_logger().warning(f"four-eyes: {user} approved {application} and tried to release it")
		frappe.throw(
			_("You approved this application, so you cannot release its funds. "
			  "Another officer must disburse it."),
			frappe.PermissionError,
		)
	# The same principle one step further out: an officer must not pay
	# themselves, whatever roles they hold.
	if decision and is_same_person(user, decision.gdb_owner):
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

	# lending's drawable ceiling is only as good as the amount it was booked at.
	# A Loan booked on the requested amount rather than the executed offer would
	# let lending release more than the borrower agreed to, so it is refused
	# until it is rebooked. An equality check, not a calculation.
	from gdb_bank.offers import accepted_offer
	from gdb_bank.services.disbursement import offer_mismatch

	mismatch = offer_mismatch(loan, accepted_offer(application))
	if mismatch:
		frappe.throw(mismatch)

	from lending.loan_management.doctype.loan_disbursement.loan_disbursement import (
		get_disbursal_amount,
	)


	# Checked AGAIN here, not only at booking. Release is the last point at
	# which GDB can still decline to move money, and the specification asks for
	# authorizations to be re-derived at exactly this moment rather than
	# inherited from a check made earlier against state that has since changed.
	# A loan booked before this gate existed would otherwise keep drawing down.
	from gdb_bank.offers import group_consent_missing

	unsigned = group_consent_missing(application)
	if unsigned:
		frappe.throw(unsigned)

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

	from gdb_bank.services.disbursement import release_funds

	with _as_system() as caller:
		amount = flt(amount) if amount else flt(get_disbursal_amount(loan.name)[0])
		if amount <= 0:
			frappe.throw(
				_("Nothing is available to disburse on {0} right now.").format(loan.name)
			)
		doc = release_funds(loan, amount, caller)
		frappe.db.commit()

	_logger().info(f"disbursement {doc.name}: {amount} on {loan.name} by {user}")
	return loan_account(application)


@frappe.whitelist()
def sme_loan_terms():
	"""The SME Direct Loan's ceiling, longest term and rate, as the server will
	enforce them — read off the standard Loan Product, which lending refuses
	past. Any signed-in user; nothing here is private."""
	from gdb_bank.install import LOAN_PRODUCT_NAME
	from gdb_bank.utils import policy

	_session_user()
	product = frappe.db.get_value(
		"Loan Product",
		{"product_name": LOAN_PRODUCT_NAME},
		["maximum_loan_amount", "rate_of_interest"],
		as_dict=True,
	)
	return {
		"ceiling": flt(product.maximum_loan_amount) if product else policy.sme_loan_ceiling(),
		"min_term": policy.sme_term_bounds()[0],
		"max_term": policy.sme_term_bounds()[1],
		"moratorium_options": policy.moratorium_options(),
		"rate_of_interest": flt(product.rate_of_interest) if product else policy.rate_of_interest(),
	}


@frappe.whitelist()
def quick_loan_terms():
	"""The Quick Loan's ceiling, longest term, rate and closed answers, as the
	server will enforce them. Any signed-in user; nothing here is private."""
	from gdb_bank.services import quick_loan

	_session_user()
	return quick_loan.terms()


@frappe.whitelist(methods=["POST"])
def request_field_officer(
	applicant_name: str,
	phone: str,
	business_type: str,
	region: str,
	best_time: str | None = None,
	product: str | None = None,
):
	"""Ask a GDB field officer to call and help the caller apply. It lands in the
	pool of the region given (services/field_operations)."""
	from gdb_bank.services import quick_loan

	return quick_loan.request_field_officer(
		_session_user(), applicant_name, phone, business_type, region, best_time, product
	)


@frappe.whitelist()
def my_field_officer_request():
	"""The caller's latest field officer request, or None."""
	from gdb_bank.services import quick_loan

	return quick_loan.my_field_officer_request(_session_user())


@frappe.whitelist(methods=["POST"])
def cancel_field_officer_request(name: str):
	"""Cancel the caller's own waiting request."""
	from gdb_bank.services import quick_loan

	return quick_loan.cancel_field_officer_request(_session_user(), name)


@frappe.whitelist()
def decide_quick_loan(application: str, action: str | None = None, remarks: str | None = None):
	"""RETIRED 2026-10-02. A Quick Loan follows the same road as every GDB loan:
	review_loan, a Letter of Offer the borrower signs, then book_loan and
	disburse_loan by a different officer. Kept so an old client is told why,
	rather than answered with "method not found"."""
	frappe.throw(
		_(
			"Quick Loans now follow the standard process: approve the application, issue the "
			"Letter of Offer, and once the borrower has signed, a Disbursement Officer books and pays."
		)
	)


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
	# Checking or Savings — ERPNext's Bank Account Type (install.BANK_ACCOUNT_TYPES).
	"account_type",
	"gdb_bank_branch",
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
	return frappe.get_all("Bank", filters={"gdb_enabled": 1}, fields=["name"], order_by="name asc", pluck="name")


@frappe.whitelist()
def bank_branches(bank: str):
	"""A bank's branches, as the payout form lists them."""
	_session_user()
	return frappe.get_all(
		"GDB Bank Branch",
		filters={"bank": bank},
		fields=["name", "branch_name", "routing_number"],
		order_by="sort_order asc, branch_name asc",
	)


@frappe.whitelist()
def my_bank_details(acting: str | None = None):
	"""The nominated account for the logged-in citizen, or None."""
	user = subject_for(acting)
	customer = frappe.db.get_value("Customer", {"gdb_user": user})
	if not customer:
		return None
	row = frappe.db.get_value(
		"Bank Account", {"party_type": "Customer", "party": customer}, BANK_ACCOUNT_FIELDS, as_dict=True
	)
	return row or None


@frappe.whitelist()
def my_kyc_bank_account(acting: str | None = None):
	"""The bank account the KYC register holds for the signed-in person, in the
	payout form's terms — to offer as "use this account", or None.

	Found by the National ID they signed up with, else the one they declared
	on their profile. The bank and branch are matched
	to the portal's own lists; a bank GDB does not pay into is offered as
	unknown, and the form asks for another."""
	from gdb_bank.integrations import kyc_registry

	user = subject_for(acting)
	number = (
		frappe.db.get_value("User", user, "gdb_national_id")
		or frappe.db.get_value("GDB Citizen Profile", {"user": user}, "national_id")
		or frappe.db.get_value("User", user, "gdb_tin")
	)
	person = kyc_registry.lookup(number) if number else None
	if not person or not person.get("account_number"):
		return None

	register_bank = person["bank"]
	bank = frappe.db.get_value("Bank", {"name": register_bank, "gdb_enabled": 1}) or next(
		(
			b
			for b in frappe.get_all("Bank", filters={"gdb_enabled": 1}, pluck="name")
			if b.lower() == register_bank.lower()
		),
		None,
	)
	branch = None
	if bank and person["bank_branch"]:
		# The register writes "Republic Bank - Water Street"; the list, "Water Street".
		wanted = person["bank_branch"]
		if wanted.lower().startswith(register_bank.lower()):
			wanted = wanted[len(register_bank) :].lstrip(" -–").strip()
		for row in frappe.get_all(
			"GDB Bank Branch", filters={"bank": bank}, fields=["name", "branch_name", "routing_number"]
		):
			if row.branch_name.lower() == wanted.lower() or wanted.lower() in row.branch_name.lower():
				branch = row
				break
	account_type = person["account_type"].title() if person["account_type"].title() in ("Checking", "Savings") else ""
	number_digits = person["account_number"]
	_logger().info(f"kyc bank account offered to {user}")
	return {
		"bank": bank,
		"bank_on_register": register_bank,
		"bank_known": bool(bank),
		"branch": branch.name if branch else None,
		"branch_name": branch.branch_name if branch else person["bank_branch"],
		"routing_number": branch.routing_number if branch else None,
		"account_number": number_digits,
		"masked": f"••••{number_digits[-4:]}" if len(number_digits) >= 4 else number_digits,
		"holder": person["name_on_account"] or person["full_name"].title(),
		"account_type": account_type,
	}


@frappe.whitelist()
def save_bank_details(
	bank: str,
	bank_account_no: str,
	branch_code: str | None = None,
	account_name: str | None = None,
	acting: str | None = None,
	account_type: str | None = None,
	branch: str | None = None,
):
	"""Record (or update) where this citizen should be paid.

	One account per citizen: a second call replaces the first rather than
	adding another, so a payment run can never find two destinations for the
	same person and have to guess.

	`account_type` is Checking or Savings. Optional, because the SME form does
	not ask it; when given it must be one of the two.

	`branch` is a GDB Bank Branch of that bank; its routing number becomes the
	branch code. Without one, `branch_code` is recorded as typed.
	"""
	user = subject_for(acting)
	bank = (bank or "").strip()
	bank_account_no = (bank_account_no or "").strip()
	branch_code = (branch_code or "").strip()

	if not bank or not frappe.db.get_value("Bank", bank, "gdb_enabled"):
		frappe.throw(_("Choose a bank from the list."))
	branch = (branch or "").strip() or None
	if branch:
		row = frappe.db.get_value("GDB Bank Branch", branch, ["bank", "routing_number"], as_dict=True)
		if not row or row.bank != bank:
			frappe.throw(_("Choose a branch of {0}.").format(bank))
		branch_code = row.routing_number or ""
	branch_fields = {"gdb_bank_branch": branch} if branch else {}
	if not bank_account_no:
		frappe.throw(_("Account number is required."))
	if not bank_account_no.isdigit():
		frappe.throw(_("Account number should contain digits only."))
	from gdb_bank.install import BANK_ACCOUNT_TYPES

	account_type = (account_type or "").strip() or None
	if account_type and account_type not in BANK_ACCOUNT_TYPES:
		frappe.throw(_("Choose Checking or Savings."))

	customer = _get_or_create_customer(user)
	full_name = frappe.utils.get_fullname(user)
	# The name as the applicant says their bank holds it. Recorded as given; the
	# check below still compares the account against the person signed in.
	holder = (account_name or "").strip() or full_name

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
					"account_name": holder,
					**({"account_type": account_type} if account_type else {}),
					**branch_fields,
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
					"account_name": holder,
					"bank": bank,
					"party_type": "Customer",
					"party": customer,
					"bank_account_no": bank_account_no,
					"branch_code": branch_code,
					"is_company_account": 0,
					**({"account_type": account_type} if account_type else {}),
					**branch_fields,
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
# docs/integrations/bank-account-verification.md. Until the switch is
# configured every check answers Unavailable, and `source` says so.
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
def my_bank_accounts(acting: str | None = None):
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
	user = subject_for(acting)
	eid = frappe.db.get_value("User", user, "gdb_eid")
	if not eid:
		return []

	from gdb_bank.integrations import bank_registry

	found = bank_registry.accounts_for(eid)
	# Only banks GDB can actually pay. An account at a bank with no Bank record
	# cannot be saved as a destination, so offering it is offering a dead end.
	known = set(frappe.get_all("Bank", pluck="name"))
	usable = [row for row in found if row.get("bank") in known]
	_logger().info(f"bank registry search for {user}: {len(found)} found, {len(usable)} payable")
	return usable


@frappe.whitelist()
def verify_bank_account(bank: str, bank_account_no: str, acting: str | None = None):
	"""Check one account: does it exist, and is it in this person's name?

	For the manual path. The result is advisory here — it is recorded, shown,
	and never used to block an application, because a bank holding a maiden
	name is a case for a human, not a dead end on a form.
	"""
	user = subject_for(acting)

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
# DCRA is the ONLY source for a business. The adapter
# (gdb_bank/integrations/dcra.py) answers from the registry or says
# Unavailable; nothing is recalled from GDB's own earlier filings, because a
# remembered name beside a registration number reads as a confirmation it is
# not.
# --------------------------------------------------------------------------


@frappe.whitelist()
def dcra_lookup(dcra_number: str, acting: str | None = None):
	"""Resolve a DCRA registration number to a business.

	The registry is the authority and the only one asked. `source` on the reply
	is `dcra` when it answered and `unavailable` when it could not.
	"""
	user = subject_for(acting)
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


@frappe.whitelist()
def my_businesses(acting: str | None = None):
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
	user = subject_for(acting)
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
