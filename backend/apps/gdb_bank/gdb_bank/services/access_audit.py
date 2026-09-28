"""The access trail: who changed which account or setting, from what, to what,
when, and why.

Every platform-admin write calls `record` inside the same transaction as the
change it describes. The row lands in GDB Access Change, which refuses edits
and deletes (gdb_access_change.py), so the trail cannot be rewritten through
any application API.
"""

import frappe
from frappe.utils import cint, now_datetime

DOCTYPE = "GDB Access Change"

ACCOUNT_CREATED = "Account Created"
ROLES_CHANGED = "Roles Changed"
ACCOUNT_DISABLED = "Account Disabled"
ACCOUNT_ENABLED = "Account Enabled"
# Only ever written by the retired emailed-link flow; kept so older rows still
# read as what they were.
SET_PASSWORD_EMAIL_SENT = "Set-Password Email Sent"
# The administrator was shown a one-time password. The password is never
# recorded — only that one was issued, by whom, and why.
ONE_TIME_PASSWORD_ISSUED = "One-Time Password Issued"
# The person replaced it with their own at first sign-in. Recorded as their own
# act, so a one-time password somebody else used first shows up as a chosen
# password its owner never chose.
PASSWORD_CHOSEN = "Password Chosen"
SETTINGS_CHANGED = "Integration Settings Changed"

FIELDS = ["name", "action", "subject", "subject_user", "actor", "acted_on", "old_value", "new_value", "reason"]

MAX_PAGE = 100


def _text(value) -> str | None:
	if value is None:
		return None
	if isinstance(value, list | tuple | set):
		return ", ".join(sorted(str(v) for v in value)) or "(none)"
	return str(value)


def record(
	actor: str,
	action: str,
	*,
	reason: str,
	subject: str,
	subject_user: str | None = None,
	old=None,
	new=None,
) -> str:
	doc = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"action": action,
			"subject": subject,
			"subject_user": subject_user,
			"actor": actor,
			"acted_on": now_datetime(),
			"old_value": _text(old),
			"new_value": _text(new),
			"reason": reason,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def history(subject_user: str | None = None, start=0, page_length=50) -> dict:
	"""Newest first. `has_more` rather than a total: counting a table that only
	ever grows is the one query here that would get slower every day."""
	page_length = max(1, min(cint(page_length) or 50, MAX_PAGE))
	start = max(0, cint(start))
	filters = {"subject_user": subject_user} if subject_user else {}
	rows = frappe.get_all(
		DOCTYPE,
		filters=filters,
		fields=FIELDS,
		order_by="creation desc",
		limit_start=start,
		limit_page_length=page_length + 1,
	)
	return {"rows": rows[:page_length], "has_more": len(rows) > page_length}


def last_change(subject: str) -> dict | None:
	rows = frappe.get_all(
		DOCTYPE,
		filters={"action": SETTINGS_CHANGED, "subject": subject},
		fields=["actor", "acted_on"],
		order_by="creation desc",
		limit_page_length=1,
	)
	return rows[0] if rows else None
