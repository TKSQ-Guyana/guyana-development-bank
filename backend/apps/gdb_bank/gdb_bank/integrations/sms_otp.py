"""One-time codes by SMS, through Twilio Verify.

Twilio Verify makes the code, sends it, and checks it: the code never passes
through GDB's servers, so it is never in a log, the cache or the database.
tin_auth keeps its own challenge around each code (what it was issued for,
ten minutes, five wrong tries); this module only sends and checks.

OFF UNTIL CONFIGURED. Without the three settings below, tin_auth falls back to
its fixed demo code (GDB_STATIC_OTP) — fine on a laptop, never in production.

  TWILIO_ACCOUNT_SID          twilio_account_sid          AC…, Twilio console → Account info
  TWILIO_AUTH_TOKEN           twilio_auth_token           the account's auth token (a secret)
  TWILIO_VERIFY_SERVICE_SID   twilio_verify_service_sid   VA…, Twilio console → Verify → Services

Environment first, site_config.json as the alternative (the same convention
as integrations/mail.py). Calls Twilio's REST API directly with `requests`, so
no SDK is added to the image.
"""

import os

import frappe
import requests
from frappe import _

from gdb_bank.utils.formatters import _normalised_phone

API = "https://verify.twilio.com/v2/Services/{service}/{endpoint}"
TIMEOUT = 15

# Twilio error codes worth telling the person about, in words they can act on.
# https://www.twilio.com/docs/api/errors
FRIENDLY = {
	60200: "That phone number is not valid. Check it and try again.",
	60203: "Too many codes have been sent to this phone. Wait 10 minutes, then try again.",
	60205: "This phone number cannot receive text messages. Use a mobile number.",
	60212: "Too many codes have been sent to this phone. Wait 10 minutes, then try again.",
	60410: "Codes cannot be sent to this phone number right now. Contact GDB for help.",
	60605: "Codes cannot be sent to this country. Contact GDB for help.",
}
UNAVAILABLE = "We could not send your code just now. Try again in a minute."


def _setting(key: str, env: str) -> str:
	return str(os.environ.get(env) or frappe.conf.get(key) or "").strip()


def settings() -> dict:
	return {
		"account": _setting("twilio_account_sid", "TWILIO_ACCOUNT_SID"),
		"token": _setting("twilio_auth_token", "TWILIO_AUTH_TOKEN"),
		"service": _setting("twilio_verify_service_sid", "TWILIO_VERIFY_SERVICE_SID"),
	}


def configured() -> bool:
	s = settings()
	return bool(s["account"] and s["token"] and s["service"])


def _phone(phone: str | None) -> str:
	"""The number in E.164 (+592…), as Twilio needs it, or a clear refusal."""
	number = _normalised_phone(phone)
	if not number:
		frappe.throw(_("There is no valid phone number to send your code to. Contact GDB for help."))
	return number


def _post(endpoint: str, data: dict) -> dict:
	s = settings()
	try:
		response = requests.post(
			API.format(service=s["service"], endpoint=endpoint),
			data=data,
			auth=(s["account"], s["token"]),
			timeout=TIMEOUT,
		)
	except requests.RequestException as exc:
		frappe.logger("gdb_bank").error(f"sms_otp: {endpoint} unreachable: {type(exc).__name__}: {exc}")
		frappe.throw(_(UNAVAILABLE))
	try:
		body = response.json()
	except ValueError:
		body = {}
	if response.status_code >= 400:
		body["_status"] = response.status_code
	return body


def send(phone: str | None) -> None:
	"""Send a fresh code by SMS. Raises a message fit for the person on failure."""
	number = _phone(phone)
	body = _post("Verifications", {"To": number, "Channel": "sms"})
	if body.get("_status"):
		code = body.get("code")
		frappe.logger("gdb_bank").error(
			f"sms_otp: send refused ({body['_status']}, Twilio {code}): {body.get('message')}"
		)
		frappe.throw(_(FRIENDLY.get(code, UNAVAILABLE)))


def check(phone: str | None, code: str | None) -> bool:
	"""Whether `code` is the one Twilio sent to this phone. False for a wrong,
	expired or used code; raises only when Twilio cannot be reached."""
	code = (code or "").strip()
	if not code.isdigit():
		return False
	body = _post("VerificationCheck", {"To": _phone(phone), "Code": code})
	if body.get("_status"):
		# 404 / 60202: no pending code (expired, used, or too many tries).
		frappe.logger("gdb_bank").info(f"sms_otp: check refused ({body['_status']}, Twilio {body.get('code')})")
		return False
	return body.get("status") == "approved"
