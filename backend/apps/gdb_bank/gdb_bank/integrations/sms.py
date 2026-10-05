"""Text messages to applicants, through Twilio Programmable Messaging.

The personalised notes GDB sends — "we received your appointment request",
"we received your application" — not the one-time codes, which go through
Twilio Verify (integrations/sms_otp.py).

OFF UNTIL CONFIGURED, and never in the way. Without the account and a sender,
nothing is sent and nothing fails. A message is queued to the background
worker after the request commits, so a slow or failing Twilio never holds up,
or undoes, the action the message is about.

  TWILIO_ACCOUNT_SID              the same account as the codes
  TWILIO_AUTH_TOKEN
  TWILIO_MESSAGING_SERVICE_SID    MG…, Twilio console → Messaging → Services   (preferred)
  TWILIO_FROM_NUMBER              +1…, a Twilio number able to text Guyana     (or this)
  GDB_PUBLIC_URL                  the portal's public address, e.g. https://loans.gdb.gov.gy —
                                  when set, Twilio reports each text's delivery back to
                                  status_callback below (Delivered / Undelivered + error code)

Environment first, site_config.json as the alternative (twilio_* in lower case).
"""

import base64
import hashlib
import hmac
import os
import re

import frappe
import requests
from frappe import _

from gdb_bank.utils.formatters import _normalised_phone

API = "https://api.twilio.com/2010-04-01/Accounts/{account}/Messages.json"
TIMEOUT = 15

APPOINTMENT_RECEIVED = (
	"Hi {first_name}, we received your SMB loan request for {sector} sector. "
	"Our team will contact you soon. Thank you - GDB Team"
)
APPLICATION_RECEIVED = (
	"Hi {first_name}, we received your SMB loan application for {sector} sector. "
	"Our team will contact you soon. Thank you - GDB Team"
)


def _setting(key: str) -> str:
	return str(os.environ.get(key.upper()) or frappe.conf.get(key) or "").strip()


def settings() -> dict:
	return {
		"account": _setting("twilio_account_sid"),
		"token": _setting("twilio_auth_token"),
		"service": _setting("twilio_messaging_service_sid"),
		"from": _setting("twilio_from_number"),
		"public": _setting("gdb_public_url").rstrip("/"),
	}


CALLBACK_PATH = "/api/method/gdb_bank.integrations.sms.status_callback"


def callback_url() -> str | None:
	"""Where Twilio reports delivery — only with a public address to give it."""
	base = settings()["public"]
	return f"{base}{CALLBACK_PATH}" if base.startswith("https://") else None


def configured() -> bool:
	s = settings()
	return bool(s["account"] and s["token"] and (s["service"] or s["from"]))


# Guyana only, for now: +592 and seven digits.
GUYANA = re.compile(r"^\+592\d{7}$")

# What a record says about its text (GDB Appointment Request.sms_status).
SENT, FAILED, QUEUED, OFF, NO_NUMBER = "Sent", "Failed", "Queued", "SMS not set up", "No Guyana number"


def guyana_number(phone: str | None) -> str | None:
	"""+592 and seven digits, from however it was typed — or None."""
	number = _normalised_phone(phone)
	return number if number and GUYANA.match(number) else None


def _record(record: tuple | None, status: str, sid: str | None = None, error: str | None = None) -> None:
	"""Write how the text went onto the record it is about, when there is one."""
	if not record:
		return
	doctype, name = record
	try:
		frappe.db.set_value(
			doctype,
			name,
			{"sms_status": status, "sms_sid": sid, "sms_error": (error or "")[:500] or None},
			update_modified=False,
		)
		frappe.db.commit()
	except Exception as exc:
		frappe.logger("gdb_bank").error(f"sms: could not record status on {doctype} {name}: {exc}")


def send(phone: str | None, body: str, record: tuple | None = None) -> bool:
	"""Queue one text to a Guyana number. False (and nothing queued) when SMS
	is off or there is no +592 number to send to. Never raises.

	`record` — (doctype, name) of what the text is about — has the outcome
	written onto it (sms_status / sms_sid / sms_error), so whoever works the
	record can see whether the person was told."""
	number = guyana_number(phone)
	if not (body or "").strip():
		return False
	if not number:
		_record(record, NO_NUMBER)
		return False
	if not configured():
		_record(record, OFF)
		return False
	try:
		frappe.enqueue(
			"gdb_bank.integrations.sms.deliver",
			queue="short",
			enqueue_after_commit=True,
			to=number,
			body=body.strip(),
			record=list(record) if record else None,
		)
		_record(record, QUEUED)
		return True
	except Exception as exc:
		frappe.logger("gdb_bank").error(f"sms: not queued: {type(exc).__name__}: {exc}")
		_record(record, FAILED, error=f"Not queued: {exc}")
		return False


