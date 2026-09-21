import os

import frappe

from gdb_bank.rbac import provisioning
from gdb_bank.security import eid as eid_mod

# Legacy roles from the pre-registry build. They are still created so existing
# accounts and any hand-written Permission Manager rows keep resolving;
# `provisioning.reconcile()` grants every holder the equivalent GDB role.
# NEW ROLES DO NOT GO HERE — add a PersonaSpec in rbac/personas.py instead.
LEGACY_ROLES = (("Citizen", 0), ("Loan Underwriter", 1))

LOAN_PRODUCT_NAME = "GDB Standard Loan"
OFFSET_ORDER_TITLE = "GDB Standard Offset Order"

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

# The e-ID mirror. Every GDB row scopes on the e-ID rather than on the email or
# the Frappe owner (features.md: queues identify people by e-ID), so the User
# record has to carry it. Written only by security/eid.bind_to_user from a
# verified Keycloak claim — hence read_only and unique.
IDENTITY_CUSTOM_FIELDS = {
	"User": [
		{
			"fieldname": "gdb_eid",
			"label": "e-ID",
			"fieldtype": "Data",
			"length": 32,
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"insert_after": "username",
			"description": (
				"Three-box national identity number, mirrored from the Keycloak "
				"token. Row-level security keys on this field."
			),
		},
	],
}


def ensure_roles():
	"""Create the legacy roles only. The GDB personas are created by
	`provisioning.reconcile()` from `rbac/personas.py`."""
	for role_name, desk_access in LEGACY_ROLES:
		if not frappe.db.exists("Role", role_name):
			frappe.get_doc(
				{
					"doctype": "Role",
					"role_name": role_name,
					"desk_access": desk_access,
				}
			).insert(ignore_permissions=True)
	frappe.db.commit()


def make_identity_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(IDENTITY_CUSTOM_FIELDS, ignore_validate=True)
	frappe.db.commit()


def after_install():
	ensure_roles()
	make_identity_custom_fields()
	provisioning.reconcile()


