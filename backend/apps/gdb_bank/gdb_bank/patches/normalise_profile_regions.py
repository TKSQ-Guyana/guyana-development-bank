"""Repair profile regions stored off-list — a hyphen for the dash, or the dash
lost to a wrong text encoding ("Region 4 � Demerara-Mahaica"). Such a value
made every later save of that profile fail its Select validation.

New writes can no longer store one: GDBCitizenProfile.validate normalises the
region through the same canonical_region used here.
"""

import frappe

from gdb_bank.gdb_bank.doctype.gdb_citizen_profile.gdb_citizen_profile import DOCTYPE, canonical_region


def execute():
	# pre_model_sync: on a site older than the doctype the table does not exist
	# yet, so there is no stored region to repair.
	if not frappe.db.table_exists(DOCTYPE):
		return

	fixed = 0
	for row in frappe.get_all(DOCTYPE, filters={"region": ["is", "set"]}, fields=["name", "region"]):
		region = canonical_region(row.region)
		if region != row.region:
			frappe.db.set_value(DOCTYPE, row.name, "region", region, update_modified=False)
			fixed += 1
	print(f"normalise_profile_regions: repaired {fixed} profile region(s)")
