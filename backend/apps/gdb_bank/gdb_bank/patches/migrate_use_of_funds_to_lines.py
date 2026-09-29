"""Unpack each application's use-of-funds JSON text into GDB Use Of Funds Line rows.

The lines used to be packed as JSON into the gdb_use_of_funds Small Text field,
which no query can total — so the total was added up in the browser. They now
live in the gdb_use_of_funds_lines child table, one Currency amount per row,
and the total is Frappe's SUM over them.

patches.txt has no sections, so this runs BEFORE the model sync: it loads the
child doctype and the Custom Field itself rather than waiting for after_migrate.

Submitted applications are migrated too. A submitted document refuses an
ordinary save, so each row goes in with the child document's own db_insert —
Frappe's ORM insert for a child row, no SQL string — once, here, and never from
the portal. Idempotent: an application that already has lines is skipped. The
old text is left where it was, unread, rather than rewritten.
"""

import frappe
from frappe.utils import flt

LINE = "GDB Use Of Funds Line"
FIELD = "gdb_use_of_funds_lines"


def execute():
	if "lending" not in frappe.get_installed_apps():
		return

	frappe.reload_doc("gdb_bank", "doctype", "gdb_use_of_funds_line")
	from gdb_bank.install import make_custom_fields

	make_custom_fields()

	already = set(
		frappe.get_all(
			LINE,
			filters={"parenttype": "Loan Application", "parentfield": FIELD},
			pluck="parent",
		)
	)

	moved = 0
	for app in frappe.get_all(
		"Loan Application",
		filters={"gdb_use_of_funds": ["like", "[%"]},
		fields=["name", "gdb_use_of_funds"],
	):
		if app.name in already:
			continue
		try:
			rows = frappe.parse_json(app.gdb_use_of_funds)
		except Exception:
			continue
		if not isinstance(rows, list):
			continue

		idx = 0
		for row in rows:
			if not isinstance(row, dict) or not str(row.get("item") or "").strip():
				continue
			idx += 1
			frappe.get_doc(
				{
					"doctype": LINE,
					"parent": app.name,
					"parenttype": "Loan Application",
					"parentfield": FIELD,
					"idx": idx,
					"item": str(row["item"]).strip(),
					"amount": flt(row.get("amount")),
				}
			).db_insert()
		if idx:
			moved += 1

	frappe.db.commit()
	print(f"migrate_use_of_funds_to_lines: moved {moved} application(s) onto use-of-funds lines")
