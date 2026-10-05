import frappe

from gdb_bank.utils import policy

# (role_name, desk_access) — Citizen is a website-user role (no desk); the
# staff roles are system roles so GDB staff can also use the ERPNext desk.
#
# THE SPLIT IS THE POINT. An underwriter decides; a disbursement officer moves
# money. One account held both until now, and the consequence was demonstrable:
# a single login approved, offered, verified every condition, booked and
# disbursed G$99,000,000 with no second pair of eyes (R-127, R-131). The role
# boundary below is half the fix — api.disburse_loan carries the other half,
# because a person granted both roles would otherwise walk straight back
# through the gap.
#
# "Finance Officer" carried BOTH release and reporting/reconciliation/rule
# authority for a while. `Disbursement Officer` is that role split in two:
# release moves here, and "Finance Officer" narrows to the books — reading the
# ledger, reconciling receipts, portfolio reporting, and proposing (never
# deciding its own) lending-rule changes. patches/split_finance_roles.py grants
# every existing Finance Officer holder Disbursement Officer too, so nobody
# loses release access the day this ships; a fresh site starts the two apart.
#
# "Platform Admin" runs the platform — accounts, roles, the kill switch, health
# and integration settings — and is in none of the authority sets in
# utils/constants.py, so it can neither decide credit nor move money.
ROLES = (
	("Citizen", 0),
	("Loan Underwriter", 1),
	("Finance Officer", 1),
	("Disbursement Officer", 1),
	("Platform Admin", 1),
	# Forms groups and files their applications. Staff door, in no authority set.
	("Facilitator", 1),
	# Assists applicants and carries out field tasks. Staff door, in no authority set.
	("Field Officer", 1),
	# Works the appointment requests from the public site (services/appointments).
	# Staff door, in no authority set.
	("GDB Representative", 1),
)

# The banks a citizen may nominate for a payout — (name, enabled). Seeded,
# because the portal's payout destination is a Link to Bank and an empty list is
# an approved loan nobody can disburse. Bank of Guyana is held for GDB's own
# operating and collections accounts, disabled as a citizen destination.
BANKS = (
	("New Building Society", 1),
	("Bank of Guyana", 0),
	("Bank of Baroda", 1),
	("Citizen Bank", 1),
	("Demerara Bank", 1),
	("GBTI", 1),
	("Scotiabank", 1),
	("Republic Bank", 1),
)

# Names an earlier seed used. Kept — an account saved against one still links
# to it — but switched off, so nobody new is offered them.
RETIRED_BANKS = ("Citizens Bank Guyana", "Guyana Bank for Trade and Industry", "Republic Bank (Guyana)")

# Old names for a bank still in use: Scotiabank was seeded, and is still written
# in the KYC register, as "Nova Scotia". A Bank under an old name is renamed
# (its accounts and branches follow); a register row under one is matched to
# the current name (api.my_kyc_bank_account).
BANK_ALIASES = {"Nova Scotia": "Scotiabank", "Bank of Nova Scotia": "Scotiabank"}

# The banks the Help Desk helps an applicant without an account open one with —
# GDB's list as of 2026-10-04 (patches/set_facilitated_banks.py). After that the
# desk owns it: Bank > Facilitated for Applicants Without an Account.
# "Are you employed?" — the follow-up choices (2026-10-05).
EMPLOYER_CATEGORIES = ("Public Sector", "Private Sector")
INCOME_BANDS = ("Less than $200K", "Between $200K and $500K", "Above $500K")

FACILITATED_BANKS = ("GBTI", "Scotiabank", "Republic Bank", "Demerara Bank")

# Each bank's public site, linked from the facilitated-banks list. Seeded only
# where Bank.website is blank: after that it is the desk's.
BANK_WEBSITES = {
	"GBTI": "https://www.gbtibank.com",
	"Scotiabank": "https://www.scotiabank.com/gy/en.html",
	"Republic Bank": "https://republicguyana.com",
	"Demerara Bank": "https://www.demerarabank.com",
}

# Each bank's branches: (id, bank, branch, routing transit number, sort order).
# A payout's Bank Account carries the routing number as its branch code.
# The sectors an underwriter classifies a case under on the Credit risk tab:
# GDB's five priority sectors (the public site's), each with its sub-sectors.
# Seeded ONCE (ensure_sectors adds what is missing, never overwrites), so the
# desk's corrections to GDB Sector / GDB Sub Sector survive every migrate.
# GDB's industries (2026-10-05). No sub-sectors yet: the desk may add them
# (GDB Sub Sector), and a sub-sector is asked only of an industry that has some.
SECTORS = (
	("Fishing", ()),
	("Livestock", ()),
	("Rice", ()),
	("Other Crop", ()),
	("Poultry", ()),
	("Wholesale and Retail Trade", ()),
	("Transport and Storage", ()),
	("Tourism and Hospitality", ()),
	("Food Services", ()),
	("Logging and Lumber", ()),
	("Arts, Entertainment and Recreation", ()),
	("Manufacturing", ()),
)

# The five priority sectors the list began with. Switched off, never deleted:
# a case already classified under one still shows it.
RETIRED_SECTORS = (
	"Agriculture",
	"Tourism & hospitality",
	"Manufacturing",
	"Technology & services",
	"Orange & care economy",
)

BANK_BRANCHES = (
	('New Building Society - Any', 'New Building Society', 'Any', '', 0),
	('Citizen Bank - Main branch', 'Citizen Bank', 'Main branch', '10001007', 0),
	('Demerara Bank - Main branch', 'Demerara Bank', 'Main branch (South Road)', '1008', 0),
	('Bank of Baroda - Main branch', 'Bank of Baroda', 'Main branch', '60001002', 0),
	('Bank of Guyana - Main branch', 'Bank of Guyana', 'Main branch', '70001001', 0),
	('Bank of Baroda - Mon Repos', 'Bank of Baroda', 'Mon Repos', '40002002', 0),
	('Scotiabank - Bartica', 'Scotiabank', 'Bartica', '94805003', 0),
	('Scotiabank - New Amsterdam', 'Scotiabank', 'New Amsterdam', '14845003', 0),
	('Scotiabank - Parika Branch', 'Scotiabank', 'Parika Branch', '73155003', 0),
	('Scotiabank - Carmichael Street', 'Scotiabank', 'Carmichael Street', '30775003', 0),
	('Scotiabank - Robb Street', 'Scotiabank', 'Robb Street', '73015003', 0),
	('Demerara Bank - Mahaica', 'Demerara Bank', 'Mahaica', '50008008', 0),
	('Demerara Bank - Anna Regina', 'Demerara Bank', 'Anna Regina', '400', 0),
	('Demerara Bank - Rose Hall', 'Demerara Bank', 'Rose Hall', '80002008', 0),
	('Demerara Bank - Le Resouvenir', 'Demerara Bank', 'Le Resouvenir/Beterverwagting', '90006008', 0),
	('Demerara Bank - Diamond', 'Demerara Bank', 'Diamond', '10005008', 0),
	('Demerara Bank - Corriverton', 'Demerara Bank', 'Corriverton', '60003008', 0),
	('Demerara Bank - Leonora', 'Demerara Bank', 'Leonora', '30009008', 0),
	('Demerara Bank - Corporate Office', 'Demerara Bank', 'Corporate Office', '70007008', 10),
	('Citizen Bank - Essequibo Branch', 'Citizen Bank', 'Essequibo Branch', '6007', 0),
	('Citizen Bank - Thirst Park', 'Citizen Bank', 'Thirst Park', '50004007', 0),
	('Citizen Bank - Parika Branch', 'Citizen Bank', 'Parika Branch', '90002007', 0),
	('Citizen Bank - Bartica', 'Citizen Bank', 'Bartica', '70003007', 0),
	('Citizen Bank - New Amsterdam', 'Citizen Bank', 'New Amsterdam', '80007007', 0),
	('Citizen Bank - Linden', 'Citizen Bank', 'Linden', '20005007', 0),
	('GBTI - Water Street', 'GBTI', 'Water Street', '20001006', 0),
	('GBTI - Regent Street', 'GBTI', 'Regent Street', '80003006', 0),
	('GBTI - Vreed-en-Hoop Branch', 'GBTI', 'Vreed-en-Hoop Branch', '90007006', 0),
	('GBTI - Parika', 'GBTI', 'Parika', '10006006', 0),
	('GBTI - Lethem Branch', 'GBTI', 'Lethem Branch', '70008006', 0),
	('GBTI - Anna Regina', 'GBTI', 'Anna Regina', '30005006', 0),
	('GBTI - Diamond E.B.D', 'GBTI', 'Diamond E.B.D', '20015006', 0),
	('GBTI - Port Mourant, Corentyne', 'GBTI', 'Port Mourant, Corentyne', '70013006', 0),
	('GBTI - Bartica Branch', 'GBTI', 'Bartica Branch', '50014006', 0),
	('GBTI - Port Kaituman', 'GBTI', 'Port Kaituma', '90012006', 0),
	('GBTI - Corriverton Branch', 'GBTI', 'Corriverton Branch', '60004006', 0),
	('GBTI - Providence E.B.D', 'GBTI', 'Providence E.B.D', '50009006', 0),
	('GBTI - Mon Repos', 'GBTI', 'Mon Repos', '16006', 0),
	('GBTI - Kingston', 'GBTI', 'Kingston', '10011006', 0),
	('Republic Bank - New Market Street', 'Republic Bank', 'New Market Street', '80008005', 0),
	('Republic Bank - Corriverton Branch', 'Republic Bank', 'Corriverton Branch', '70004005', 0),
	('Republic Bank - Triumph Bank', 'Republic Bank', 'Triumph Bank', '60014005', 0),
	('Republic Bank - Diamond Branch', 'Republic Bank', 'Diamond Branch', '12005', 0),
	('Republic Bank - Lethem Branch', 'Republic Bank', 'Lethem Branch', '80013005', 0),
	('Republic Bank - Rose Hall', 'Republic Bank', 'Rose Hall / Williamsburg', '20006005', 0),
	('Republic Bank - New Amsterdam', 'Republic Bank', 'New Amsterdam', '40010005', 0),
	('Republic Bank - Vreed-en-Hoop Branch', 'Republic Bank', 'Vreed-en-Hoop Branch', '20011005', 0),
	('Republic Bank - Rosignol', 'Republic Bank', 'Rosignol', '7005', 0),
	('Republic Bank - Linden', 'Republic Bank', 'Linden', '40005005', 0),
	('Republic Bank - Anna Regina Branch', 'Republic Bank', 'Anna Regina Branch', '90003005', 0),
	('Republic Bank - Camp & Regent Streets', 'Republic Bank', 'Camp & Regent Streets', '10002005', 0),
	('Republic Bank - Water Street', 'Republic Bank', 'Water Street', '30001005', 0),
)

