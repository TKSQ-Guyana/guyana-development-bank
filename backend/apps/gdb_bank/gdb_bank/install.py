import os

import frappe

# (role_name, desk_access) — Citizen is a website-user role (no desk), the
# underwriter is a system role so GDB staff can also use the ERPNext desk.
ROLES = (("Citizen", 0), ("Loan Underwriter", 1))


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
			update_password(user.name, password)
			print(f"created {user_type} {email} with role {role}")
	frappe.db.commit()
