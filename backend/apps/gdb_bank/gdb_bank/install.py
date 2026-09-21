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


# One demo account per persona, so every role in the registry can actually be
# exercised locally. Derived from the registry: adding a PersonaSpec gives you a
# demo login for it automatically, with a deterministic e-ID.
DEMO_DOMAIN = "gdb.gov.gy"
DEMO_EID_PREFIX = "999"


def _demo_account(persona, index: int) -> tuple[str, str, str]:
	local = persona.key.replace("_", ".")
	return (
		f"{local}@{DEMO_DOMAIN}",
		f"Demo {persona.title}",
		f"{DEMO_EID_PREFIX}-{1000 + index:04d}-{index:03d}",
	)


def make_demo_users():
	"""Create one demo portal account per persona.

	Password comes from GDB_DEMO_PASSWORD (or ADMIN_PASSWORD) - invoked by
	scripts/create-site.sh via `bench execute`. These are LOCAL accounts for
	development: real deployments provision users from Keycloak. Each demo
	account carries a 999-prefixed e-ID that cannot collide with a real one.
	"""
	password = os.environ.get("GDB_DEMO_PASSWORD") or os.environ.get("ADMIN_PASSWORD")
	if not password:
		print("GDB_DEMO_PASSWORD/ADMIN_PASSWORD not set - skipping demo users")
		return

	from frappe.utils.password import update_password

	from gdb_bank.rbac import personas as reg

	for index, persona in enumerate(reg.ACTIVE_PERSONAS, start=1):
		email, full_name, demo_eid = _demo_account(persona, index)
		if frappe.db.exists("User", email):
			continue

		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": full_name,
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

		eid_mod.bind_to_user(user.name, demo_eid)
		update_password(user.name, password)
		print(f"created {persona.key:22} {email:34} e-ID {demo_eid}")

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