LOAN_PRODUCT_NAME = "GDB Standard Loan"
OFFSET_ORDER_TITLE = "GDB Standard Offset Order"

# The informal traders' product: market vendors and small services, with no
# TIN, no DCRA registration and no receipts. A second lending Loan Product
# rather than a mode of the first, so lending itself holds its ceiling
# (maximum_loan_amount, from utils/policy) and every downstream step — offer,
# booking, disbursement, repayment — already reads the product off the case.
QUICK_LOAN_PRODUCT_NAME = "GDB Quick Loan"
QUICK_LOAN_PRODUCT_CODE = "GDB-QCK"

# Every product GDB lends on. Terms and ledger wiring are held on all of them.
GDB_PRODUCT_NAMES = (LOAN_PRODUCT_NAME, QUICK_LOAN_PRODUCT_NAME)

# The Quick Loan's two closed questions — the Select options on the Custom
# Fields below, so Frappe itself refuses an answer outside them.
QUICK_TRADE_LOCATIONS = ("From home", "Other Locations - Fixed", "Mobile")
QUICK_TRADING_SINCE = ("Less than 6 months", "6 months to 1 year", "1 to 3 years", "More than 3 years")

# The sixteen accounts lending makes mandatory on a Loan Product once
# `enable_loan_accounting` is set on the Company (loan_product.set_optional_accounts).
# Without them every accounting hook is an early `return`, so disbursements and
# repayments submit and move state while writing nothing to the ledger.
#
# (product_field, account_name, parent group base name, root_type, account_type)
# Parent groups are resolved by account_name for the company, so the company
# abbreviation suffix ("- GDB") is never hard-coded. account_type stays blank
# except for the two cash accounts, so GL entries don't demand a party.
LOAN_ACCOUNT_SPECS = (
	("loan_account", "GDB Loans Receivable", "Loans and Advances (Assets)", "Asset", ""),
	("disbursement_account", "GDB Loan Disbursement", "Bank Accounts", "Asset", "Bank"),
	("payment_account", "GDB Loan Collections", "Bank Accounts", "Asset", "Bank"),
	("interest_accrued_account", "GDB Interest Accrued", "Loans and Advances (Assets)", "Asset", ""),
	(
		"interest_receivable_account",
		"GDB Interest Receivable",
		"Loans and Advances (Assets)",
		"Asset",
		"",
	),
	("penalty_accrued_account", "GDB Penalty Accrued", "Loans and Advances (Assets)", "Asset", ""),
	(
		"penalty_receivable_account",
		"GDB Penalty Receivable",
		"Loans and Advances (Assets)",
		"Asset",
		"",
	),
	("security_deposit_account", "GDB Security Deposits", "Current Liabilities", "Liability", ""),
	("customer_refund_account", "GDB Customer Refunds", "Current Liabilities", "Liability", ""),
	("interest_income_account", "GDB Interest Income", "Direct Income", "Income", ""),
	("penalty_income_account", "GDB Penalty Income", "Direct Income", "Income", ""),
	(
		"broken_period_interest_recovery_account",
		"GDB Broken Period Interest",
		"Direct Income",
		"Income",
		"",
	),
	("write_off_recovery_account", "GDB Write Off Recovery", "Direct Income", "Income", ""),
	("interest_waiver_account", "GDB Interest Waiver", "Indirect Expenses", "Expense", ""),
	("penalty_waiver_account", "GDB Penalty Waiver", "Indirect Expenses", "Expense", ""),
	("write_off_account", "GDB Loan Write Off", "Indirect Expenses", "Expense", ""),
)

