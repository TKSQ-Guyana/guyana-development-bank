"""Pure data shared across the portal: role sets, the lending<->portal status
and stage maps, the Loan Application field list and the sectioned-answer map.

No frappe request context and no internal gdb_bank imports beyond install (the
seed masters), so this module is safe to import from anywhere — utils, services
and api.py all read the same single source of truth for these values.
"""

from gdb_bank.install import APPLICATION_SECTIONS, LOAN_PRODUCT_NAME, QUICK_LOAN_PRODUCT_NAME

UNDERWRITER_ROLES = {"Loan Underwriter", "System Manager"}

# Reconciliation, the ledger, portfolio reporting and lending-rule proposals —
# manages the books and the rules, never a credit decision and never a release.
# Split out of what used to be one "Finance Officer" surface: FINANCE_ROLES is
# this half, DISBURSEMENT_ROLES below is the other. Kept as "Finance Officer"
# rather than renamed, so every existing grant on this role keeps working.
FINANCE_ROLES = {"Finance Officer", "System Manager"}

# Who may move money. Deliberately a different set from UNDERWRITER_ROLES and
# from FINANCE_ROLES: an underwriter decides a loan, a finance officer manages
# the books, and a disbursement officer pays it — three different questions,
# three different roles. "The releaser is not the decider" is enforced a second
# way in disburse_loan itself, which holds even for one person granted both.
DISBURSEMENT_ROLES = {"Disbursement Officer", "System Manager"}

# Every staff role the portal knows. Used where the question is "is this person
# the applicant or the bank", not "may they do this particular thing".
STAFF_ROLES = UNDERWRITER_ROLES | FINANCE_ROLES | DISBURSEMENT_ROLES

# Runs the platform: accounts, roles, the kill switch, system health and the
# integration settings. Deliberately NOT in STAFF_ROLES nor in any authority
# set above — the admin sees no case, decides no credit and moves no money, and
# that is enforced by every _require_* gate refusing this role, not by the SPA
# hiding buttons. System Manager is here for the same reason it is in every set
# above: it is the break-glass superuser (the known gap features.md records),
# not a persona anyone works as day to day.
PLATFORM_ADMIN_ROLE = "Platform Admin"
PLATFORM_ADMIN_ROLES = {PLATFORM_ADMIN_ROLE, "System Manager"}

# Forms a group, enrols its members, writes its plan and files the group's
# application in its head's name (services/cluster.py, services/application.py
# save_group_application). Deliberately NOT in STAFF_ROLES nor in any authority
# set above: a facilitator prepares a case and never reads the Bank's queue,
# decides credit or moves money. role_policy also refuses it alongside any other
# grantable role, so one account cannot both prepare a case and decide it.
FACILITATOR_ROLE = "Facilitator"
FACILITATOR_ROLES = {FACILITATOR_ROLE, "System Manager"}

# lending status <-> portal status (lending has no draft/review distinction:
# a fresh application is a submitted doc with status Open)
STATUS_TO_PORTAL = {"Open": "Submitted", "Approved": "Approved", "Rejected": "Rejected"}
STATUS_FROM_PORTAL = {v: k for k, v in STATUS_TO_PORTAL.items()}

# The journey the applicant is actually on, in order. `status` alone cannot
# express it: everything after the credit decision lives in other records —
# whether an offer was issued and accepted (GDB Loan Offer), whether the
# conditions precedent are worked off (GDB Loan Condition), and whether money
# has left the bank (lending's Loan). An applicant looking at "Approved" for
# three weeks while conditions are outstanding is being told nothing.
#
# Derived in formatters and handed to the portal as one field, rather than
# reassembled in the SPA: the client is a presentation layer, and three clients
# working out the same ladder from four record types would be three chances to
# disagree about what stage somebody's loan is at.
PORTAL_STAGES = ("Draft", "Review", "Approved", "Signing", "Disbursed")

