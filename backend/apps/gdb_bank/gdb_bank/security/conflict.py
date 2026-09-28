"""Are these two accounts the same person?

Staff sign in with a work email and citizens with their e-ID, so a GDB officer
who also borrows holds TWO accounts. Comparing account names would let that
officer decide or release their own loan from the staff one. The platform
admin records each staff member's national e-ID on the staff account
(`gdb_staff_eid`, services/accounts.py); a person is the same person when the
accounts match OR any e-ID either account carries matches.
"""

import frappe

_EID_FIELDS = ("gdb_eid", "gdb_staff_eid")


def is_same_person(officer: str, other: str | None) -> bool:
	if not other:
		return False
	if officer == other:
		return True
	rows = frappe.get_all(
		"User", filters={"name": ["in", [officer, other]]}, fields=["name", *_EID_FIELDS]
	)
	eids = {r.name: {r.get(f) for f in _EID_FIELDS} - {None, ""} for r in rows}
	return bool(eids.get(officer, set()) & eids.get(other, set()))