# Portal fields the lending Loan Application doesn't carry natively. The
# gdb_owner link is how my_loans scopes an application to the citizen login;
# review fields are allow_on_submit because underwriters act on submitted docs.
# Sections B-H of the application: the business narrative an underwriter
# actually decides a development loan on. The programme spec asks for business
# identity, description, market, operations, team, and then EITHER evidenced
# financials (an existing trading business) OR projections (a start-up) — never
# both, because asking a start-up for accounts it cannot have is a form nobody
# can complete honestly.
#
# Held as a table rather than 31 hand-written dicts: they are all the same
# shape, and the table is the part worth reading. `insert_after` chains them in
# order so the desk form reads in the same order as the portal wizard.
#
# (fieldname, label, fieldtype[, options]) — options only for a Select.
APPLICATION_SECTIONS = (
	# B — how the applicant is applying, and business identity.
	# Legal structure is asked AFTER existing-vs-new, because whether a business
	# already trades is what decides which questions the rest of the form may
	# ask; how it is owned is the next question, not the first one.
	(
		"gdb_legal_structure",
		"Legal Structure",
		"Select",
		"\nSole Trader\nPartnership\nCluster-supported\nIncorporated (Inc.)\nOther",
	),
	# What "Other" means, in the applicant's words — a co-operative, a trust,
	# a society. Asked only when Other is the structure chosen.
	("gdb_legal_structure_other", "Legal Structure (Other, Declared)", "Data"),
	# The partners' e-IDs, when the structure is a partnership. Recorded as
	# declared: naming somebody is not the same as that person agreeing, and a
	# co-applicant who must consent does so through their own sign-in, never
	# through this form.
	("gdb_co_applicants", "Co-applicant e-IDs (Declared)", "Small Text"),
	# What the applicant owns of the business they are borrowing for. Asked of
	# a PARTNERSHIP and of an INCORPORATED company, and of neither a sole
	# trader (who owns all of it) nor a cluster (which is not owned in shares
	# at all). A development loan to a business the applicant holds a tenth of
	# is a different case from one they hold outright, and until now the form
	# could not tell an underwriter which it was looking at.
	("gdb_applicant_share", "Applicant's Ownership Share (%)", "Percent"),
	# B — business identity
	("gdb_sector", "Sector", "Data"),
	("gdb_sub_sector", "Sub-sector", "Data"),
	# When an existing business started trading — asked beside its registration.
	("gdb_date_established", "Date Business Established", "Date"),
	# The date on the DCRA certificate — asked of every SME, beside its number.
	("gdb_registration_date", "Date of Registration", "Date"),
	# A new business's support: an industrial training programme, a mentor, and
	# the institution behind either. Asked only when "Is this a new business?"
	# is Yes (NEW_ONLY clears them for an existing one).
	("gdb_industrial_training", "Participated in an Industrial Program (New Business)", "Select", "\nYes\nNo"),
	# On a Yes (2026-10-05): the institution (gdb_institution, below), the
	# course, and when it was or will be completed.
	("gdb_course_name", "Name of the Course (New Business)", "Data"),
	("gdb_course_completion_date", "Date Completed or Expected Completion (New Business)", "Date"),
	("gdb_has_mentor", "Has a Mentor (New Business)", "Select", "\nYes\nNo"),
	("gdb_mentor_details", "Mentor Details (New Business)", "Data"),
	# The mentor as three answers (2026-10-04); mentor_details is kept for
	# applications made before.
	("gdb_mentor_first_name", "Mentor's First Name (New Business)", "Data"),
	("gdb_mentor_last_name", "Mentor's Last Name (New Business)", "Data"),
	("gdb_mentor_phone", "Mentor's Phone Number (New Business)", "Data"),
	("gdb_institution", "Institution (New Business)", "Data"),
	# C — business or venture description
	("gdb_executive_summary", "Executive Summary", "Small Text"),
	("gdb_products_services", "Products / Services", "Small Text"),
	("gdb_unique_selling_point", "Marketing Strategy", "Small Text"),
	("gdb_use_of_funds", "Expected Use of Funds", "Small Text"),
	# When the borrower wants repayments to begin: this many months after the
	# funds are released, no instalment is due. 0 = the month after release.
	# A request — the Letter of Offer carries the moratorium GDB grants.
	("gdb_moratorium_months", "Moratorium Requested (Months)", "Int"),
	("gdb_challenges", "Current Challenges", "Small Text"),
	("gdb_employment_impact", "Economic Impact", "Small Text"),
	# Jobs the loan creates — a count an underwriter can compare across cases,
	# beside the free-text impact above.
	("gdb_jobs_created", "Jobs to be Created (First Year)", "Int"),
	# Direction and goals — where the owner means to take the business.
	("gdb_vision", "Vision", "Small Text"),
	("gdb_mission", "Mission", "Small Text"),
	("gdb_goals", "Goals", "Small Text"),
	# D — market and customers
	("gdb_customer_segments", "Customer Segments", "Small Text"),
	("gdb_target_market", "Target Market", "Small Text"),
	# Where most of the sales come from, and where the rest do — the market a
	# business lives on and the one it could grow into.
	("gdb_primary_market", "Primary Market", "Small Text"),
	("gdb_secondary_market", "Secondary Market", "Small Text"),
	("gdb_customer_need", "Customer Need / Problem", "Small Text"),
	("gdb_competitors", "Competitors / Alternatives", "Small Text"),
	("gdb_pricing_approach", "Pricing Approach", "Small Text"),
	# E — operations
	("gdb_operating_location", "Operating Location", "Data"),
	("gdb_production_process", "Production / Service Process", "Small Text"),
	("gdb_equipment_required", "Equipment and Assets", "Small Text"),
	("gdb_suppliers", "Suppliers", "Small Text"),
	("gdb_permits_required", "Permits / Operating Requirements", "Small Text"),
	# F — team and capability
	("gdb_key_people", "Owners and Key People", "Small Text"),
	("gdb_relevant_experience", "Relevant Experience", "Small Text"),
	("gdb_staff_count", "Number of Staff", "Int"),
	("gdb_skills_gaps", "Skills Gaps", "Small Text"),
	# G — existing-business financials. Declared by the applicant; evidence on
	# the shelf is what an underwriter ranks above these.
	("gdb_annual_revenue", "Annual Revenue (Declared)", "Currency"),
	("gdb_cost_of_sales", "Cost of Sales (Declared)", "Currency"),
	("gdb_operating_expenses", "Operating Expenses (Declared)", "Currency"),
	("gdb_existing_obligations", "Existing Loan Obligations", "Currency"),
	("gdb_cash_position", "Current Cash Position", "Currency"),
	# The balance sheet in three figures — asked of an existing business and of
	# a new venture alike (a venture's opening position).
	("gdb_total_assets", "Total Assets (Declared)", "Currency"),
	("gdb_total_debt", "Total Debt (Declared)", "Currency"),
	("gdb_total_equity", "Total Equity (Declared)", "Currency"),
	# Whether the applicant already owes anyone. Yes brings the lines below
	# (gdb_existing_debt_lines): lender, amount outstanding, status.
	("gdb_has_existing_debts", "Has Existing Debts (Declared)", "Select", "\nYes\nNo"),
	# H — new-venture projections. Forecasts, and labelled as forecasts
	# everywhere they are shown.
	("gdb_expected_sales_volume", "Expected Sales Volume", "Small Text"),
	("gdb_projected_revenue", "Projected Annual Revenue", "Currency"),
	("gdb_projected_costs", "Projected Annual Costs", "Currency"),
	("gdb_initial_costs", "Initial Start-up Costs", "Currency"),
	("gdb_expected_cash_position", "Expected Monthly Cash Position", "Currency"),
	("gdb_assumptions", "Assumptions Behind Projections", "Small Text"),
	# Q — the Quick Loan, INSTEAD of B-H. An informal trader has no
	# registration, accounts or plan to describe; what an underwriter needs is
	# what they do, where they do it and for how long. Where they trade is asked
	# apart from what they do, so "roadside" is never mistaken for a trade.
	("gdb_trade_activity", "What the Business Sells or Does (Quick Loan)", "Small Text"),
	("gdb_trade_location", "Business Location (Quick Loan)", "Select", "\n" + "\n".join(QUICK_TRADE_LOCATIONS)),
	("gdb_trading_since", "Time in Business (Quick Loan)", "Select", "\n" + "\n".join(QUICK_TRADING_SINCE)),
	("gdb_trade_region", "Business Region (Quick Loan)", "Data"),
	# Where the business is, pinned on a map — required, because an informal
	# trader often has no street address an officer could find.
	("gdb_trade_latitude", "Business Latitude (Quick Loan)", "Float"),
	("gdb_trade_longitude", "Business Longitude (Quick Loan)", "Float"),
	("gdb_trade_address", "Business Location Description (Quick Loan)", "Small Text"),
	# Two people who know the trader and can speak for them — an informal
	# business has no accounts or registration, so the people around it are part
	# of how GDB comes to know it. Declared, and never contacted without cause.
	("gdb_support_1_name", "Supporting Contact 1 — Name (Quick Loan)", "Data"),
	("gdb_support_1_relationship", "Supporting Contact 1 — Relationship (Quick Loan)", "Data"),
	("gdb_support_1_phone", "Supporting Contact 1 — Phone (Quick Loan)", "Data"),
	("gdb_support_2_name", "Supporting Contact 2 — Name (Quick Loan)", "Data"),
	("gdb_support_2_relationship", "Supporting Contact 2 — Relationship (Quick Loan)", "Data"),
	("gdb_support_2_phone", "Supporting Contact 2 — Phone (Quick Loan)", "Data"),
	# The applicant's own declaration that they live in Guyana — the programme
	# is for Guyanese enterprise, and a Quick Loan asks for no address proof.
	("gdb_resides_in_guyana", "Resides in Guyana (Declared, Quick Loan)", "Check"),
	# The applicant's E-ID as they type it on the form — a plain declaration,
	# beside the e-ID an account opened through My Guyana already carries.
	("gdb_applicant_eid", "Applicant E-ID (Declared, Quick Loan)", "Data"),
	# Public-service employment. A public servant earning GYD 250,000 a month or
	# more is not refused — the case is routed to a Loan Officer instead
	# (gdb_requires_loan_officer_review, set by the server, never the form).
	("gdb_public_service_employed", "Employed in the Public Service (Declared, Quick Loan)", "Select", "\nYes\nNo"),
	("gdb_public_service_ministry", "Ministry or Agency (Declared, Quick Loan)", "Data"),
	("gdb_public_service_under_250k", "Earns Under GYD 250,000 a Month (Declared, Quick Loan)", "Select", "\nYes\nNo"),
	("gdb_requires_loan_officer_review", "Requires Loan Officer Review", "Check"),
	("gdb_related_to_gdb_employee", "Related to a GDB Employee (Declared, Quick Loan)", "Select", "\nYes\nNo"),
	# 2026-10-05: "Do you have an E-ID?" asked before the number, and the
	# employment questions that replace the public-service ones above (kept for
	# applications made before). A public-sector employee earning GYD 200,000 a
	# month or more is routed to a Loan Officer (gdb_requires_loan_officer_review).
	("gdb_has_eid", "Has an E-ID (Declared)", "Select", "\nYes\nNo"),
	("gdb_employed", "Employed (Declared)", "Select", "\nYes\nNo"),
	("gdb_employer_category", "Employer Category (Declared)", "Select", "\n" + "\n".join(EMPLOYER_CATEGORIES)),
	("gdb_employer_name", "Employer Name (Declared)", "Data"),
	("gdb_income_band", "Monthly Income (Declared)", "Select", "\n" + "\n".join(INCOME_BANDS)),
	# "I don't have a bank account": the applicant is sent to the Help Desk and
	# the facilitated banks (Bank.gdb_facilitated) rather than stopped.
	("gdb_no_bank_account", "Has No Bank Account (Declared, Quick Loan)", "Check"),
	# Priority groups, as the applicant declares them — a declaration, kept apart
	# from the sector, never a decision.
	("gdb_youth_entrepreneur", "Youth Entrepreneur (Declared)", "Check"),
	("gdb_woman_entrepreneur", "Woman Entrepreneur (Declared)", "Check"),
)


def _section_custom_fields() -> list:
	"""APPLICATION_SECTIONS as Custom Field dicts, chained in order."""
	fields = []
	previous = "gdb_business_name"
	for row in APPLICATION_SECTIONS:
		fieldname, label, fieldtype = row[0], row[1], row[2]
		field = {
			"fieldname": fieldname,
			"label": label,
			"fieldtype": fieldtype,
			"insert_after": previous,
		}
		if len(row) > 3:
			field["options"] = row[3]
		fields.append(field)
		previous = fieldname
	return fields


