"""Row-level rules that let a borrower read the loans that are theirs.

lending checks `frappe.has_permission("Loan", "read", doc=...)` inside
calculate_amounts and its whitelisted APIs, so a citizen needs a real read
permission on Loan. It is granted at role level in install.py and scoped to
the right rows here — the framework does the filtering, not the portal.
"""

import frappe

from gdb_bank.services.cluster import _clusters_of
from gdb_bank.utils.session import _is_staff


def _visible_applications(user: str) -> list[str]:
	"""Applications this citizen may see: their own, plus the head's
	application for every cluster they belong to."""
	names = frappe.get_all("Loan Application", filters={"gdb_owner": user}, pluck="name")

	# Two queries for every group this citizen is in, not two per group: this
	# runs on every Loan read a citizen makes, because it is the permission hook.
	clusters = _clusters_of(user)
	if clusters:
		heads = {
			row.name: row.head
			for row in frappe.get_all("GDB Cluster", filters={"name": ["in", clusters]}, fields=["name", "head"])
			if row.head
		}
		if heads:
			for row in frappe.get_all(
				"Loan Application",
				filters={"gdb_cluster": ["in", list(heads)], "gdb_owner": ["in", list(set(heads.values()))]},
				fields=["name", "gdb_cluster", "gdb_owner"],
			):
				# A head's application on THEIR group — not one they happen to
				# own on another group this citizen is also in.
				if heads[row.gdb_cluster] == row.gdb_owner:
					names.append(row.name)

	return list(dict.fromkeys(names))


def loan_query_conditions(user: str | None = None) -> str:
	user = user or frappe.session.user
	if _is_staff(user):
		return ""

	applications = _visible_applications(user)
	if not applications:
		return "1 = 0"

	joined = ", ".join(frappe.db.escape(name) for name in applications)
	return f"`tabLoan`.`loan_application` in ({joined})"


def loan_has_permission(doc, user: str | None = None, permission_type: str | None = None) -> bool:
	user = user or frappe.session.user
	if _is_staff(user):
		return True
	if permission_type not in (None, "read", "select"):
		return False

	name = doc if isinstance(doc, str) else doc.get("name")
	application = frappe.db.get_value("Loan", name, "loan_application")
	return bool(application) and application in _visible_applications(user)


# --------------------------------------------------------------------------
# Evidence: a citizen's own rows, and no one else's
#
# GDB Applicant Document and GDB Information Request both carry an `applicant`
# link, and for a citizen that single field is the whole rule — including
# between members of one cluster, whose financial evidence stays their own
# however much of a plan they share.
#
# Staff see every row: an underwriter reads the case, a finance officer reads
# what release is waiting on. Acting on a row is a different question, settled
# in gdb_bank/documents.py.
# --------------------------------------------------------------------------


def own_records_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	"""One function for both doctypes, because the rule is the same field.

	Frappe calls this as `frappe.call(fn, user, doctype=doctype)`, so the table
	is named rather than assumed — an unqualified column would be ambiguous the
	moment a query joins a child table.
	"""
	user = user or frappe.session.user
	if _is_staff(user):
		return ""
	column = f"`tab{doctype}`.`applicant`" if doctype else "`applicant`"
	return f"{column} = {frappe.db.escape(user)}"


def own_record_has_permission(doc, user: str | None = None, permission_type: str | None = None) -> bool:
	user = user or frappe.session.user
	if _is_staff(user):
		return True
	applicant = doc if isinstance(doc, str) else doc.get("applicant")
	return applicant == user


# The profile is keyed on `user` rather than `applicant`, so it gets its own
# pair rather than a generic field name nobody could read at a glance.


def profile_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	user = user or frappe.session.user
	if _is_staff(user):
		return ""
	column = f"`tab{doctype}`.`user`" if doctype else "`user`"
	return f"{column} = {frappe.db.escape(user)}"


def profile_has_permission(doc, user: str | None = None, permission_type: str | None = None) -> bool:
	user = user or frappe.session.user
	if _is_staff(user):
		# Staff read a profile; only its owner writes one. An officer editing an
		# applicant's declared details would be declaring on their behalf.
		return permission_type in (None, "read", "select", "report", "print")
	owner = doc if isinstance(doc, str) else doc.get("user")
	return owner == user