def deliver(to: str, body: str, record=None) -> dict:
	"""Send now (the background job, and send_test). Never raises; answers
	{"sent": bool, "sid"?, "error"?} and records it on `record`."""
	record = tuple(record) if record else None
	s = settings()
	data = {"To": to, "Body": body}
	if callback_url():
		data["StatusCallback"] = callback_url()
	if s["service"]:
		data["MessagingServiceSid"] = s["service"]
	else:
		data["From"] = s["from"]
	try:
		response = requests.post(
			API.format(account=s["account"]), data=data, auth=(s["account"], s["token"]), timeout=TIMEOUT
		)
	except requests.RequestException as exc:
		error = f"Twilio unreachable: {type(exc).__name__}"
		frappe.logger("gdb_bank").error(f"sms: {error}: {exc}")
		_record(record, FAILED, error=error)
		return {"sent": False, "error": error}
	try:
		detail = response.json()
	except ValueError:
		detail = {}
	if response.status_code >= 400:
		error = f"Twilio {detail.get('code')}: {detail.get('message')}"
		frappe.logger("gdb_bank").error(f"sms: refused ({response.status_code}, {error})")
		_record(record, FAILED, error=error)
		return {"sent": False, "error": error}
	_record(record, SENT, sid=detail.get("sid"))
	return {"sent": True, "sid": detail.get("sid"), "status": detail.get("status")}


@frappe.whitelist(methods=["POST"])
def send_test(to: str) -> dict:
	"""Send one text now, to check the Twilio settings — System Manager or
	Platform Admin. Answers what Twilio said."""
	roles = set(frappe.get_roles())
	if not roles & {"System Manager", "Platform Admin"}:
		frappe.throw(_("Only an administrator may send a test text."), frappe.PermissionError)
	if not configured():
		return {
			"sent": False,
			"error": "SMS is not set up: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and "
			"TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM_NUMBER) are needed.",
		}
	number = guyana_number(to)
	if not number:
		return {"sent": False, "error": "Give a Guyana number: +592 and seven digits."}
	return deliver(number, "GDB portal: this is a test message. No reply is needed.")


# Twilio's delivery statuses -> what the record says. Later news never gives
# way to earlier: a "sent" arriving after "delivered" changes nothing.
DELIVERY = {"delivered": "Delivered", "undelivered": "Undelivered", "failed": "Failed"}
DOCTYPES = ("GDB Appointment Request",)


def _signature_ok(url: str, params: dict, signature: str | None) -> bool:
	"""Twilio's X-Twilio-Signature: HMAC-SHA1 of the URL and the sorted POST
	parameters, keyed with the auth token."""
	token = settings()["token"]
	if not (token and signature):
		return False
	payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
	expected = base64.b64encode(hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()).decode()
	return hmac.compare_digest(expected, signature)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def status_callback(**_kwargs):
	"""Twilio reporting how a text went. Signed by Twilio — anything else is
	refused — and it only ever updates the delivery status of a record that
	already carries that message's SID."""
	params = {k: v for k, v in frappe.form_dict.items() if k != "cmd"}
	url = callback_url()
	if not url or not _signature_ok(url, params, frappe.get_request_header("X-Twilio-Signature")):
		frappe.logger("gdb_bank").warning("sms: status callback refused (bad or missing signature)")
		frappe.local.response["http_status_code"] = 403
		return
	sid, status = params.get("MessageSid"), (params.get("MessageStatus") or "").lower()
	if not sid or status not in DELIVERY:
		return
	code = params.get("ErrorCode")
	for doctype in DOCTYPES:
		name = frappe.db.get_value(doctype, {"sms_sid": sid})
		if name:
			frappe.db.set_value(
				doctype,
				name,
				{"sms_status": DELIVERY[status], "sms_error": f"Twilio {code}" if code else None},
				update_modified=False,
			)
			frappe.db.commit()
			frappe.logger("gdb_bank").info(f"sms: {sid} {status} ({doctype} {name})")