def after_migrate():
	"""Every deploy converges the site onto the registry.

	Order matters: the e-ID field must exist before anything scopes on it, and
	the legacy roles must exist before reconcile() migrates their holders.
	"""
	ensure_roles()
	make_identity_custom_fields()
	provisioning.reconcile()
	if "lending" in frappe.get_installed_apps():
		make_custom_fields()

	# Defined since 2026-09-21 but never called, so `bench migrate` ran clean
	# and the dashboard stayed empty - a seeder nothing invokes looks exactly
	# like a seeder that ran and found nothing to do. It is idempotent (it
	# counts existing rows first), so running it on every migrate is safe.
	make_demo_applications()


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
	standard Loan Product. Loan accounting stays disabled on the company, so no
	GL accounts are required. Idempotent — invoked by scripts/create-site.sh."""
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


def make_demo_users():
	"""Create one demo portal account per persona.

	Password comes from GDB_DEMO_PASSWORD (or ADMIN_PASSWORD) - invoked by
	scripts/create-site.sh via `bench execute`. These are LOCAL accounts for
	development: real deployments provision users from Keycloak. Each demo
	account carries a 999-prefixed e-ID that cannot collide with a real one.

	The accounts themselves come from `rbac/demo.py`, which the Keycloak seeder
	also derives from - the two sides must name the same person by the same
	e-ID or sign-in fails as "incorrect password" for an account that exists.
	"""
	password = os.environ.get("GDB_DEMO_PASSWORD") or os.environ.get("ADMIN_PASSWORD")
	if not password:
		print("GDB_DEMO_PASSWORD/ADMIN_PASSWORD not set - skipping demo users")
		return

	from frappe.utils.password import update_password

	from gdb_bank.rbac import demo
	from gdb_bank.rbac import personas as reg

	by_key = {persona.key: persona for persona in reg.ACTIVE_PERSONAS}

	for identity in demo.identities():
		persona = by_key[identity.persona]
		if frappe.db.exists("User", identity.email):
			continue

		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": identity.email,
				"first_name": identity.full_name,
				"user_type": "System User" if persona.desk_access else "Website User",
				"send_welcome_email": 0,
				"enabled": 1,
			}
		)
		user.flags.ignore_permissions = True
		user.insert()

		# Assign the Role Profile rather than the bare role: that is the unit an
		# administrator actually grants, and it carries the bundled roles
		# (lending's Loan Manager and so on) with it.
		if frappe.db.exists("Role Profile", persona.profile_name):
			user.role_profile_name = persona.profile_name
			user.flags.ignore_permissions = True
			user.save()
		else:
			user.add_roles(persona.role)

		eid_mod.bind_to_user(user.name, identity.eid)
		update_password(user.name, password)
		print(f"created {persona.key:22} {identity.email:34} e-ID {identity.eid}")

	frappe.db.commit()


def demo_data_enabled() -> bool:
	"""Whether this site may create fabricated loan records.

	OFF UNLESS ASKED. These rows are indistinguishable from real credit
	applications once they are in the table - one of them is an APPROVED
	facility for two million dollars against a citizen's e-ID. In a production
	database that is not test data, it is a fake loan book: it lands in the
	portfolio aggregate the Board reads, in any reconciliation the Finance
	persona runs, and in the audit trail, with nothing marking it as synthetic.

	So the gate is an explicit environment variable, not `developer_mode`
	(unset even on this dev site, so it would have silently disabled the
	seeder here too) and not "is the table empty" (a freshly restored
	production site is also empty). `docker-compose.yml` sets it for the local
	stack; a real deployment simply does not, and `after_migrate` skips it.

	Same pattern as `make_demo_users`, which already declines to run without
	GDB_DEMO_PASSWORD.
	"""
	flag = os.environ.get("GDB_SEED_DEMO_DATA")
	return bool(flag) and flag.strip().lower() in ("1", "true", "yes", "on")


# (case-file status, lending status or None, amount, purpose, business type)
#
# A Draft has no lending counterpart on purpose: a draft has not been submitted
# to the Bank, so there is nothing for `Loan Application` to represent. It
# exists in the case file only, which is why the dashboard shows two rows while
# `GDB Loan Application` holds three.
DEMO_APPLICATIONS = (
	("Submitted", "Open", 800000, "Retail shop expansion", "Existing Business"),
	("Approved", "Approved", 2000000, "Start new manufacturing venture", "New Venture"),
	("Draft", None, 1500000, "Purchase of new agricultural equipment", "Existing Business"),
)


def make_demo_applications():
	"""Seed a few applications for the demo citizen across different stages.

	WHY THIS WRITES TWO DOCTYPES
	    `GDB Loan Application` is the case file (implementation_record §7,
	    Option B) and is where this data belongs. But the dashboard calls
	    `gdb_bank.api.my_loans`, which is still `v0_legacy.my_loans` and reads
	    lending's `Loan Application` filtered on the `gdb_owner` custom field.
	    Seeding only the case file therefore puts rows in the database that no
	    screen can see - which is what "No applications yet" was showing.

	    This dual write is scaffolding, not architecture. When §4.6's
	    `api/v1_applications.py` read path lands on top of
	    `repositories/applications.py`, delete the lending half and the
	    `legacy_status` column of DEMO_APPLICATIONS with it.
	"""
	if not demo_data_enabled():
		print("GDB_SEED_DEMO_DATA is not set - skipping demo applications")
		return

	from frappe.utils import now_datetime, nowdate

	from gdb_bank.api.v0_legacy import _get_or_create_customer
	from gdb_bank.rbac import demo

	citizen = next((ident for ident in demo.identities() if ident.persona == "citizen"), None)
	if not citizen:
		return

	user = frappe.db.get_value("User", {eid_mod.EID_USER_FIELD: citizen.eid}, "name")
	if not user:
		print(f"no Frappe user for demo e-ID {citizen.eid} - skipping demo applications")
		return

	product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})
	if not product:
		ensure_lending_defaults()
		product = frappe.db.get_value("Loan Product", {"product_name": LOAN_PRODUCT_NAME})

	if frappe.db.count("GDB Loan Application", {"subject_eid": citizen.eid}):
		print("demo applications already exist - skipping")
		return

	customer = _get_or_create_customer(user)
	company = frappe.db.get_value("Loan Product", product, "company")

	for status, legacy_status, amount, purpose, business_type in DEMO_APPLICATIONS:
		case = frappe.new_doc("GDB Loan Application")
		case.applicant_name = citizen.full_name
		case.subject_eid = citizen.eid
		case.status = status
		case.application_route = "Sole Trader"
		case.business_type = business_type
		case.product = LOAN_PRODUCT_NAME
		case.requested_amount = amount
		case.term_months = 36
		case.purpose = purpose
		if status == "Approved":
			# Deliberately BELOW the request: features.md allows the Underwriter
			# to approve for less and never for more, and a demo that only ever
			# shows approved == requested never exercises the rule.
			case.approved_amount = amount * 0.9
			case.decided_by = user
			case.decided_on = now_datetime()
		case.insert(ignore_permissions=True)

		if not legacy_status:
			continue

		legacy = frappe.get_doc(
			{
				"doctype": "Loan Application",
				"applicant_type": "Customer",
				"applicant": customer,
				"applicant_name": citizen.full_name,
				"applicant_email_address": user,
				"company": company,
				"posting_date": nowdate(),
				"loan_product": product,
				"loan_amount": amount,
				"is_term_loan": 1,
				"repayment_method": "Repay Over Number of Periods",
				"repayment_periods": 36,
				"status": "Open",
				"gdb_owner": user,
				"gdb_purpose": purpose,
			}
		)
		legacy.flags.ignore_permissions = True
		legacy.insert()
		legacy.submit()
		if legacy_status != "Open":
			# `db_set` for the same reason `review_loan` uses it: the doc is
			# submitted, `status` is permlevel-guarded, the review fields are
			# allow_on_submit.
			legacy.db_set("status", legacy_status)
			legacy.db_set("gdb_reviewed_by", user)
			legacy.db_set("gdb_reviewed_on", now_datetime())

		print(f"created demo application: {status}")

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
