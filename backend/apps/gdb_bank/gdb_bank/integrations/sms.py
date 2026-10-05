"""Text messages to applicants, through Infobip (SMS API v3).

The personalised notes GDB sends — "we received your appointment request",
"we received your application" — and, through integrations/sms_otp.py, the
one-time sign-up and sign-in codes.

OFF UNTIL CONFIGURED, and never in the way. Without the three settings below,
nothing is sent and nothing fails. A note is queued to the background worker
after the request commits, so a slow or failing Infobip never holds up, or
undoes, the action the note is about.

  INFOBIP_BASE_URL     the account's own API address, e.g. https://xxxxx.api.infobip.com
  INFOBIP_API_KEY      sent as "Authorization: App <key>"
  INFOBIP_SENDER       the sender name or number the texts come from

Environment first, site_config.json as the alternative (infobip_* in lower case).
"""

import os
import re

import frappe
import requests
from frappe import _

from gdb_bank.utils.formatters import _normalised_phone

PATH = "/sms/3/messages"
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
	base = _setting("infobip_base_url").rstrip("/")
	if base and not base.startswith(("https://", "http://")):
		base = "https://" + base
	return {"base": base, "key": _setting("infobip_api_key"), "sender": _setting("infobip_sender")}


def configured() -> bool:
	s = settings()
	return bool(s["base"] and s["key"] and s["sender"])


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


# Infobip's status groups that mean the text will not go out.
REFUSED = {"REJECTED", "UNDELIVERABLE", "EXPIRED"}


def deliver(to: str, body: str, record=None) -> dict:
	"""Send now (the background job, the one-time codes, and send_test). Never
	raises; answers {"sent": bool, "sid"?, "error"?} and records it on `record`."""
	record = tuple(record) if record else None
	s = settings()
	payload = {
		"messages": [
			{
				"sender": s["sender"],
				# Infobip takes the number without the "+": 5926354444.
				"destinations": [{"to": to.lstrip("+")}],
				"content": {"text": body},
			}
		]
	}
	try:
		response = requests.post(
			s["base"] + PATH,
			json=payload,
			headers={"Authorization": f"App {s['key']}", "Accept": "application/json"},
			timeout=TIMEOUT,
		)
	except requests.RequestException as exc:
		error = f"Infobip unreachable: {type(exc).__name__}"
		frappe.logger("gdb_bank").error(f"sms: {error}: {exc}")
		_record(record, FAILED, error=error)
		return {"sent": False, "error": error}
	try:
		detail = response.json()
	except ValueError:
		detail = {}
	if response.status_code >= 400:
		problem = (detail.get("requestError") or {}).get("serviceException") or {}
		error = f"Infobip {response.status_code}: {problem.get('text') or detail.get('errorMessage') or getattr(response, 'reason', '')}"
		frappe.logger("gdb_bank").error(f"sms: refused ({error})")
		_record(record, FAILED, error=error)
		return {"sent": False, "error": error}
	message = (detail.get("messages") or [{}])[0]
	status = message.get("status") or {}
	sid = message.get("messageId")
	if (status.get("groupName") or "").upper() in REFUSED:
		error = f"Infobip {status.get('name')}: {status.get('description')}"
		frappe.logger("gdb_bank").error(f"sms: refused ({error})")
		_record(record, FAILED, sid=sid, error=error)
		return {"sent": False, "sid": sid, "error": error, "refused": True}
	_record(record, SENT, sid=sid)
	return {"sent": True, "sid": sid, "status": status.get("name")}


@frappe.whitelist(methods=["POST"])
def send_test(to: str) -> dict:
	"""Send one text now, to check the SMS settings — System Manager or
	Platform Admin. Answers what Infobip said."""
	roles = set(frappe.get_roles())
	if not roles & {"System Manager", "Platform Admin"}:
		frappe.throw(_("Only an administrator may send a test text."), frappe.PermissionError)
	if not configured():
		return {"sent": False, "error": "SMS is not set up: INFOBIP_BASE_URL, INFOBIP_API_KEY and INFOBIP_SENDER are needed."}
	number = guyana_number(to)
	if not number:
		return {"sent": False, "error": "Give a Guyana number: +592 and seven digits."}
	return deliver(number, "GDB portal: this is a test message. No reply is needed.")