CUSTOM_FIELDS = {
	"Loan Application": [
		{
			"fieldname": "gdb_owner",
			"label": "GDB Portal User",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"insert_after": "applicant_name",
		},
		{
			"fieldname": "gdb_purpose",
			"label": "Purpose (Citizen)",
			"fieldtype": "Small Text",
			"insert_after": "gdb_owner",
		},
		{
			"fieldname": "gdb_monthly_income",
			"label": "Monthly Income (Citizen)",
			"fieldtype": "Currency",
			"insert_after": "gdb_purpose",
		},
		{
			"fieldname": "gdb_cluster",
			"label": "GDB Cluster",
			"fieldtype": "Link",
			"options": "GDB Cluster",
			"insert_after": "gdb_monthly_income",
		},
		# Existing trading business or a start-up. The two are different credit
		# propositions — one has a DCRA registration and a history to verify,
		# the other has neither — so the application records which it is rather
		# than leaving an underwriter to infer it from a blank field.
		{
			"fieldname": "gdb_business_stage",
			"label": "Business Stage",
			"fieldtype": "Select",
			"options": "\nExisting\nNew",
			"insert_after": "gdb_cluster",
		},
		# DCRA — the Deeds and Commercial Registries Authority registration an
		# applicant's business already holds. A registered business is the
		# strongest evidence an underwriter has that a development loan is
		# going to a real trading concern, so it is captured at application
		# time rather than asked for later.
		{
			"fieldname": "gdb_dcra_number",
			"label": "DCRA Registration No.",
			"fieldtype": "Data",
			"insert_after": "gdb_business_stage",
		},
		{
			"fieldname": "gdb_business_name",
			"label": "Registered Business Name",
			"fieldtype": "Data",
			"insert_after": "gdb_dcra_number",
		},
		*_section_custom_fields(),
		# A Quick Loan has no Letter of Offer to sign, so the borrower accepts its
		# terms — amount, term, zero interest — when they submit, and this is when.
		# Set by submit_application, never by the form.
		{
			"fieldname": "gdb_terms_accepted_on",
			"label": "Quick Loan Terms Accepted On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"insert_after": "gdb_woman_entrepreneur",
		},
		# The borrower's consent to a credit-bureau check, given on the submit page.
		{
			"fieldname": "gdb_credit_consent_on",
			"label": "Credit Check Consent Given On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"insert_after": "gdb_terms_accepted_on",
		},
		# Section C's use of funds as real rows, one Currency amount each, so the
		# total is Frappe's SUM over the lines rather than an addition done by a
		# client over a JSON string. Supersedes the gdb_use_of_funds text, which
		# the migrate_use_of_funds_to_lines patch unpacked into these rows and
		# which is no longer written.
		{
			"fieldname": "gdb_use_of_funds_lines",
			"label": "Use of Funds",
			"fieldtype": "Table",
			"options": "GDB Use Of Funds Line",
			"insert_after": "gdb_use_of_funds",
		},
		# The debts the applicant already carries, one row each, when they said
		# they have any (gdb_has_existing_debts).
		{
			"fieldname": "gdb_existing_debt_lines",
			"label": "Existing Debts",
			"fieldtype": "Table",
			"options": "GDB Existing Debt Line",
			"insert_after": "gdb_use_of_funds_lines",
		},
		# Everybody who owns a share of the business BESIDES the applicant,
		# whose own share is the gdb_applicant_share above. Rows rather than
		# more text in gdb_co_applicants, so a share is a real Percent column
		# that can be totalled and refused — see services.application._owners.
		{
			"fieldname": "gdb_ownership_lines",
			"label": "Partners and Shareholders (Declared)",
			"fieldtype": "Table",
			"options": "GDB Ownership Line",
			"insert_after": "gdb_co_applicants",
		},
		# Filled with a GDB Field Officer, with the applicant's recorded consent
		# (GDB Assist Consent). Attribution, not authorship: the applicant still
		# checks and submits the application themselves. Set by
		# services/application.save_application when an officer saves it, and
		# when the officer hands it back.
		{
			"fieldname": "gdb_assisted_by",
			"label": "Assisted By (Field Officer)",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"insert_after": "gdb_credit_consent_on",
		},
		{
			"fieldname": "gdb_handed_off_on",
			"label": "Handed To Applicant On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"insert_after": "gdb_assisted_by",
		},
		# Who put the application before the Bank, and when: the applicant, or
		# a Field Officer submitting it for them under their consent
		# (services/field_operations.submit_for). The applicant is told either way.
		{
			"fieldname": "gdb_submitted_by",
			"label": "Submitted By",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"insert_after": "gdb_handed_off_on",
		},
		{
			"fieldname": "gdb_submitted_on",
			"label": "Submitted On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"insert_after": "gdb_submitted_by",
		},
		{
			"fieldname": "gdb_remarks",
			"label": "Underwriter Remarks",
			"fieldtype": "Small Text",
			"allow_on_submit": 1,
			"insert_after": "status",
		},
		{
			"fieldname": "gdb_reviewed_by",
			"label": "Reviewed By",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"allow_on_submit": 1,
			"insert_after": "gdb_remarks",
		},
		{
			"fieldname": "gdb_reviewed_on",
			"label": "Reviewed On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"allow_on_submit": 1,
			"insert_after": "gdb_reviewed_by",
		},
		# The underwriter's classification of the case, on the Credit risk tab —
		# GDB's own, never the applicant's (services/credit_classification).
		{
			"fieldname": "gdb_credit_sector",
			"label": "Sector (Credit Risk)",
			"fieldtype": "Link",
			"options": "GDB Sector",
			"read_only": 1,
			"allow_on_submit": 1,
			"insert_after": "gdb_reviewed_on",
		},
		{
			"fieldname": "gdb_credit_sub_sector",
			"label": "Sub-sector (Credit Risk)",
			"fieldtype": "Link",
			"options": "GDB Sub Sector",
			"read_only": 1,
			"allow_on_submit": 1,
			"insert_after": "gdb_credit_sector",
		},
	],
	"Loan Repayment": [
		{
			"fieldname": "gdb_paid_by",
			"label": "Paid By (Portal)",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"insert_after": "posting_date",
		},
	],
	"Loan Disbursement": [
		{
			"fieldname": "gdb_disbursed_by",
			"label": "Disbursed By (Portal)",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"insert_after": "disbursement_date",
		},
	],
	"Customer": [
		{
			"fieldname": "gdb_user",
			"label": "GDB Portal User",
			"fieldtype": "Link",
			"options": "User",
			"read_only": 1,
			"insert_after": "customer_name",
		},
	],
}

# The bank account check (gdb_bank.integrations.bank_registry). Kept apart from
# CUSTOM_FIELDS above because those hang off lending doctypes; Bank Account is
# ERPNext's own and is present whether or not lending is installed.
#
# Four fields because plan.md 6.1 asks every external check to record four
# things — result, source, timestamp, reference — and a check whose source is
# unknown is not a check. All read-only: this is what the registry said, not
# something staff may edit into a pass.
ERPNEXT_CUSTOM_FIELDS = {
	# Whether citizens may be paid through this bank (BANKS). A disabled bank is
	# not offered and is refused on save.
	"Bank": [
		{
			"fieldname": "gdb_enabled",
			"label": "Offered to Citizens",
			"fieldtype": "Check",
			"default": "1",
			"insert_after": "bank_name",
		},
		# Listed to an applicant who has no bank account yet, as the banks the
		# Help Desk can help them open one with. Desk-editable; seeded once.
		{
			"fieldname": "gdb_facilitated",
			"label": "Facilitated for Applicants Without an Account",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "gdb_enabled",
		},
	],
	"Bank Account": [
		# The branch picked from the bank's list; branch_code holds its routing number.
		{
			"fieldname": "gdb_bank_branch",
			"label": "Branch",
			"fieldtype": "Link",
			"options": "GDB Bank Branch",
			"insert_after": "branch_code",
		},
		{
			"fieldname": "gdb_verification_status",
			"label": "GDB Account Check",
			"fieldtype": "Select",
			# Unavailable is a state of its own and never becomes a pass.
			"options": "\nVerified\nName Mismatch\nInactive Account\nNot Found\nUnavailable",
			"read_only": 1,
			"insert_after": "branch_code",
		},
		{
			"fieldname": "gdb_verification_source",
			"label": "Checked Against",
			"fieldtype": "Data",
			"read_only": 1,
			"description": "bank_registry (the switch answered) or unavailable.",
			"insert_after": "gdb_verification_status",
		},
		{
			"fieldname": "gdb_verified_on",
			"label": "Checked On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"insert_after": "gdb_verification_source",
		},
		{
			"fieldname": "gdb_verification_reference",
			"label": "Check Reference",
			"fieldtype": "Data",
			"read_only": 1,
			"description": "The name the bank holds on the account, or the switch's reference.",
			"insert_after": "gdb_verified_on",
		},
	]
}

# Guyana's ten administrative regions, exactly as GDB Citizen Profile.region
# spells them — a Field Officer's region is matched against an applicant's.
REGION_OPTIONS = "\n".join(
	[
		"",
		"Region 1 — Barima-Waini",
		"Region 2 — Pomeroon-Supenaam",
		"Region 3 — Essequibo Islands-West Demerara",
		"Region 4 — Demerara-Mahaica",
		"Region 5 — Mahaica-Berbice",
		"Region 6 — East Berbice-Corentyne",
		"Region 7 — Cuyuni-Mazaruni",
		"Region 8 — Potaro-Siparuni",
		"Region 9 — Upper Takutu-Upper Essequibo",
		"Region 10 — Upper Demerara-Berbice",
	]
)

