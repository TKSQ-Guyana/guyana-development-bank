"""Restore use-of-funds lines that migrate_use_of_funds_to_lines cut at 140 characters.

GDB Use Of Funds Line.item was first a Data field, which holds 140 characters,
and the migration trimmed each line to fit. An applicant who had written a
whole list into one line lost the end of it. The field is now Small Text; this
widens the column and puts the full wording back from the old JSON text.

Only a line whose current text is exactly the first 140 characters of its old
wording is touched — the truncation, and nothing else — so a line the
applicant has since edited on their draft is left as they wrote it. The amount
is never changed. Written with frappe.db.set_value, the same repair path as
normalise_profile_regions, because submitted applications refuse a normal save.
"""

import frappe

LINE = "GDB Use Of Funds Line"
FIELD = "gdb_use_of_funds_lines"
DATA_LENGTH = 140


def execute():
	if "lending" not in frappe.get_installed_apps():
		return

	# Widen the column first: Small Text is a text column, Data was varchar(140).
	frappe.reload_doc("gdb_bank", "doctype", "gdb_use_of_funds_line")

	repaired = 0
	for app in frappe.get_all(
		"Loan Application",
		filters={"gdb_use_of_funds": ["like", "[%"]},
		fields=["name", "gdb_use_of_funds"],
	):
		try:
			rows = frappe.parse_json(app.gdb_use_of_funds)
		except Exception:
			continue
		if not isinstance(rows, list):
			continue

		# The same numbering the migration used: lines with an item, in order.
		full = [
			str(r["item"]).strip()
			for r in rows
			if isinstance(r, dict) and str(r.get("item") or "").strip()
		]
		lines = frappe.get_all(
			LINE,
			filters={"parent": app.name, "parenttype": "Loan Application", "parentfield": FIELD},
			fields=["name", "idx", "item"],
		)
		for line in lines:
			if not (1 <= line.idx <= len(full)):
				continue
			wording = full[line.idx - 1]
			if len(wording) > DATA_LENGTH and line.item == wording[:DATA_LENGTH]:
				frappe.db.set_value(LINE, line.name, "item", wording, update_modified=False)
				repaired += 1

	frappe.db.commit()
	print(f"repair_use_of_funds_item_text: restored {repaired} truncated use-of-funds line(s)")
