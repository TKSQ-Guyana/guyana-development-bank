"""GDB's industry list of 2026-10-05 replaces the five priority sectors.

The old sectors and their sub-sectors are disabled, not deleted — a case already
classified under one keeps it. "Manufacturing" is on both lists: it stays on,
and loses the old sub-sectors. The new industries themselves are seeded by
install.ensure_sectors, on the after_migrate that follows."""

import frappe

from gdb_bank.install import RETIRED_SECTORS, SECTORS


def execute():
	if not frappe.db.table_exists("GDB Sector"):
		return
	keep = {name for name, _subs in SECTORS}
	for name in RETIRED_SECTORS:
		if name not in keep and frappe.db.exists("GDB Sector", name):
			frappe.db.set_value("GDB Sector", name, "disabled", 1, update_modified=False)
		for sub in frappe.get_all("GDB Sub Sector", filters={"sector": name}, pluck="name"):
			frappe.db.set_value("GDB Sub Sector", sub, "disabled", 1, update_modified=False)
	# The new order is the list's order.
	for order, (name, _subs) in enumerate(SECTORS):
		if frappe.db.exists("GDB Sector", name):
			frappe.db.set_value("GDB Sector", name, {"sort_order": order, "disabled": 0}, update_modified=False)
	frappe.db.commit()
