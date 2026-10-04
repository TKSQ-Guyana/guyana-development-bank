"""GDB's facilitated banks, set once (2026-10-04): GBTI, Scotiabank, Republic
Bank and Demerara Bank — with Scotiabank under its current name, not the
"Nova Scotia" an earlier seed used. After this the desk owns the list
(Bank > Facilitated for Applicants Without an Account).
"""

import frappe


def execute():
	if not frappe.db.has_column("Bank", "gdb_facilitated"):
		return
	from gdb_bank.install import FACILITATED_BANKS, ensure_banks

	ensure_banks()
	for bank in frappe.get_all("Bank", pluck="name"):
		frappe.db.set_value("Bank", bank, "gdb_facilitated", int(bank in FACILITATED_BANKS), update_modified=False)
	frappe.db.commit()