# The e-ID link (gdb_bank.identity). Kept apart from CUSTOM_FIELDS above
# because every field there hangs off a lending or ERPNext doctype and is only
# created when lending is installed — User is core frappe and always present.
# Unique: one e-ID is one person, so two Users cannot claim the same one.
USER_CUSTOM_FIELDS = {
	"User": [
		{
			"fieldname": "gdb_eid",
			"label": "e-ID Number",
			"fieldtype": "Data",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"description": "National e-ID (123-4567-8901) — also the Keycloak username.",
			"insert_after": "username",
		},
		# A citizen who signed up online (tin_auth.py): the National ID number
		# the KYC register knows them by, which is also their Keycloak username.
		{
			"fieldname": "gdb_national_id",
			"label": "National ID Number",
			"fieldtype": "Data",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"description": "The ID number on the KYC register — the Keycloak username of an online sign-up.",
			"insert_after": "gdb_eid",
		},
		# Their GRA Taxpayer Identification Number, when they gave one. Optional.
		{
			"fieldname": "gdb_tin",
			"label": "TIN",
			"fieldtype": "Data",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"description": "GRA Taxpayer Identification Number (9 digits), optional at sign-up.",
			"insert_after": "gdb_national_id",
		},
		# A staff member signs in with a work email, so their national e-ID is
		# not their username — but it is still who they are. The platform
		# administrator records it here so security/conflict.py can recognise an
		# officer's OWN citizen application, filed from their separate e-ID
		# account, and refuse to let them decide or release it.
		{
			"fieldname": "gdb_staff_eid",
			"label": "Staff Member's National e-ID",
			"fieldtype": "Data",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"description": "Recorded by the platform administrator. Never used to sign in.",
			"insert_after": "gdb_eid",
		},
		# The region a Field Officer works. Their assist-request pool and field
		# tasks are filtered to it server-side (services/field_operations); an
		# officer with none set sees only what is already assigned to them.
		# Same list, same spelling as GDB Citizen Profile.region.
		{
			"fieldname": "gdb_region",
			"label": "GDB Region",
			"fieldtype": "Select",
			"options": REGION_OPTIONS,
			"read_only": 1,
			"description": "Set by the platform administrator.",
			"insert_after": "gdb_staff_eid",
		},
	],
}


def ensure_roles():
	for role_name, desk_access in ROLES:
		if not frappe.db.exists("Role", role_name):
			frappe.get_doc(
				{
					"doctype": "Role",
					"role_name": role_name,
					"desk_access": desk_access,
				}
			).insert(ignore_permissions=True)
	frappe.db.commit()


def after_install():
	ensure_roles()
	make_user_custom_fields()


# The kinds of account a citizen may be paid into — ERPNext's own Bank Account
# Type records, linked from Bank Account.account_type.
BANK_ACCOUNT_TYPES = ("Checking", "Savings")


def ensure_bank_account_types():
	"""Seed the payout account types. Idempotent."""
	for name in BANK_ACCOUNT_TYPES:
		if not frappe.db.exists("Bank Account Type", name):
			frappe.get_doc({"doctype": "Bank Account Type", "account_type": name}).insert(ignore_permissions=True)
	frappe.db.commit()


def after_migrate():
	ensure_roles()
	ensure_sectors()
	# Outgoing mail, when its SMTP settings are present (integrations/mail).
	from gdb_bank.integrations import mail

	mail.ensure_email_account()
	make_user_custom_fields()
	# After the field exists: earlier online sign-ups' number, held as "TIN",
	# moves to the National ID field. Repeating it finds nothing to move.
	from gdb_bank.patches.national_id_from_tin import execute as national_id_from_tin

	national_id_from_tin()
	# "Fixed location" became "Market" (2026-10-04), and "Market" became "Other
	# Locations - Fixed" (2026-10-05): move answers already given.
	if frappe.db.has_column("Loan Application", "gdb_trade_location"):
		frappe.db.sql(
			"update `tabLoan Application` set gdb_trade_location='Other Locations - Fixed' "
			"where gdb_trade_location in ('Fixed location', 'Market')"
		)
	frappe.db.commit()
	ensure_lending_rule_proposal_workflow()
	if "erpnext" in frappe.get_installed_apps():
		make_erpnext_custom_fields()
		ensure_banks()
		ensure_bank_account_types()
		ensure_accounts_read()
		ensure_reconciliation_read()
	if "lending" in frappe.get_installed_apps():
		make_custom_fields()
		ensure_loan_permissions()
		ensure_loan_accounting()
		ensure_product_terms()
		ensure_payment_file_report()
		ensure_lending_reports_read()


def make_user_custom_fields():
	"""The e-ID field on User. Unconditional — it depends on nothing but core."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(USER_CUSTOM_FIELDS, ignore_validate=True)
	frappe.db.commit()


def make_erpnext_custom_fields():
	"""The account-check fields on ERPNext's Bank Account."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(ERPNEXT_CUSTOM_FIELDS, ignore_validate=True)
	frappe.db.commit()


def ensure_banks():
	"""The banks a citizen may be paid through.

	Names only. A Bank record carries no account of anyone's — it is the list
	the portal's payout destination links to, and without it an approved loan
	has nowhere to go.
	"""
	rename_old_banks()
	for bank_name, enabled in BANKS:
		if not frappe.db.exists("Bank", bank_name):
			frappe.get_doc({"doctype": "Bank", "bank_name": bank_name}).insert(
				ignore_permissions=True
			)
		frappe.db.set_value("Bank", bank_name, "gdb_enabled", enabled, update_modified=False)
	for bank_name in RETIRED_BANKS:
		if frappe.db.exists("Bank", bank_name):
			frappe.db.set_value("Bank", bank_name, "gdb_enabled", 0, update_modified=False)
	for bank_name, website in BANK_WEBSITES.items():
		if frappe.db.exists("Bank", bank_name) and not frappe.db.get_value("Bank", bank_name, "website"):
			frappe.db.set_value("Bank", bank_name, "website", website, update_modified=False)
	# The facilitated list starts as every bank offered to citizens, once: after
	# that it is the desk's (Bank > Facilitated for Applicants Without an Account).
	if not frappe.db.exists("Bank", {"gdb_facilitated": 1}):
		for bank_name, enabled in BANKS:
			if enabled:
				frappe.db.set_value("Bank", bank_name, "gdb_facilitated", 1, update_modified=False)
	ensure_bank_branches()
	frappe.db.commit()


def ensure_sectors():
	"""Seed SECTORS where missing. Never overwrites: the list is the desk's once
	it exists, and a migrate must not undo GDB's own corrections."""
	for order, (sector, subs) in enumerate(SECTORS):
		if not frappe.db.exists("GDB Sector", sector):
			frappe.get_doc({"doctype": "GDB Sector", "sector_name": sector, "sort_order": order}).insert(
				ignore_permissions=True
			)
		for sub_order, sub in enumerate(subs):
			name = f"{sector} - {sub}"
			if not frappe.db.exists("GDB Sub Sector", name):
				doc = frappe.get_doc(
					{"doctype": "GDB Sub Sector", "sector": sector, "sub_sector_name": sub, "sort_order": sub_order}
				)
				doc.insert(ignore_permissions=True, set_name=name)
	frappe.db.commit()


def rename_old_banks():
	"""A Bank seeded under an old name (BANK_ALIASES) takes its current one, and
	its branches with it. rename_doc moves every link — saved payout accounts,
	the branch list — so nobody's account points at a name that has gone."""
	for old, new in BANK_ALIASES.items():
		if frappe.db.exists("Bank", old) and not frappe.db.exists("Bank", new):
			frappe.rename_doc("Bank", old, new, force=True)
		for branch in frappe.get_all("GDB Bank Branch", filters={"name": ["like", f"{old} - %"]}, pluck="name"):
			renamed = new + branch[len(old) :]
			if not frappe.db.exists("GDB Bank Branch", renamed):
				frappe.rename_doc("GDB Bank Branch", branch, renamed, force=True)


def ensure_bank_branches():
	"""Seed BANK_BRANCHES, keeping each row's figures as the list states them."""
	for name, bank, branch, routing, order in BANK_BRANCHES:
		values = {"bank": bank, "branch_name": branch, "routing_number": routing, "sort_order": order}
		if frappe.db.exists("GDB Bank Branch", name):
			frappe.db.set_value("GDB Bank Branch", name, values, update_modified=False)
		else:
			doc = frappe.get_doc({"doctype": "GDB Bank Branch", **values})
			doc.name = name
			doc.insert(ignore_permissions=True, set_name=name)


# Reading the books, and nothing more. Deliberately NOT ERPNext's stock
# `Accounts User` role, which the Finance page's own error text suggests: that
# role also creates and submits Journal Entries, Payment Entries and invoices,
# and a portal role that can post entries can move money on the books. So the
# finance officer gets read and the `report` permission query_report.run
# demands — every other permission is set to 0 explicitly rather than left to
# whatever add_permission defaults to.
ACCOUNTS_READ_DOCTYPES = ("Company", "Fiscal Year", "Account", "GL Entry")

# The four statements the portal's Finance page renders. Each is a standard
# Script Report over GL Entry, gated on Accounts User / Accounts Manager /
# Auditor.
ACCOUNTS_REPORTS = (
	"Trial Balance",
	"General Ledger",
	"Balance Sheet",
	"Profit and Loss Statement",
)

