import os

import frappe

# (role_name, desk_access) — Citizen is a website-user role (no desk), the
# underwriter is a system role so GDB staff can also use the ERPNext desk.
ROLES = (("Citizen", 0), ("Loan Underwriter", 1))

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
			"description": "bank_registry (the switch), sandbox (not evidence), or unavailable.",
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
	if "erpnext" in frappe.get_installed_apps():
		make_erpnext_custom_fields()
		ensure_banks()
		ensure_accounts_read()
	if "lending" in frappe.get_installed_apps():
		make_custom_fields()
		ensure_loan_permissions()
		ensure_loan_accounting()
		ensure_product_terms()
		ensure_payment_file_report()


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
# and an underwriter who can post entries can move money on the books. The SOW
# asks for separation of duties, so an underwriter gets read and the `report`
# permission query_report.run demands — every other permission is set to 0
# explicitly rather than left to whatever add_permission defaults to.
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

ACCOUNTS_READER_ROLE = "Loan Underwriter"


def ensure_accounts_read():
	"""Let an underwriter read the ledger without being able to post to it."""
	from frappe.permissions import add_permission, update_permission_property

	for doctype in ACCOUNTS_READ_DOCTYPES:
		if not frappe.db.exists("DocType", doctype):
			continue
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

	for report in ACCOUNTS_REPORTS:
		if not frappe.db.exists("Report", report):
			continue
		# A standard Report cannot be edited outside developer mode, so the role
		# goes on a Custom Role instead. Note that Report.is_permitted REPLACES
		# the standard roles with the custom ones when a Custom Role exists — so
		# the roles already on the report are carried across, or granting an
		# underwriter access would revoke it from every accountant.
		standard = frappe.get_all(
			"Has Role", filters={"parent": report, "parenttype": "Report"}, pluck="role"
		)
		wanted = sorted(set(standard) | {ACCOUNTS_READER_ROLE})

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
# portal's own underwriter, who is the only staff role the SPA has and whose
# Disbursements page this is. Nothing wider.
PAYMENT_FILE_REPORT = "GDB Disbursement Payment File"

PAYMENT_FILE_REF_DOCTYPE = "Loan Disbursement"

PAYMENT_FILE_ROLES = ("Accounts User", "Accounts Manager", "System Manager", ACCOUNTS_READER_ROLE)

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
ORDER BY ba.bank, ld.disbursement_date"""


def ensure_payment_file_report():
	"""Seed the payment file report and open both gates in front of it.

	A query report is guarded twice and the portal needs to clear both:
	`Report.is_permitted` reads the roles on the report itself, and then
	`query_report.run` demands the `report` permission on its ref_doctype. The
	underwriter held neither by right — the ref_doctype check passed only by way
	of lending's `Loan Manager`, which the demo user happens to carry and a real
	underwriter would not, so that grant is made here on the role the portal
	actually uses rather than left to a coincidence of the seed data.

	Read and report only. An underwriter must be able to pull the file, never to
	post a disbursement — the same separation `ensure_accounts_read` keeps over
	the ledger.
	"""
	from frappe.permissions import add_permission, update_permission_property

	if not frappe.db.exists("DocType", PAYMENT_FILE_REF_DOCTYPE):
		return

	if not frappe.db.exists("Report", PAYMENT_FILE_REPORT):
		frappe.get_doc(
			{
				"doctype": "Report",
				"report_name": PAYMENT_FILE_REPORT,
				"ref_doctype": PAYMENT_FILE_REF_DOCTYPE,
				"report_type": "Query Report",
				"is_standard": "No",
				"module": "GDB Bank",
				"query": PAYMENT_FILE_QUERY,
			}
		).insert(ignore_permissions=True)

	# Roles are a union, so a grant somebody made in the desk survives a migrate.
	report = frappe.get_doc("Report", PAYMENT_FILE_REPORT)
	wanted = sorted({r.role for r in report.roles} | set(PAYMENT_FILE_ROLES))
	if sorted({r.role for r in report.roles}) != wanted:
		report.roles = []
		for role in wanted:
			report.append("roles", {"role": role})
		report.save(ignore_permissions=True)

	if not frappe.db.exists(
		"Custom DocPerm", {"parent": PAYMENT_FILE_REF_DOCTYPE, "role": ACCOUNTS_READER_ROLE}
	):
		add_permission(PAYMENT_FILE_REF_DOCTYPE, ACCOUNTS_READER_ROLE, 0)
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
			PAYMENT_FILE_REF_DOCTYPE, ACCOUNTS_READER_ROLE, 0, ptype, value
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
				"rate_of_interest": 8.0,
				"maximum_loan_amount": 0,
				"collection_offset_sequence_for_standard_asset": OFFSET_ORDER_TITLE,
				"collection_offset_sequence_for_sub_standard_asset": OFFSET_ORDER_TITLE,
			}
		)
		product.insert(ignore_permissions=True)
		print(f"created Loan Product: {LOAN_PRODUCT_NAME}")

	frappe.db.commit()

	ensure_loan_accounting(company)


def ensure_product_terms():
	"""GDB lends interest-free, so the product carries a 0% rate — otherwise
	lending computes interest into every schedule and the portal shows citizens
	interest they will never be charged. `validate_normal_repayment` puts a
	ceiling on a Normal Repayment so a payment cannot exceed what is due;
	api.make_repayment picks Advance Payment when a citizen pays ahead, which
	is the type that ceiling does not apply to. Idempotent."""
	product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	if not product:
		return

	terms = {"rate_of_interest": 0, "validate_normal_repayment": 1}
	current = frappe.db.get_value("Loan Product", product, list(terms), as_dict=True)
	if all(current.get(k) == v for k, v in terms.items()):
		return

	doc = frappe.get_doc("Loan Product", product)
	doc.update(terms)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	print(f"set interest-free terms on {product}: {terms}")


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


def make_demo_users():
	"""Create demo portal accounts. Password comes from GDB_DEMO_PASSWORD (or
	ADMIN_PASSWORD) in the environment — invoked by scripts/create-site.sh via
	`bench execute`."""
	password = os.environ.get("GDB_DEMO_PASSWORD") or os.environ.get("ADMIN_PASSWORD")
	if not password:
		print("GDB_DEMO_PASSWORD/ADMIN_PASSWORD not set — skipping demo users")
		return

	demo_users = (
		("underwriter@gdb.gov.gy", "GDB Underwriter", "System User", "Loan Underwriter"),
		("citizen@example.gy", "Demo Citizen", "Website User", "Citizen"),
	)
	from frappe.utils.password import update_password

	for email, full_name, user_type, role in demo_users:
		if not frappe.db.exists("User", email):
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": full_name,
					"user_type": user_type,
					"send_welcome_email": 0,
					"enabled": 1,
				}
			).insert(ignore_permissions=True)
			user.add_roles(role)
			# GDB staff also get lending's desk role so the Lending workspace
			# and doctypes are visible to them in ERPNext.
			if user_type == "System User" and frappe.db.exists("Role", "Loan Manager"):
				user.add_roles("Loan Manager")
			update_password(user.name, password)
			print(f"created {user_type} {email} with role {role}")
	frappe.db.commit()


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
