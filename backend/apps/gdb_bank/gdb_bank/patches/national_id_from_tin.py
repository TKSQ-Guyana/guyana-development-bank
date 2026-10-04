"""Run from install.after_migrate (after the custom field exists), not as a
one-off patch — so it is idempotent: an account already moved is skipped.

Accounts opened online before 2026-10-03 were keyed by the number the KYC
register knows a person by, under the name "TIN". That number is their National
ID: move it to gdb_national_id, where sign-up, sign-in and the register now
look for it, and leave the TIN empty — they may add their real one.

The Keycloak username is the same number, so they sign in exactly as before.
"""

import frappe


def execute():
	if not frappe.db.has_column("User", "gdb_national_id"):
		return
	rows = frappe.get_all(
		"User",
		filters={"gdb_tin": ["is", "set"], "gdb_national_id": ["is", "not set"], "user_type": "Website User"},
		fields=["name", "gdb_tin"],
	)
	for row in rows:
		frappe.db.set_value("User", row.name, {"gdb_national_id": row.gdb_tin, "gdb_tin": None}, update_modified=False)