# The books belong to finance. This used to read "Loan Underwriter", and the
# grants that name made are revoked on migrate — see REVOKED_MONEY_ROLES.
ACCOUNTS_READER_ROLE = "Finance Officer"

# Roles that USED to hold the money-movement surfaces and must not any more.
# Listed rather than merely dropped from the grant lists, because a permission
# already written to a site is not undone by ceasing to ask for it.
REVOKED_MONEY_ROLES = ("Loan Underwriter",)


def _revoke(doctype: str, role: str) -> None:
	"""Take a role's Custom DocPerm rows off a doctype, if it holds any."""
	rows = frappe.get_all("Custom DocPerm", filters={"parent": doctype, "role": role}, pluck="name")
	for name in rows:
		frappe.delete_doc("Custom DocPerm", name, ignore_permissions=True, force=True)
	if rows:
		frappe.clear_cache(doctype=doctype)
		print(f"revoked {role} on {doctype}")


def ensure_accounts_read():
	"""Let a finance officer read the ledger without being able to post to it."""
	from frappe.permissions import add_permission, update_permission_property

	for doctype in ACCOUNTS_READ_DOCTYPES:
		if not frappe.db.exists("DocType", doctype):
			continue
		for role in REVOKED_MONEY_ROLES:
			_revoke(doctype, role)
		if not frappe.db.exists(
			"Custom DocPerm", {"parent": doctype, "role": ACCOUNTS_READER_ROLE}
		):
			add_permission(doctype, ACCOUNTS_READER_ROLE, 0)
		for ptype, value in (
			("read", 1),
			# query_report.run checks `report` on the report's ref_doctype, so
			# without this the statements 403 even with read granted.
			("report", 1),
			("create", 0),
			("write", 0),
			("delete", 0),
			("submit", 0),
			("cancel", 0),
			("amend", 0),
			("export", 0),
		):
			update_permission_property(doctype, ACCOUNTS_READER_ROLE, 0, ptype, value)

	_grant_reports(ACCOUNTS_REPORTS)
	frappe.db.commit()


def _grant_reports(reports):
	"""Put ACCOUNTS_READER_ROLE on each of these standard reports.

	A standard Report cannot be edited outside developer mode, so the role goes
	on a Custom Role instead. Note that Report.is_permitted REPLACES the
	standard roles with the custom ones when a Custom Role exists — so the
	roles already on the report are carried across, or granting the finance
	officer access would revoke it from every accountant.
	"""
	for report in reports:
		if not frappe.db.exists("Report", report):
			continue
		standard = frappe.get_all(
			"Has Role", filters={"parent": report, "parenttype": "Report"}, pluck="role"
		)
		# Rebuilt from the report's OWN roles each time, so a role this app
		# granted and has since moved on from (the underwriter, before the
		# finance split) disappears rather than accumulating.
		wanted = sorted((set(standard) | {ACCOUNTS_READER_ROLE}) - set(REVOKED_MONEY_ROLES))

		existing = frappe.db.get_value("Custom Role", {"report": report})
		doc = (
			frappe.get_doc("Custom Role", existing)
			if existing
			else frappe.get_doc({"doctype": "Custom Role", "report": report})
		)
		if sorted({r.role for r in doc.roles}) == wanted:
			continue
		doc.roles = []
		for role in wanted:
			doc.append("roles", {"role": role})
		doc.save(ignore_permissions=True) if existing else doc.insert(ignore_permissions=True)


def ensure_reconciliation_read():
	"""Let Finance read incoming Bank Transactions without being able to post
	one by hand in the desk.

	gdb_bank.collections (unreconciled_receipts, suggest_loans) reads this
	doctype as the calling user, not as the system — unlike apply_receipt's
	actual write, which happens inside _as_system(). Without this grant those
	two read-only endpoints 403 for every Finance Officer holder.
	"""
	from frappe.permissions import add_permission, update_permission_property

	doctype = "Bank Transaction"
	if not frappe.db.exists("DocType", doctype):
		return
	if not frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": ACCOUNTS_READER_ROLE}):
		add_permission(doctype, ACCOUNTS_READER_ROLE, 0)
	for ptype, value in (
		("read", 1),
		("create", 0),
		("write", 0),
		("delete", 0),
		("submit", 0),
		("cancel", 0),
		("amend", 0),
		("export", 0),
		("report", 0),
	):
		update_permission_property(doctype, ACCOUNTS_READER_ROLE, 0, ptype, value)
	frappe.db.commit()


# THE PORTFOLIO. Lending ships these as standard Script Reports and they have
# been sitting unreachable: granted to `Loan Manager` and `Employee`, which the
# disbursement officer only holds by accident of the demo seed, and rendered
# nowhere in the portal. So the Bank could not answer "what is outstanding" or
# "what is due next month" without opening the desk.
#
# The four Loan Security reports are deliberately NOT here. This build takes no
# collateral, so they would render an empty table that looks like a portfolio
# with nothing pledged rather than a feature that does not apply.
LENDING_REPORTS = (
	"Loan Outstanding Report",
	"Past Cashflow Report",
	"Future Cashflow Report",
	"Loan Repayment and Closure",
	"Loan Statement of Account",
)

# query_report.run checks the `report` permission on the report's ref_doctype,
# so read alone is not enough to run one — the same lesson ACCOUNTS_READ_DOCTYPES
# records. Read and report ONLY: this persona reads the portfolio, and every
# write it is entitled to goes through a whitelisted endpoint in api.py that
# logs who did it.
LENDING_READ_DOCTYPES = ("Loan", "Loan Repayment", "Loan Disbursement", "Loan Demand")


def ensure_lending_reports_read():
	"""Let Finance and the disbursement officer read the portfolio without writing
	to it. The disbursement officer also reads back every Loan they book, so a
	holder of that role alone must have this — not only one who also has Finance."""
	from frappe.permissions import add_permission, update_permission_property

	for doctype in LENDING_READ_DOCTYPES:
		if not frappe.db.exists("DocType", doctype):
			continue
		for role in (ACCOUNTS_READER_ROLE, DISBURSEMENT_ROLE):
			if not frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role}):
				add_permission(doctype, role, 0)
			for ptype, value in (
				("read", 1),
				("report", 1),
				("create", 0),
				("write", 0),
				("delete", 0),
				("submit", 0),
				("cancel", 0),
				("amend", 0),
				("export", 0),
			):
				update_permission_property(doctype, role, 0, ptype, value)

	_grant_reports(LENDING_REPORTS)
	frappe.db.commit()


# The file the bank actually receives, and the roles allowed to pull it.
#
# It lives here rather than only in the database because a report created by
# hand in the desk exists in exactly one environment: a fresh site rendered the
# portal's "Payment file" tab against a report that was not there. The SQL is
# still the single place the layout is defined — editing it here and migrating
# is the way the bank's format changes, never the SPA.
#
# These rows carry citizens' account numbers, so the role list is deliberate
# and short: the accounting roles that already see bank details, plus the
# portal's disbursement officer, whose Disbursements page this is. Nothing
# wider — and notably not the underwriter, who decides the loan and never pays
# it, and not Finance, who reads the ledger but never releases funds.
PAYMENT_FILE_REPORT = "GDB Disbursement Payment File"

PAYMENT_FILE_REF_DOCTYPE = "Loan Disbursement"

DISBURSEMENT_ROLE = "Disbursement Officer"

# Finance Officer held this grant while it also carried release authority; that
# authority moved to DISBURSEMENT_ROLE, so the grant does too — see
# REVOKED_MONEY_ROLES for the same treatment applied to the underwriter earlier.
PAYMENT_FILE_ROLES = ("Accounts User", "Accounts Manager", "System Manager", DISBURSEMENT_ROLE)

PAYMENT_FILE_QUERY = """SELECT
    ba.bank                              AS "Bank:Data:160",
    ba.bank_account_no                   AS "Account Number:Data:150",
    IFNULL(ba.branch_code, '')           AS "Branch Code:Data:110",
    ba.account_name                      AS "Beneficiary:Data:180",
    ld.disbursed_amount                  AS "Amount:Currency:120",
    l.name                               AS "Loan:Link/Loan:150",
    ld.name                              AS "Disbursement:Link/Loan Disbursement:150",
    ld.disbursement_date                 AS "Value Date:Date:100"
FROM `tabLoan Disbursement` ld
JOIN `tabLoan` l          ON l.name = ld.against_loan
LEFT JOIN `tabBank Account` ba
       ON ba.party_type = 'Customer' AND ba.party = l.applicant
WHERE ld.docstatus = 1
  AND ld.company = %(company)s
  AND ld.disbursement_date BETWEEN %(from_date)s AND %(to_date)s
  AND (%(payable_only)s = 0 OR IFNULL(ba.bank_account_no, '') != '')
  AND (%(bank)s = '' OR ba.bank = %(bank)s)
ORDER BY ba.bank, ld.disbursement_date"""

# The file's total is Frappe's: with add_total_row, query_report.run appends a
# "Total" row it sums itself over exactly the rows returned. That is why the
# bank and "has an account" filters live in the SQL above rather than in the
# client — Frappe can only total the rows it was asked for.
PAYMENT_FILE_REPORT_SETTINGS = {"query": PAYMENT_FILE_QUERY, "add_total_row": 1}


