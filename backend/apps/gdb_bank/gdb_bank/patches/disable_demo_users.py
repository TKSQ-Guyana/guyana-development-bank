"""Close the seeded demo accounts on sites that already have them.

install.make_demo_users ran on every boot of every environment and created
five fixed accounts with a known password — the Administrator's own whenever
no demo password was set. Four of them were System Users, so Frappe's own
password login opened them: an underwriter and a disbursement officer anybody
holding the admin password could sign in as. That function is gone; this
closes the accounts it left behind.

Disabled, not deleted. An account may be named on a decision or a release, and
Frappe refuses to delete a User that something links to. Closing one is the
same three steps as the platform administrator's kill switch
(services/accounts.set_user_enabled): disable it, replace the Frappe password
with one nobody holds, and end its open sessions — Frappe does not re-check
`enabled` when a session resumes.

A site that really does use one of these mailboxes re-enables it afterwards
through the platform administrator, deliberately and on the record.
"""

import frappe
from frappe.sessions import clear_sessions
from frappe.utils.password import update_password

from gdb_bank.services import access_audit

DEMO_USERS = (
	"underwriter@gdb.gov.gy",
	"finance@gdb.gov.gy",
	"financeofficer@gdb.gov.gy",
	"admin@gdb.gov.gy",
	"citizen@example.gy",
)


def execute():
	closed = 0
	for email in DEMO_USERS:
		if not frappe.db.get_value("User", email, "enabled"):
			continue
		frappe.db.set_value("User", email, "enabled", 0)
		update_password(email, frappe.generate_hash(length=32))
		clear_sessions(user=email, force=True)
		frappe.clear_cache(user=email)
		access_audit.record(
			"Administrator",
			access_audit.ACCOUNT_DISABLED,
			reason="Seeded demo account closed: it was created on every boot with a known password.",
			subject=email,
			subject_user=email,
			old="enabled",
			new="disabled",
		)
		closed += 1
	print(f"disable_demo_users: closed {closed} seeded account(s)")
