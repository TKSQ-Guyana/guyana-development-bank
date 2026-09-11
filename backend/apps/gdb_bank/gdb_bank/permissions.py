"""Row-level rules that let a borrower read the loans that are theirs.

lending checks `frappe.has_permission("Loan", "read", doc=...)` inside
calculate_amounts and its whitelisted APIs, so a citizen needs a real read
permission on Loan. It is granted at role level in install.py and scoped to
the right rows here — the framework does the filtering, not the portal.
"""

import frappe


def _is_staff(user: str) -> bool:
	from gdb_bank.api import UNDERWRITER_ROLES

	return user == "Administrator" or bool(set(frappe.get_roles(user)) & UNDERWRITER_ROLES)


def _visible_applications(user: str) -> list[str]:
	"""Applications this citizen may see: their own, plus the head's
	application for a cluster they belong to."""
	from gdb_bank.api import _cluster_of

	names = frappe.get_all("Loan Application", filters={"gdb_owner": user}, pluck="name")

	cluster = _cluster_of(user)
	if cluster:
		head = frappe.db.get_value("GDB Cluster", cluster, "head")
		if head:
			names += frappe.get_all(
				"Loan Application",
				filters={"gdb_cluster": cluster, "gdb_owner": head},
				pluck="name",
			)

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
