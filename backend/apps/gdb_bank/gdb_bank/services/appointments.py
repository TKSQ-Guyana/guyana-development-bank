"""The GDB Representative's queue: appointment requests from the public site.

Anyone may ask for an appointment ("Book appointment" on the home page, or from
sign-up: no National ID, or a phone on record that is not theirs). Each lands
here as a GDB Appointment Request with status New; a GDB Representative calls
the person back and moves it on — Contacted, Booked, Closed — with a note.

  queue(status, search, start, page_length)    the requests, newest first
  update(user, name, status, note)             move one on, recorded as theirs
"""

import frappe
from frappe import _
from frappe.utils import cint

DOCTYPE = "GDB Appointment Request"
STATUSES = ("New", "Contacted", "Booked", "Closed")
FIELDS = [
	"name",
	"first_name",
	"last_name",
	"phone",
	"email",
	"region",
	"industry_sector",
	"reason",
	"national_id",
	"status",
	"requested_on",
	"handled_by",
	"outcome_note",
	"sms_status",
	"sms_error",
]
PAGE = 20


def queue(status: str | None = None, search: str | None = None, start=0, page_length=PAGE) -> dict:
	filters = {}
	if status in STATUSES:
		filters["status"] = status
	or_filters = None
	text = (search or "").strip()
	if text:
		like = f"%{text}%"
		or_filters = {"first_name": ["like", like], "last_name": ["like", like], "phone": ["like", like], "name": ["like", like]}
	start, page_length = max(cint(start), 0), min(max(cint(page_length) or PAGE, 1), 100)
	rows = frappe.get_all(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=FIELDS,
		order_by="creation desc",
		start=start,
		page_length=page_length,
	)
	total = len(frappe.get_all(DOCTYPE, filters=filters, or_filters=or_filters, pluck="name"))
	counts = {s: frappe.db.count(DOCTYPE, {"status": s}) for s in STATUSES}
	for row in rows:
		row["handled_by_name"] = frappe.utils.get_fullname(row.handled_by) if row.handled_by else None
	return {"rows": rows, "total": total, "counts": counts}


def update(user: str, name: str, status: str, note: str | None = None) -> dict:
	if not frappe.db.exists(DOCTYPE, name):
		frappe.throw(_("Appointment request {0} not found.").format(name))
	if status not in STATUSES:
		frappe.throw(_("Choose a status: {0}.").format(", ".join(STATUSES)))
	values = {"status": status, "handled_by": user}
	if note is not None:
		values["outcome_note"] = (note or "").strip()[:2000]
	frappe.db.set_value(DOCTYPE, name, values)
	frappe.db.commit()
	row = frappe.db.get_value(DOCTYPE, name, FIELDS, as_dict=True)
	row["handled_by_name"] = frappe.utils.get_fullname(user)
	return row
