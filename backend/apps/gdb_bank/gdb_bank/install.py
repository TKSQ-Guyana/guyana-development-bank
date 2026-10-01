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
)

# The banks a citizen may nominate for a payout. Seeded, because the portal's
# payout destination is a Link to Bank and an empty list is an approved loan
# nobody can disburse. Bank of Guyana is here for GDB's own operating and
# collections accounts, not as a citizen destination.
BANKS = (
	"Bank of Guyana",
	"Citizens Bank Guyana",
	"Demerara Bank",
	"Guyana Bank for Trade and Industry",
	"Republic Bank (Guyana)",
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
QUICK_TRADE_LOCATIONS = ("From home", "Fixed location", "Mobile")
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
		"\nSole Trader\nPartnership\nCluster-supported\nIncorporated (Inc.)",
	),
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
	# C — business or venture description
	("gdb_executive_summary", "Executive Summary", "Small Text"),
	("gdb_products_services", "Products / Services", "Small Text"),
	("gdb_unique_selling_point", "Unique Selling Proposition", "Small Text"),
	("gdb_use_of_funds", "Expected Use of Funds", "Small Text"),
	("gdb_challenges", "Current Challenges", "Small Text"),
	("gdb_employment_impact", "Employment / Development Impact", "Small Text"),
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
	"Bank Account": [
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


def after_migrate():
	ensure_roles()
	make_user_custom_fields()
	ensure_lending_rule_proposal_workflow()
	if "erpnext" in frappe.get_installed_apps():
		make_erpnext_custom_fields()
		ensure_banks()
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
	for bank_name in BANKS:
		if not frappe.db.exists("Bank", bank_name):
			frappe.get_doc({"doctype": "Bank", "bank_name": bank_name}).insert(
				ignore_permissions=True
			)
	frappe.db.commit()


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
				"maximum_loan_amount": 0,
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
	return terms


def ensure_product_terms():
	"""Hold every GDB product at the configured rate — zero unless a deployment
	says otherwise (utils/policy) — because lending computes interest into every
	schedule from it and the portal would show citizens interest they were
	promised they would never be charged. `validate_normal_repayment` puts a
	ceiling on a Normal Repayment so a payment cannot exceed what is due;
	api.make_repayment picks Advance Payment when a citizen pays ahead, which
	is the type that ceiling does not apply to. The Quick Loan's ceiling is held
	the same way, so changing it is a configuration change, never a release.
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