# Customer-safe wording, per the programme spec's internal-state/applicant-
# wording map: the applicant is never shown a raw database value, and always
# sees the next thing that is true of their case.
STAGE_LABELS = {
	"Draft": "Not submitted yet",
	"Review": "GDB is reviewing your application",
	"Rejected": "Your application was not approved",
	"Approved": "Approved — your offer is being prepared",
	"Offer": "Your Letter of Offer is ready to sign",
	"Declined": "You declined this offer",
	"Expired": "This offer has expired",
	# Not "complete these items": the conditions precedent are GDB's own checks
	# and the applicant no longer sees the list, so a label telling them to
	# clear it would point at nothing. If GDB needs something from them, an
	# information request says so in its own words.
	"Conditions": "GDB is completing its final checks before release",
	"Release": "Payment is being arranged",
	"Disbursed": "Your loan is active",
}

LOAN_FIELDS = [
	"name",
	"loan_product",
	"gdb_terms_accepted_on",
	"gdb_credit_consent_on",
	"gdb_owner",
	"gdb_cluster",
	"gdb_business_stage",
	"gdb_dcra_number",
	"gdb_business_name",
	"applicant_name",
	"loan_amount",
	"gdb_purpose",
	"repayment_periods",
	"gdb_monthly_income",
	"applicant_phone_number",
	"status",
	"gdb_remarks",
	"gdb_reviewed_by",
	"gdb_reviewed_on",
	"rate_of_interest",
	"repayment_amount",
	"docstatus",
	"creation",
	"modified",
] + [f[0] for f in APPLICATION_SECTIONS]

# Portal key <-> Custom Field name. The portal contract drops the gdb_ prefix,
# so `sections.target_market` is `gdb_target_market` on the doctype.
SECTION_KEYS = {f[0][4:]: (f[0], f[2]) for f in APPLICATION_SECTIONS}

# Which section block belongs to which kind of business. Switching stage clears
# the other block rather than leaving a start-up carrying filed accounts, or a
# trading business carrying forecasts.
EXISTING_ONLY = (
	"gdb_annual_revenue",
	"gdb_cost_of_sales",
	"gdb_operating_expenses",
	"gdb_existing_obligations",
	"gdb_cash_position",
)
NEW_ONLY = (
	"gdb_expected_sales_volume",
	"gdb_projected_revenue",
	"gdb_projected_costs",
	"gdb_initial_costs",
	"gdb_expected_cash_position",
	"gdb_assumptions",
)

# The Quick Loan's own section, and everything it asks INSTEAD of. The same
# rule as the stage split above: switching product clears the other product's
# answers, so a market vendor is never decided on an SME's blank accounts and
# an SME never carries a stall's answers.
QUICK_ONLY = (
	"gdb_trade_activity",
	"gdb_trade_location",
	"gdb_trading_since",
	"gdb_trade_region",
	"gdb_youth_entrepreneur",
	"gdb_woman_entrepreneur",
)
SME_ONLY = tuple(f[0] for f in APPLICATION_SECTIONS if f[0] not in QUICK_ONLY)

# Portal product key -> the lending Loan Product it is filed on.
STANDARD_PRODUCT = "standard"
QUICK_PRODUCT = "quick"
PORTAL_PRODUCTS = {STANDARD_PRODUCT: LOAN_PRODUCT_NAME, QUICK_PRODUCT: QUICK_LOAN_PRODUCT_NAME}

# One person's own finances, declared on their GDB Citizen Profile. Asked of
# every individual on a group's case; staff read them from the cluster roster.
PERSONAL_FINANCIAL_MONEY = (
	"monthly_income",
	"other_monthly_income",
	"monthly_expenses",
	"monthly_loan_repayments",
	"total_debts",
	"savings",
)
PERSONAL_FINANCIAL_FIELDS = ("employment_status", *PERSONAL_FINANCIAL_MONEY, "dependents")
PERSONAL_FINANCIAL_REQUIRED = ("employment_status", "monthly_income", "monthly_expenses")

# Guyana. Applicants type their number the way they say it — 600 1234, or
# 592-600-1234 — and lending's applicant_phone_number is a Phone field, which
# Frappe refuses without a country code. The only country GDB lends in is the
# one whose code we can supply (see formatters._normalised_phone).
GUYANA_DIAL_CODE = "+592"

# The Loan a borrower sees once their application is booked.
LOAN_ACCOUNT_FIELDS = [
	"name",
	"status",
	"loan_amount",
	"disbursed_amount",
	"total_payment",
	"total_amount_paid",
	"total_principal_paid",
	"monthly_repayment_amount",
	"rate_of_interest",
	"repayment_periods",
	"company",
]
