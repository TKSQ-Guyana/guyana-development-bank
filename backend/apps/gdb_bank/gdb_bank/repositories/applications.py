"""Reads of the loan case file.

`GDB Loan Application` is the case file — decided 2026-09-21, Option B in
`implementation_record.md` §7. lending's `Loan` is created only at booking.

WHY `frappe.get_list` AND NEVER `frappe.get_all`
    `get_all` does **not** apply permissions (implementation_record §3.2). The
    whole point of the row-scoping work in `security/row_level.py` is that the
    query layer enforces "a citizen sees only their own case" — and `get_all`
    walks straight past it. The legacy `api/v0_legacy.py` uses `get_all` with a
    hand-written filter, which is exactly the pattern this replaces: one
    forgotten filter and a citizen reads the portfolio.

    `get_list` runs `permission_query_conditions`, so the e-ID scope is applied
    by Frappe rather than remembered by each caller.
"""

from __future__ import annotations

import frappe

APPLICATION = "GDB Loan Application"

LIST_FIELDS = (
	"name",
	"applicant_name",
	"subject_eid",
	"status",
	"application_route",
	"business_type",
	"product",
	"requested_amount",
	"approved_amount",
	"term_months",
	"purpose",
	"submitted_on",
	"creation",
	"modified",
)


def list_for_current_user(limit: int = 50) -> list[dict]:
	"""Applications the caller may see, newest first.

	No `subject_eid` filter is written here on purpose. Adding one would work,
	and would also teach the next person that the filter is this function's
	job — at which point a function that forgets it becomes a data leak. The
	scope belongs to `permission_query_conditions`, once, for every query.
	"""
	return frappe.get_list(
		APPLICATION,
		fields=list(LIST_FIELDS),
		order_by="creation desc",
		limit_page_length=limit,
	)


def get_for_current_user(name: str) -> dict | None:
	"""One application, or None when the caller may not see it.

	None rather than a raised PermissionError so the caller can answer 404
	instead of 403. Telling an unauthorised caller that a case *exists* but is
	not theirs is itself a disclosure — the e-ID in the name would confirm that
	a given person has applied.
	"""
	if not frappe.has_permission(APPLICATION, doc=name):
		return None
	doc = frappe.get_doc(APPLICATION, name)
	return {field: doc.get(field) for field in LIST_FIELDS}


def count_by_status(statuses: tuple[str, ...]) -> int:
	"""How many of the caller's applications sit in any of `statuses`.

	Uses `get_list` too — a count that ignored permissions would leak the
	portfolio's size one integer at a time.
	"""
	rows = frappe.get_list(
		APPLICATION,
		filters={"status": ("in", list(statuses))},
		fields=["name"],
		limit_page_length=0,
	)
	return len(rows)
