"""Notifications: in the portal, on Frappe's own Notification Log — and by email.

Type "Alert" never emails by itself, so the portal copy stays in the portal. The
SPA reads them from /api/resource/Notification Log, which Frappe scopes to the
reader (for_user), and marks them read with Frappe's own mark_as_read.

The same notice is also emailed to the person's real address when outgoing mail
is configured (integrations/mail.py) — never to a placeholder address, and
never at the cost of the action that raised it.
"""

import frappe


def notify(user: str | None, subject: str, link: str, from_user: str | None = None) -> None:
	"""One alert in `user`'s inbox. `link` is the portal route it opens.

	No-op without a user: an invitee who has never signed in has no inbox yet.
	"""
	if not user:
		return
	frappe.get_doc(
		{
			"doctype": "Notification Log",
			"type": "Alert",
			"for_user": user,
			"from_user": from_user,
			"subject": subject,
			"link": link,
		}
	).insert(ignore_permissions=True)

	from gdb_bank.integrations import mail

	first = frappe.db.get_value("User", user, "first_name") or ""
	mail.send(
		frappe.db.get_value("User", user, "email") or user,
		subject,
		f"<p>Hello {frappe.utils.escape_html(first)},</p><p>{frappe.utils.escape_html(subject)}.</p>"
		"<p>Sign in to the GDB portal to see the details.</p>",
		link,
	)
