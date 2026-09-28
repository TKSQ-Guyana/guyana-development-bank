"""In-app notifications, on Frappe's own Notification Log.

Type "Alert" never emails, so these stay in the portal. The SPA reads them from
/api/resource/Notification Log, which Frappe scopes to the reader (for_user),
and marks them read with Frappe's own notification_log.mark_as_read.
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