def ensure_payment_file_report():
	"""Seed the payment file report and open both gates in front of it.

	A query report is guarded twice and the portal needs to clear both:
	`Report.is_permitted` reads the roles on the report itself, and then
	`query_report.run` demands the `report` permission on its ref_doctype. The
	portal's staff role held neither by right — the ref_doctype check passed only by way
	of lending's `Loan Manager`, which the demo user happens to carry and a real
	underwriter would not, so that grant is made here on the role the portal
	actually uses rather than left to a coincidence of the seed data. That role
	is the disbursement officer; the underwriter's old grant, and Finance
	Officer's grant from when it also carried release authority, are both
	revoked below.

	Read and report only. A disbursement officer must be able to pull the file
	and to release funds through `api.disburse_loan`, never to post a Loan
	Disbursement by hand in the desk — the same separation `ensure_accounts_read`
	keeps over the ledger.
	"""
	from frappe.permissions import add_permission, update_permission_property

	if not frappe.db.exists("DocType", PAYMENT_FILE_REF_DOCTYPE):
		return

	for role in (*REVOKED_MONEY_ROLES, ACCOUNTS_READER_ROLE):
		_revoke(PAYMENT_FILE_REF_DOCTYPE, role)

	if not frappe.db.exists("Report", PAYMENT_FILE_REPORT):
		frappe.get_doc(
			{
				"doctype": "Report",
				"report_name": PAYMENT_FILE_REPORT,
				"ref_doctype": PAYMENT_FILE_REF_DOCTYPE,
				"report_type": "Query Report",
				"is_standard": "No",
				"module": "GDB Bank",
				**PAYMENT_FILE_REPORT_SETTINGS,
			}
		).insert(ignore_permissions=True)

	# The SQL here is the one place the layout is defined, so a site whose
	# report predates a change to it is brought up to date on migrate —
	# otherwise it keeps the old query, and Frappe keeps totalling the old rows.
	report = frappe.get_doc("Report", PAYMENT_FILE_REPORT)
	stale = {k: v for k, v in PAYMENT_FILE_REPORT_SETTINGS.items() if report.get(k) != v}
	if stale:
		report.update(stale)
		report.save(ignore_permissions=True)
		report.reload()

	# Roles are a union, so a grant somebody made in the desk survives a migrate.
	wanted = sorted(
		({r.role for r in report.roles} | set(PAYMENT_FILE_ROLES))
		- set(REVOKED_MONEY_ROLES)
		- {ACCOUNTS_READER_ROLE}
	)
	if sorted({r.role for r in report.roles}) != wanted:
		report.roles = []
		for role in wanted:
			report.append("roles", {"role": role})
		report.save(ignore_permissions=True)

	if not frappe.db.exists(
		"Custom DocPerm", {"parent": PAYMENT_FILE_REF_DOCTYPE, "role": DISBURSEMENT_ROLE}
	):
		add_permission(PAYMENT_FILE_REF_DOCTYPE, DISBURSEMENT_ROLE, 0)
	for ptype, value in (
		("read", 1),
		("report", 1),
		("create", 0),
		("write", 0),
		("delete", 0),
		("submit", 0),
		("cancel", 0),
		("amend", 0),
		("export", 0),
	):
		update_permission_property(
			PAYMENT_FILE_REF_DOCTYPE, DISBURSEMENT_ROLE, 0, ptype, value
		)

	frappe.db.commit()


def ensure_loan_permissions():
	"""Citizens read Loan — lending's calculate_amounts demands it — scoped to
	their own rows by gdb_bank.permissions. Read only: no create, write or
	delete, and nothing at permlevel 1."""
	from frappe.permissions import add_permission, update_permission_property

	if not frappe.db.exists("Custom DocPerm", {"parent": "Loan", "role": "Citizen"}):
		add_permission("Loan", "Citizen", 0)
	for ptype, value in (
		("read", 1),
		("create", 0),
		("write", 0),
		("delete", 0),
		("submit", 0),
		("cancel", 0),
		("export", 0),
		("report", 0),
	):
		update_permission_property("Loan", "Citizen", 0, ptype, value)
	frappe.db.commit()


def make_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)
	make_property_setters()
	frappe.db.commit()


def make_property_setters():
	"""Desk list ergonomics: the default list badge on a submittable doctype
	shows docstatus (Draft/Submitted/Cancelled), so surface lending's actual
	status (Open/Approved/Rejected) as a list column and standard filter."""
	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	for prop in ("in_list_view", "in_standard_filter"):
		make_property_setter(
			"Loan Application",
			"status",
			prop,
			"1",
			"Check",
			validate_fields_for_doctype=False,
		)

	# Loan.monthly_repayment_amount is `fetch_from: loan_application.repayment_amount`,
	# which Frappe re-applies on every save of a new Loan — so the instalment
	# lending computed on the REQUESTED amount overwrote the one book_loan asks
	# lending to compute on the APPROVED amount. Fetch only when empty, and the
	# figure lending works out at booking is the one that stays.
	make_property_setter(
		"Loan",
		"monthly_repayment_amount",
		"fetch_if_empty",
		"1",
		"Check",
		validate_fields_for_doctype=False,
	)


def ensure_lending_defaults():
	"""Seed the lending masters the portal relies on: a demand offset order
	(mandatory for any Loan Product), the company collection sequences, and one
	standard Loan Product, then turns on loan accounting so the ledger actually
	gets written. Idempotent — invoked by scripts/create-site.sh."""
	make_custom_fields()

	company = frappe.db.get_single_value("Global Defaults", "default_company")
	if not company:
		company = frappe.db.get_value("Company", {}, "name")
	if not company:
		print("no company found — run the setup wizard first")
		return

	if not frappe.db.get_value("Loan Demand Offset Order", {"title": OFFSET_ORDER_TITLE}):
		order = frappe.new_doc("Loan Demand Offset Order")
		order.title = OFFSET_ORDER_TITLE
		for component in ("EMI (Principal + Interest)", "Penalty", "Charges"):
			order.append("components", {"demand_type": component})
		order.insert(ignore_permissions=True)
		print(f"created Loan Demand Offset Order: {OFFSET_ORDER_TITLE}")

	company_doc = frappe.get_doc("Company", company)
	changed = False
	for field in (
		"collection_offset_sequence_for_standard_asset",
		"collection_offset_sequence_for_sub_standard_asset",
	):
		if not company_doc.get(field):
			company_doc.set(field, OFFSET_ORDER_TITLE)
			changed = True
	if changed:
		company_doc.save(ignore_permissions=True)

	if not frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME}):
		product = frappe.new_doc("Loan Product")
		product.update(
			{
				"company": company,
				"product_code": "GDB-STD",
				"product_name": LOAN_PRODUCT_NAME,
				"is_term_loan": 1,
				"repayment_schedule_type": "Monthly as per repayment start date",
				# The configured rate at birth, not a placeholder corrected later
				# by ensure_product_terms: a site whose after_migrate never ran
				# would otherwise lend at whatever was hard-coded here.
				"rate_of_interest": policy.rate_of_interest(),
				"maximum_loan_amount": policy.sme_loan_ceiling(),
				"collection_offset_sequence_for_standard_asset": OFFSET_ORDER_TITLE,
				"collection_offset_sequence_for_sub_standard_asset": OFFSET_ORDER_TITLE,
			}
		)
		product.insert(ignore_permissions=True)
		print(f"created Loan Product: {LOAN_PRODUCT_NAME}")

	frappe.db.commit()

	ensure_loan_accounting(company)
	ensure_quick_loan_product()


def ensure_quick_loan_product():
	"""Seed the Quick Loan as a copy of the standard product, so it inherits the
	company, the offset order and all sixteen ledger accounts — lending makes
	those mandatory once loan accounting is on, and a Quick Loan disbursed
	against different accounts would be money the ledger reports apart from
	the rest of the book. Only the name, the code and the ceiling differ.
	Idempotent."""
	if frappe.db.get_value("Loan Product", {"product_name": QUICK_LOAN_PRODUCT_NAME}):
		return
	standard = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	if not standard:
		print(f"Loan Product {LOAN_PRODUCT_NAME} not found — skipping {QUICK_LOAN_PRODUCT_NAME}")
		return

	product = frappe.copy_doc(frappe.get_doc("Loan Product", standard))
	product.update(
		{
			"product_code": QUICK_LOAN_PRODUCT_CODE,
			"product_name": QUICK_LOAN_PRODUCT_NAME,
			"rate_of_interest": policy.rate_of_interest(),
			"maximum_loan_amount": policy.quick_loan_ceiling(),
		}
	)
	product.insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"created Loan Product: {QUICK_LOAN_PRODUCT_NAME}")


def _product_terms(product_name: str, rate: float) -> dict:
	terms = {"rate_of_interest": rate, "validate_normal_repayment": 1}
	if product_name == QUICK_LOAN_PRODUCT_NAME:
		terms["maximum_loan_amount"] = policy.quick_loan_ceiling()
	elif product_name == LOAN_PRODUCT_NAME:
		terms["maximum_loan_amount"] = policy.sme_loan_ceiling()
	return terms


