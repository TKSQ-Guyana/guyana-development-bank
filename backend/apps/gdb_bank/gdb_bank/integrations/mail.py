"""Email over SMTP — GDB's outgoing mail.

OFF UNTIL CONFIGURED. Nothing is sent, and nothing fails, until the SMTP login
and its (app) password are set — in the environment or site_config:

  GDB_SMTP_SERVER     gdb_smtp_server     default smtp.gmail.com
  GDB_SMTP_PORT       gdb_smtp_port       default 587 (STARTTLS)
  GDB_SMTP_USER       gdb_smtp_user       the mailbox to send as, e.g. gdb.portal@gmail.com
  GDB_SMTP_PASSWORD   gdb_smtp_password   its app password (Gmail: Google Account ->
                                          Security -> App passwords), never the
                                          account's own password
  GDB_MAIL_SENDER     gdb_mail_sender     display name, default "Guyana Development Bank"
  GDB_PORTAL_URL      gdb_portal_url      the portal's address for links in mail,
                                          default http://localhost:3000

On every migrate (and so on every backend start) `ensure_email_account` makes
ERPNext's own outgoing Email Account match these settings; Frappe then queues
and sends through it, with its retries and its Email Queue as the record of
what went out. `send` is what the portal calls; `send_test` lets an
administrator check the password works.

Who is mailed: a real address only. A TIN sign-up with no email has a
placeholder address under a domain reserved never to resolve; it is skipped.
"""

import os
from html import escape

import frappe
from frappe import _

ACCOUNT = "GDB Mail"
UNDELIVERABLE = (".invalid", "@example.com")


def _setting(key: str, env: str, default: str = "") -> str:
	return str(frappe.conf.get(key) or os.environ.get(env) or default).strip()


def settings() -> dict:
	return {
		"server": _setting("gdb_smtp_server", "GDB_SMTP_SERVER", "smtp.gmail.com"),
		"port": int(_setting("gdb_smtp_port", "GDB_SMTP_PORT", "587") or 587),
		"user": _setting("gdb_smtp_user", "GDB_SMTP_USER"),
		"password": _setting("gdb_smtp_password", "GDB_SMTP_PASSWORD"),
		"sender": _setting("gdb_mail_sender", "GDB_MAIL_SENDER", "Guyana Development Bank"),
		"portal": _setting("gdb_portal_url", "GDB_PORTAL_URL", "http://localhost:3000").rstrip("/"),
	}


def configured() -> bool:
	s = settings()
	return bool(s["server"] and s["user"] and s["password"])


def ensure_email_account() -> None:
	"""ERPNext's outgoing Email Account, made to match the settings. Without a
	password it is left alone (and mail stays off). Never fails a migrate."""
	if not configured() or not frappe.db.table_exists("Email Account"):
		return
	s = settings()
	values = {
		"email_id": s["user"],
		"email_account_name": ACCOUNT,
		"enable_outgoing": 1,
		"default_outgoing": 1,
		"enable_incoming": 0,
		"smtp_server": s["server"],
		"smtp_port": s["port"],
		"use_tls": 1 if s["port"] == 587 else 0,
		"use_ssl_for_outgoing": 1 if s["port"] == 465 else 0,
		"login_id": s["user"],
		"login_id_is_different": 0,
		"password": s["password"],
		"awaiting_password": 0,
		"always_use_account_email_id_as_sender": 1,
		"always_use_account_name_as_sender_name": 1,
	}
	try:
		name = frappe.db.exists("Email Account", ACCOUNT) or frappe.db.exists("Email Account", {"email_id": s["user"]})
		doc = frappe.get_doc("Email Account", name) if name else frappe.new_doc("Email Account")
		doc.update(values)
		# Frappe's own validate dials the server; a migrate must not depend on
		# the network. send_test is where the connection is proved.
		doc.flags.ignore_validate = True
		doc.save(ignore_permissions=True) if name else doc.insert(ignore_permissions=True)
		# Only one default outgoing account.
		for other in frappe.get_all("Email Account", filters={"default_outgoing": 1, "name": ["!=", doc.name]}, pluck="name"):
			frappe.db.set_value("Email Account", other, "default_outgoing", 0)
		frappe.db.commit()
	except Exception as exc:
		frappe.db.rollback()
		frappe.logger("gdb_bank").error(f"mail: could not set up the outgoing account: {type(exc).__name__}: {exc}")


def deliverable(address: str | None) -> bool:
	address = (address or "").strip().lower()
	return "@" in address and not address.endswith(UNDELIVERABLE) and address not in ("administrator", "guest")


def _wrap(heading: str, body_html: str, link: str | None) -> str:
	s = settings()
	button = (
		f'<p style="margin:24px 0"><a href="{escape(s["portal"] + link)}" '
		'style="background:#064e3b;color:#fff;padding:10px 18px;border-radius:8px;'
		'text-decoration:none;font-weight:700">Open the GDB portal</a></p>'
		if link
		else ""
	)
	return (
		'<div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a">'
		'<p style="font-size:12px;letter-spacing:2px;color:#b45309;font-weight:700;margin:0">GUYANA DEVELOPMENT BANK</p>'
		f'<h2 style="margin:6px 0 12px">{escape(heading)}</h2>'
		f"{body_html}{button}"
		'<p style="font-size:12px;color:#64748b;margin-top:28px">This message was sent by the GDB loan portal. '
		"GDB will never ask you for your password or your sign-in code by email.</p></div>"
	)


def send(to: str | None, subject: str, body_html: str = "", link: str | None = None) -> bool:
	"""Queue one email. False (and nothing sent) when mail is off or the address
	is not a real one. Never raises: a mail problem must not undo the action
	that caused it."""
	if not configured() or not deliverable(to):
		return False
	try:
		frappe.sendmail(
			recipients=[to],
			subject=subject,
			message=_wrap(subject, body_html, link),
			delayed=True,
		)
		return True
	except Exception as exc:
		frappe.logger("gdb_bank").error(f"mail: not queued for {to}: {type(exc).__name__}: {exc}")
		return False


@frappe.whitelist(methods=["POST"])
def send_test(to: str) -> dict:
	"""Send one email now, through the configured account — System Manager or
	Platform Admin. Answers whether it went, and why not."""
	roles = set(frappe.get_roles())
	if not roles & {"System Manager", "Platform Admin"}:
		frappe.throw(_("Only an administrator may send a test email."), frappe.PermissionError)
	if not configured():
		return {"sent": False, "reason": "SMTP is not configured: set GDB_SMTP_USER and GDB_SMTP_PASSWORD."}
	if not deliverable(to):
		return {"sent": False, "reason": "Give a real email address."}
	ensure_email_account()
	try:
		frappe.sendmail(
			recipients=[to],
			subject="GDB portal — test email",
			message=_wrap("It works", "<p>Outgoing email from the GDB loan portal is set up correctly.</p>", None),
			now=True,
		)
	except Exception as exc:
		return {"sent": False, "reason": f"{type(exc).__name__}: {exc}"}
	return {"sent": True}
