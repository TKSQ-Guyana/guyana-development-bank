"""The underwriter's sector classification of a case (the Credit risk tab).

  sector_options()                          the enabled sectors, each with its
                                            enabled sub-sectors, in order
  set_credit_sector(user, application, sector, sub_sector)

GDB's own view of the case, never the applicant's: an underwriter sets it, it
is hidden from citizens (formatters._STAFF_ONLY), and it can be changed until
the case is decided. The list itself is the desk's (GDB Sector / GDB Sub
Sector, seeded once by install.ensure_sectors).

The case is submitted, so the two fields are written with db_set — as
review_loan writes a submitted case — and each change is recorded as a Version
on the Loan Application: who, old and new values, when.
"""

import frappe
from frappe import _
from frappe.utils import cint

from gdb_bank.security.conflict import is_same_person
from gdb_bank.utils.session import _logger

SECTOR, SUB_SECTOR = "GDB Sector", "GDB Sub Sector"
FIELDS = ("gdb_credit_sector", "gdb_credit_sub_sector")


def sector_options() -> list[dict]:
	sectors = frappe.get_all(
		SECTOR, filters={"disabled": 0}, fields=["name"], order_by="sort_order asc, name asc"
	)
	subs = frappe.get_all(
		SUB_SECTOR,
		filters={"disabled": 0},
		fields=["name", "sector", "sub_sector_name"],
		order_by="sort_order asc, sub_sector_name asc",
	)
	return [
		{
			"sector": s.name,
			"sub_sectors": [{"name": x.name, "label": x.sub_sector_name} for x in subs if x.sector == s.name],
		}
		for s in sectors
	]


def set_credit_sector(user: str, application: str, sector: str, sub_sector: str) -> dict:
	"""Classify a case still in review. Both are required, and must agree."""
	row = frappe.db.get_value(
		"Loan Application",
		application,
		["name", "gdb_owner", "docstatus", "status", "gdb_reviewed_on", *FIELDS],
		as_dict=True,
	)
	if not row:
		frappe.throw(_("Loan Application {0} not found.").format(application))
	if cint(row.docstatus) != 1:
		frappe.throw(_("That application has not been submitted to GDB yet."))
	if row.status != "Open" or row.gdb_reviewed_on:
		frappe.throw(_("{0} has been decided; its classification is now fixed.").format(application))
	if is_same_person(user, row.gdb_owner):
		frappe.throw(_("You cannot classify your own application."), frappe.PermissionError)

	sector, sub_sector = (sector or "").strip(), (sub_sector or "").strip()
	if not sector or not sub_sector:
		frappe.throw(_("Choose a sector and a sub-sector."))
	if not frappe.db.get_value(SECTOR, {"name": sector, "disabled": 0}):
		frappe.throw(_("{0} is not a sector GDB classifies under.").format(sector))
	sub = frappe.db.get_value(SUB_SECTOR, sub_sector, ["sector", "disabled"], as_dict=True)
	if not sub or cint(sub.disabled):
		frappe.throw(_("{0} is not a sub-sector GDB classifies under.").format(sub_sector))
	if sub.sector != sector:
		frappe.throw(_("{0} is not a sub-sector of {1}.").format(sub_sector, sector))

	changes = {"gdb_credit_sector": sector, "gdb_credit_sub_sector": sub_sector}
	changed = [[f, row.get(f), v] for f, v in changes.items() if row.get(f) != v]
	if changed:
		frappe.get_doc("Loan Application", application).db_set(dict(changes))
		frappe.get_doc(
			{
				"doctype": "Version",
				"ref_doctype": "Loan Application",
				"docname": application,
				"data": frappe.as_json({"changed": changed, "comment": "Credit risk sector classification"}),
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()
		_logger().info(f"application {application}: classified {sector} / {sub_sector} by {user}")
	return {"credit_sector": sector, "credit_sub_sector": sub_sector}