def ensure_product_terms():
	"""Hold every GDB product at the configured rate — zero unless a deployment
	says otherwise (utils/policy) — because lending computes interest into every
	schedule from it and the portal would show citizens interest they were
	promised they would never be charged. `validate_normal_repayment` puts a
	ceiling on a Normal Repayment so a payment cannot exceed what is due;
	api.make_repayment picks Advance Payment when a citizen pays ahead, which
	is the type that ceiling does not apply to. Each product's loan ceiling (SME
	and Quick) is held the same way, so changing one is a configuration change,
	never a release.
	Idempotent."""
	rate, rate_source = policy.resolve()
	for product_name in GDB_PRODUCT_NAMES:
		product = frappe.db.get_value("Loan Product", {"product_name": product_name})
		if not product:
			continue

		terms = _product_terms(product_name, rate)
		current = frappe.db.get_value("Loan Product", product, list(terms), as_dict=True)
		if all(current.get(k) == v for k, v in terms.items()):
			continue

		doc = frappe.get_doc("Loan Product", product)
		doc.update(terms)
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		print(f"set terms on {product} from {rate_source}: {terms}")


def _group_account(company: str, base_name: str) -> str | None:
	"""Resolve a group account by its base name, so the company abbreviation
	suffix ERPNext appends ("Direct Income - GDB") never gets hard-coded."""
	return frappe.db.get_value(
		"Account", {"company": company, "account_name": base_name, "is_group": 1}, "name"
	)


def ensure_loan_accounting(company: str | None = None):
	"""Enable loan accounting and give the Loan Product the sixteen accounts
	lending then makes mandatory.

	Until this runs, every accounting hook in lending is an early `return`
	rather than an error (loan_controller.py, loan_disbursement.py,
	loan_repayment.py and friends), so loans disburse and repay while writing
	nothing at all to the general ledger. Idempotent."""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	if not company:
		company = frappe.db.get_value("Company", {}, "name")
	if not company:
		print("no company found — cannot enable loan accounting")
		return

	if not frappe.db.has_column("Company", "enable_loan_accounting"):
		print("lending's enable_loan_accounting field is missing — skipping")
		return

	product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	if not product:
		print(f"Loan Product {LOAN_PRODUCT_NAME} not found — skipping loan accounting")
		return

	accounts = {}
	for field, account_name, parent_base, root_type, account_type in LOAN_ACCOUNT_SPECS:
		existing = frappe.db.get_value(
			"Account", {"company": company, "account_name": account_name}, "name"
		)
		if existing:
			accounts[field] = existing
			continue

		parent = _group_account(company, parent_base)
		if not parent:
			print(f"parent group {parent_base!r} not found for {company} — skipping {account_name}")
			continue

		account = frappe.new_doc("Account")
		account.update(
			{
				"company": company,
				"account_name": account_name,
				"parent_account": parent,
				"root_type": root_type,
				"is_group": 0,
			}
		)
		if account_type:
			account.account_type = account_type
		account.insert(ignore_permissions=True)
		accounts[field] = account.name
		print(f"created account: {account.name}")

	missing = [f for f, *_ in LOAN_ACCOUNT_SPECS if f not in accounts]
	if missing:
		# Enabling the company flag without all sixteen would make the Loan
		# Product unsaveable, so leave accounting off rather than wedge it.
		print(f"not enabling loan accounting — missing accounts for: {', '.join(missing)}")
		return

	if not frappe.db.get_value("Company", company, "enable_loan_accounting"):
		frappe.db.set_value("Company", company, "enable_loan_accounting", 1)
		print(f"enabled loan accounting on {company}")

	# Every GDB product posts to the same sixteen accounts: one loan book.
	for name in GDB_PRODUCT_NAMES:
		product = frappe.db.get_value("Loan Product", {"product_name": name})
		if not product:
			continue
		product_doc = frappe.get_doc("Loan Product", product)
		changed = False
		for field, value in accounts.items():
			if product_doc.get(field) != value:
				product_doc.set(field, value)
				changed = True
		if changed:
			product_doc.save(ignore_permissions=True)
			print(f"wired {len(accounts)} GL accounts onto {product}")

	frappe.db.commit()


LENDING_RULE_PROPOSAL_DOCTYPE = "GDB Lending Rule Proposal"
LENDING_RULE_PROPOSAL_WORKFLOW = "GDB Lending Rule Proposal Workflow"

# Standard Frappe workflow vocabulary throughout — no new Workflow State or
# Workflow Action Master records, so this reads in the desk exactly like any
# other workflow. (state, doc_status, allow_edit) — allow_edit is mandatory on
# a Workflow Document State row, so every state names a role even though the
# doctype's own field-level read_only and docstatus already do most of the
# real locking once a proposal leaves Draft.
_RULE_PROPOSAL_STATES = (
	("Draft", "0", "Finance Officer"),
	("Pending", "0", "Finance Officer"),
	("Approved", "1", "Finance Officer"),
	("Rejected", "0", "Finance Officer"),
)

# (state, action, next_state, allowed). Two rows per transition — Finance
# Officer and System Manager — because a Workflow Transition's `allowed` is a
# single role; both need to reach the same action.
_RULE_PROPOSAL_TRANSITIONS = (
	("Draft", "Submit", "Pending", "Finance Officer"),
	("Draft", "Submit", "Pending", "System Manager"),
	("Pending", "Approve", "Approved", "Finance Officer"),
	("Pending", "Approve", "Approved", "System Manager"),
	("Pending", "Reject", "Rejected", "Finance Officer"),
	("Pending", "Reject", "Rejected", "System Manager"),
)


def ensure_lending_rule_proposal_workflow():
	"""The maker-checker workflow behind Finance's lending-rule proposals.

	Built here, on migrate, rather than only through fixtures/: everything else
	GDB needs on a fresh site is created the same way, with no desk step in
	between. Self-approval is refused twice over — the role gate here lets any
	Finance Officer decide a Pending proposal, and
	gdb_lending_rule_proposal.py's before_save refuses the SAME officer who
	proposed it, the same shape as api.disburse_loan's four-eyes check.
	Idempotent, and does nothing until the doctype it drives exists.
	"""
	if not frappe.db.exists("DocType", LENDING_RULE_PROPOSAL_DOCTYPE):
		return
	if frappe.db.exists("Workflow", LENDING_RULE_PROPOSAL_WORKFLOW):
		return

	# Belt and suspenders: real Frappe sites ship these master rows already,
	# but a stripped-down one might not, and the Workflow below links to them.
	for state, _doc_status, _allow_edit in _RULE_PROPOSAL_STATES:
		if not frappe.db.exists("Workflow State", state):
			try:
				frappe.get_doc(
					{"doctype": "Workflow State", "workflow_state_name": state}
				).insert(ignore_permissions=True)
			except Exception:
				frappe.log_error(title=f"could not create Workflow State {state}")
	for _state, action, _next_state, _allowed in _RULE_PROPOSAL_TRANSITIONS:
		if not frappe.db.exists("Workflow Action Master", action):
			try:
				frappe.get_doc(
					{"doctype": "Workflow Action Master", "workflow_action_name": action}
				).insert(ignore_permissions=True)
			except Exception:
				frappe.log_error(title=f"could not create Workflow Action Master {action}")

	workflow = frappe.new_doc("Workflow")
	workflow.workflow_name = LENDING_RULE_PROPOSAL_WORKFLOW
	workflow.document_type = LENDING_RULE_PROPOSAL_DOCTYPE
	workflow.workflow_state_field = "workflow_state"
	workflow.is_active = 1
	workflow.send_email_alert = 0
	for state, doc_status, allow_edit in _RULE_PROPOSAL_STATES:
		workflow.append(
			"states", {"state": state, "doc_status": doc_status, "allow_edit": allow_edit}
		)
	for state, action, next_state, allowed in _RULE_PROPOSAL_TRANSITIONS:
		workflow.append(
			"transitions",
			{"state": state, "action": action, "next_state": next_state, "allowed": allowed},
		)
	workflow.insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"created workflow: {LENDING_RULE_PROPOSAL_WORKFLOW}")


def complete_setup_wizard():
	"""Complete the ERPNext first-boot setup wizard headlessly so the desk is
	usable immediately. Idempotent — invoked by scripts/create-site.sh."""
	from frappe.utils import cint, nowdate

	if cint(frappe.db.get_single_value("System Settings", "setup_complete")):
		print("setup wizard already complete")
		return

	from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

	# The wizard's set_missing_values() sources country/currency/time_zone from
	# System Settings, so those must be set BEFORE setup_complete runs.
	system_settings = frappe.get_single("System Settings")
	system_settings.update(
		{
			"country": "Guyana",
			"currency": "GYD",
			"time_zone": "America/Guyana",
			"language": "en",
		}
	)
	system_settings.save()
	frappe.db.commit()

	year = nowdate()[:4]
	frappe.set_user("Administrator")
	setup_complete(
		{
			"language": "English",
			"country": "Guyana",
			"timezone": "America/Guyana",
			"time_zone": "America/Guyana",
			"currency": "GYD",
			"company_name": "Guyana Development Bank",
			"company_abbr": "GDB",
			"chart_of_accounts": "Standard",
			"fy_start_date": f"{year}-01-01",
			"fy_end_date": f"{year}-12-31",
			"setup_demo": 0,
		}
	)
	frappe.db.commit()
	print("setup wizard completed for Guyana Development Bank")
