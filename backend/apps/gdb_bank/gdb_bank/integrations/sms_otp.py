"""One-time codes by SMS, through Infobip (integrations/sms.py).

GDB makes the code (six random digits) and sends it at once, while the person
waits. Only a salted hash of it is kept — inside tin_auth's challenge, in the
cache — so the code itself is never in a log, the cache or the database.
tin_auth's challenge does the rest: what it was issued for, ten minutes, five
wrong tries.

ON WHEN INFOBIP IS SET UP (integrations/sms.py), unless GDB_SMS_OTP=0 — then,
as without Infobip, tin_auth falls back to its fixed demo code (GDB_STATIC_OTP)
— fine on a laptop, never in production.
"""

import hashlib
import hmac
import os
import secrets

import frappe
from frappe import _

from gdb_bank.integrations import sms

DIGITS = 6
TEXT = "Your GDB verification code is {code}. It expires in 10 minutes. Do not share it with anyone."

NOT_GUYANA = "Codes can only be sent to a Guyana mobile number (+592). Contact GDB for help."
CANNOT_RECEIVE = "This phone number cannot receive text messages. Use a mobile number."
UNAVAILABLE = "We could not send your code just now. Try again in a minute."


def configured() -> bool:
	switch = str(os.environ.get("GDB_SMS_OTP") or frappe.conf.get("gdb_sms_otp") or "").strip().lower()
	if switch in ("0", "false", "no", "off"):
		return False
	return sms.configured()


def _hash(salt: str, code: str) -> str:
	return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()


def send(phone: str | None) -> str:
	"""Send a fresh code by SMS; answers what to keep to check it later
	("salt$hash"). Raises a message fit for the person on failure."""
	number = sms.guyana_number(phone)
	if not number:
		frappe.throw(_(NOT_GUYANA))
	code = "".join(secrets.choice("0123456789") for _ in range(DIGITS))
	out = sms.deliver(number, TEXT.format(code=code))
	if not out.get("sent"):
		frappe.logger("gdb_bank").error(f"sms_otp: code not sent: {out.get('error')}")
		frappe.throw(_(CANNOT_RECEIVE if out.get("refused") else UNAVAILABLE))
	salt = secrets.token_hex(8)
	return f"{salt}${_hash(salt, code)}"


def check(kept: str | None, code: str | None) -> bool:
	"""Whether `code` is the one sent, against what send() answered."""
	code = (code or "").strip()
	if not (kept and code.isdigit() and "$" in kept):
		return False
	salt, digest = kept.split("$", 1)
	return hmac.compare_digest(_hash(salt, code), digest)
