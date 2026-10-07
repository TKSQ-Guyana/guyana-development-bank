"""Notifications: in the portal, on Frappe's own Notification Log — and by email
or, failing that, by text.

Type "Alert" never emails by itself, so the portal copy stays in the portal. The
SPA reads them from /api/resource/Notification Log, which Frappe scopes to the
reader (for_user), and marks them read with Frappe's own mark_as_read.

Outside the portal, ONE channel per person (GDB, 2026-10-07): email when they
have a real address and outgoing mail is configured (integrations/mail.py);
otherwise a text to their phone, when the caller wrote one (`sms`). A citizen
who signed up by National ID, or came from the MPS call list, holds only a
placeholder address, so for them it is the text. Never at the cost of the
action that raised it.
"""

import frappe


def phone_of(user: str) -> str | None:
	"""Where a text to this person goes: the account's mobile, else the profile's."""
	phone = frappe.db.get_value("User", user, "mobile_no")
	if not phone:
		row = frappe.db.get_value("GDB Citizen Profile", {"user": user}, ["phone", "verified_phone"], as_dict=True)
		phone = row and (row.phone or row.verified_phone)
	return phone or None


def email_of(user: str) -> str | None:
	"""Where an email to this person goes: the account's own address when it is
	a real one, else the one they gave on their profile. A citizen who signed up
	by National ID, or came from the MPS call list, signs in under a placeholder
	address (tin_auth.PLACEHOLDER_DOMAIN) — their real one, if any, is the
	profile's."""
	from gdb_bank.integrations import mail

	own = frappe.db.get_value("User", user, "email") or user
	if mail.deliverable(own):
		return own
	declared = frappe.db.get_value("GDB Citizen Profile", {"user": user}, "email")
	return declared if mail.deliverable(declared) else None


def notify(
	user: str | None, subject: str, link: str, from_user: str | None = None, sms: str | None = None
) -> str | None:
	"""One alert in `user`'s inbox. `link` is the portal route it opens.
	Answers the outside channel used: "email", "sms" or None.

	No-op without a user: an invitee who has never signed in has no inbox yet.
	"""
	if not user:
		return None
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
	if mail.send(
		email_of(user),
		subject,
		f"<p>Hello {frappe.utils.escape_html(first)},</p><p>{frappe.utils.escape_html(subject)}.</p>"
		"<p>Sign in to the GDB portal to see the details.</p>",
		link,
	):
		return "email"
	if sms:
		from gdb_bank.integrations import sms as texts

		if texts.send(phone_of(user), sms):
			return "sms"
	return None
