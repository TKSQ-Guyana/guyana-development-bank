"""Grandfather existing Finance Officer holders onto Disbursement Officer.

Money release used to be Finance Officer's job (api.disburse_loan gated on
_require_finance). It now gates on _require_disbursement instead, so anyone
who could release funds yesterday needs Disbursement Officer today or loses
that ability the moment this ships — additive only, on purpose: this patch
grants, it never revokes. A site that wants real separation of duties removes
one of the two roles from a specific user afterwards, deliberately, the same
way install.REVOKED_MONEY_ROLES documents an intentional removal elsewhere.

install.ensure_roles() creates the Disbursement Officer role itself; this
patch only re-grants it to users who already held Finance Officer.
"""

import frappe


def execute():
	from gdb_bank.install import ensure_roles

	ensure_roles()

	holders = frappe.get_all(
		"Has Role", filters={"role": "Finance Officer", "parenttype": "User"}, pluck="parent"
	)
	updated = 0
	for user in holders:
		if "Disbursement Officer" not in frappe.get_roles(user):
			frappe.get_doc("User", user).add_roles("Disbursement Officer")
			updated += 1

	if updated:
		frappe.db.commit()
	print(f"split_finance_roles: granted Disbursement Officer to {updated} existing Finance Officer user(s)")
