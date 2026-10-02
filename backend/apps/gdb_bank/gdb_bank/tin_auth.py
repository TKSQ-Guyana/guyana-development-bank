"""TIN sign-up and TIN sign-in, each finished with a one-time code.

THE THIRD CITIZEN DOOR. Beside the e-ID door (identity.password_login), a
citizen may open an account with their GRA Taxpayer Identification Number and
a password of their own, and sign in with the same two. The architecture does
not change: the password lives in KEYCLOAK — the citizen realm, with the TIN as
the account's username — and this module only ever mints the ordinary Frappe
`sid` once Keycloak and the one-time code have both said yes. Which accounts
this door may open is security/sign_in_policy.py (citizens only, as the e-ID
door).

  request_signup_otp(...)     check the form, open a code challenge
  complete_signup(...)        the code, then: Keycloak account, Frappe user,
                              the identity document, and a signed-in session
  tin_login(tin, password)    Keycloak password grant, then a code challenge
  verify_login_otp(...)       the code, then a signed-in session

NOTHING IS CREATED BEFORE THE CODE. Sign-up's first call writes nothing but a
short-lived challenge in the cache; the accounts and the document are made by
the second call, after the code is checked. An abandoned sign-up therefore
holds no TIN and leaves no half-made account behind.

THE CODE IS STATIC FOR NOW (`gdb_static_otp` in site_config or GDB_STATIC_OTP,
default 123456). Everything around it is already the real shape — a challenge
per attempt, bound to the TIN and phone it was issued for, expiring after ten
minutes and dying after five wrong codes — so sending a real code by SMS is a
change to `_issue` alone. A static code proves nothing about the phone: it must
not reach production.
"""

import base64
import os
import re
import secrets

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit

from gdb_bank import identity
from gdb_bank.integrations import keycloak_admin, kyc_registry
from gdb_bank.security import sign_in_policy
from gdb_bank.services.evidence import ALLOWED_EXTENSIONS, MAX_FILE_BYTES, is_what_it_claims
from gdb_bank.utils.formatters import _normalised_phone
from gdb_bank.utils.session import _logger

TIN_FIELD = "gdb_tin"
# A GRA Taxpayer Identification Number: nine digits.
TIN_SHAPE = re.compile(r"^\d{9}$")

# The identity documents a person may sign up with — one, attached. Filed as
# the person's own `Identity` document, which follows them across cases.
DOCUMENT_KINDS = ("National ID Card", "Passport", "Driver's Licence", "e-ID")

PASSWORD_MIN = 8
PASSWORD_MAX = 128
NAME_MAX = 60

OTP_TTL = 600
OTP_ATTEMPTS = 5
DEFAULT_STATIC_OTP = "123456"
SIGNUP = "signup"
LOGIN = "login"

# Frappe keys a User on email. A person who gives none gets this address,
# under a top-level domain reserved never to resolve (RFC 2606) — so it is
# unmistakably not theirs, and nothing is ever sent to it.
PLACEHOLDER_DOMAIN = "tin.gdb.invalid"


# --------------------------------------------------------------------------
# the one-time code
# --------------------------------------------------------------------------


def _static_otp() -> str:
	return str(frappe.conf.get("gdb_static_otp") or os.environ.get("GDB_STATIC_OTP") or DEFAULT_STATIC_OTP).strip()


def _key(challenge: str) -> str:
	return f"gdb_otp:{challenge}"


def _issue(purpose: str, **bound) -> dict:
	"""Open a challenge and (one day) send its code. Answers what the form needs."""
	challenge = secrets.token_urlsafe(24)
	frappe.cache.set_value(_key(challenge), {"purpose": purpose, "attempts": 0, **bound}, expires_in_sec=OTP_TTL)
	return {
		"challenge": challenge,
		"phone": _masked(bound.get("phone") or ""),
		"expires_in": OTP_TTL,
		# While codes are fixed the SPA says so, and which code to use. A real
		# sender drops both — the code then only ever travels to the phone.
		"static_code": True,
		"demo_code": _static_otp(),
	}


def _redeem(challenge: str, otp: str, purpose: str) -> dict:
	"""The challenge's bound values, once its code is right. Single use."""
	key = _key((challenge or "").strip())
	held = frappe.cache.get_value(key)
	if not held or held.get("purpose") != purpose:
		frappe.throw(_("This code has expired. Request a new one."))
	if held["attempts"] >= OTP_ATTEMPTS:
		frappe.cache.delete_value(key)
		frappe.throw(_("Too many incorrect codes. Request a new one."))
	if not secrets.compare_digest((otp or "").strip(), _static_otp()):
		held["attempts"] += 1
		frappe.cache.set_value(key, held, expires_in_sec=OTP_TTL)
		left = OTP_ATTEMPTS - held["attempts"]
		frappe.throw(_("Incorrect code. {0} tries left.").format(left) if left else _("Incorrect code. Request a new one."))
	frappe.cache.delete_value(key)
	return held


def _masked(phone: str) -> str:
	return kyc_registry.masked_phone(phone)


# --------------------------------------------------------------------------
# sign-up
# --------------------------------------------------------------------------


def _normalize_tin(tin: str | None) -> str:
	return "".join(c for c in (tin or "") if c.isdigit())


# The youngest a person may be to hold a GDB account.
MIN_AGE = 18


def _birth_date(value) -> "datetime.date":
	from frappe.utils import add_years, getdate, today

	if not value:
		frappe.throw(_("Enter your date of birth."))
	try:
		born = getdate(value)
	except Exception:
		frappe.throw(_("Enter your date of birth."))
	if born > getdate(add_years(today(), -MIN_AGE)):
		frappe.throw(_("You must be at least {0} to open an account.").format(MIN_AGE))
	if born < getdate(add_years(today(), -110)):
		frappe.throw(_("Check your date of birth."))
	return born


def _registry_phone(tin, use_registry_phone) -> str | None:
	"""The phone on the KYC register for this TIN, when the person has said it
	is theirs; None when they typed their own. The form never sees it whole."""
	if not frappe.utils.cint(use_registry_phone):
		return None
	person = kyc_registry.lookup(_normalize_tin(tin))
	if not person or not person["phone"]:
		frappe.throw(_("There is no phone on record for this TIN. Enter your phone number."))
	return person["phone"]


def _validated(first_name, last_name, email, phone, tin, password, confirm_password, document_kind, date_of_birth=None, use_registry_phone=None) -> dict:
	"""Every sign-up rule except the attachment, in the order the form asks."""
	phone = _registry_phone(tin, use_registry_phone) or phone
	first = (first_name or "").strip()
	last = (last_name or "").strip()
	if not first:
		frappe.throw(_("Enter your first name."))
	if not last:
		frappe.throw(_("Enter your last name."))
	if len(first) > NAME_MAX or len(last) > NAME_MAX:
		frappe.throw(_("Names can be at most {0} characters.").format(NAME_MAX))
	born = _birth_date(date_of_birth)

	email = (email or "").strip().lower()
	if email:
		frappe.utils.validate_email_address(email, throw=True)
		if email.endswith("@" + PLACEHOLDER_DOMAIN) or frappe.db.exists("User", email):
			frappe.throw(_("An account already uses this email. Sign in instead, or leave email blank."))

	normalised_phone = _normalised_phone(phone)
	if not normalised_phone:
		frappe.throw(_("Enter a valid phone number, e.g. +592 600 1234."))

	tin = _normalize_tin(tin)
	if not TIN_SHAPE.match(tin):
		frappe.throw(_("Enter your TIN — the 9-digit number from the GRA."))
	if frappe.db.exists("User", {TIN_FIELD: tin}) or _tin_held_by_keycloak(tin):
		frappe.throw(_("This TIN already has an account. Sign in instead."))

	password = password or ""
	if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
		frappe.throw(_("Choose a password of {0} to {1} characters.").format(PASSWORD_MIN, PASSWORD_MAX))
	if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
		frappe.throw(_("Use at least one letter and one number in your password."))
	if tin in password:
		frappe.throw(_("Your password cannot contain your TIN."))
	if password != (confirm_password or ""):
		frappe.throw(_("The two passwords do not match."))

	if document_kind not in DOCUMENT_KINDS:
		frappe.throw(_("Choose the identity document you are attaching."))

	return {
		"first": first,
		"last": last,
		"email": email,
		"phone": normalised_phone,
		"tin": tin,
		"password": password,
		"document_kind": document_kind,
		"date_of_birth": born,
	}


def _tin_held_by_keycloak(tin: str) -> bool:
	try:
		return keycloak_admin.citizen_username_taken(tin)
	except keycloak_admin.KeycloakAdminError as exc:
		frappe.throw(str(exc))


def _attachment(document_name: str | None, document_data: str | None) -> tuple[str, bytes]:
	"""The identity document, decoded and checked — before any code is spent."""
	name = os.path.basename((document_name or "").strip())
	if not name or not document_data:
		frappe.throw(_("Attach your identity document."))
	raw = document_data.split(",", 1)[1] if document_data.startswith("data:") else document_data
	try:
		content = base64.b64decode(raw, validate=True)
	except (ValueError, TypeError):
		frappe.throw(_("The document could not be read. Attach it again."))
	extension = os.path.splitext(name)[-1].lower()
	if extension not in ALLOWED_EXTENSIONS:
		frappe.throw(_("{0}: attach a PDF.").format(name))
	if len(content) > MAX_FILE_BYTES:
		frappe.throw(_("{0} is larger than {1} MB.").format(name, MAX_FILE_BYTES // 1024 // 1024))
	if not is_what_it_claims(extension, content):
		frappe.throw(_("{0} is not a real {1} file.").format(name, extension.lstrip(".").upper()))
	return name, content


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=12, seconds=60)
def lookup_tin(tin: str) -> dict:
	"""What the KYC register holds for this TIN, to fill the sign-up form: names,
	date of birth, where they live, and the phone on record — its last four
	digits only. {"found": False} when it holds nothing, or the TIN has an account.

	Rate-limited per caller, because it answers anyone who can type a number."""
	_require_door()
	tin = _normalize_tin(tin)
	if not TIN_SHAPE.match(tin):
		return {"found": False}
	if frappe.db.exists("User", {TIN_FIELD: tin}):
		return {"found": False, "has_account": True}
	person = kyc_registry.lookup(tin)
	if not person:
		return {"found": False}
	_logger().info(f"tin signup: register lookup matched {tin}")
	return kyc_registry.public(person)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="tin", limit=8, seconds=60)
def request_signup_otp(
	first_name: str,
	last_name: str,
	phone: str,
	tin: str,
	password: str,
	confirm_password: str,
	document_kind: str,
	email: str | None = None,
	date_of_birth: str | None = None,
	use_registry_phone=None,
) -> dict:
	"""Check the sign-up form and open a code challenge for its TIN and phone.
	Writes nothing else."""
	_require_door()
	form = _validated(
		first_name, last_name, email, phone, tin, password, confirm_password, document_kind, date_of_birth, use_registry_phone
	)
	_logger().info(f"tin signup: code issued for {form['tin']}")
	return _issue(SIGNUP, tin=form["tin"], phone=form["phone"])


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="tin", limit=8, seconds=60)
def complete_signup(
	challenge: str,
	otp: str,
	first_name: str,
	last_name: str,
	phone: str,
	tin: str,
	password: str,
	confirm_password: str,
	document_kind: str,
	document_name: str,
	document_data: str,
	email: str | None = None,
	date_of_birth: str | None = None,
	use_registry_phone=None,
) -> dict:
	"""The code, then everything: the Keycloak account (TIN as username), the
	Frappe citizen, their identity document, and a signed-in session."""
	_require_door()
	form = _validated(
		first_name, last_name, email, phone, tin, password, confirm_password, document_kind, date_of_birth, use_registry_phone
	)
	file_name, content = _attachment(document_name, document_data)
	held = _redeem(challenge, otp, SIGNUP)
	if held.get("tin") != form["tin"] or held.get("phone") != form["phone"]:
		frappe.throw(_("Your TIN or phone changed after the code was sent. Request a new code."))

	login_email = form["email"] or f"{form['tin']}@{PLACEHOLDER_DOMAIN}"
	try:
		kc_id = keycloak_admin.create_citizen_account(
			form["tin"], login_email, form["first"], form["last"], form["password"]
		)
	except keycloak_admin.PasswordRejected as exc:
		frappe.throw(str(exc))
	except keycloak_admin.KeycloakAdminError as exc:
		frappe.throw(str(exc))

	try:
		user = _create_citizen(form, login_email)
		_file_identity(user, form["document_kind"], file_name, content)
		_save_profile(user, form["phone"], form["date_of_birth"], kyc_registry.lookup(form["tin"]))
		frappe.db.commit()
	except Exception as exc:
		# The Keycloak half must not outlive a portal account that was never made.
		frappe.db.rollback()
		try:
			keycloak_admin.delete_citizen_account(kc_id)
		except keycloak_admin.KeycloakAdminError:
			_logger().error(f"tin signup: Keycloak account {kc_id} left behind for {form['tin']}")
		if isinstance(exc, frappe.ValidationError):
			raise
		# Frappe parses a PDF on the way in; a damaged one fails there with the
		# parser's own exception, which says nothing a person can act on.
		_logger().error(f"tin signup failed for {form['tin']}: {type(exc).__name__}: {exc}")
		frappe.throw(_("The document could not be read as a PDF. Attach another copy and try again."))

	_logger().info(f"tin signup: {form['tin']} -> {user}")
	return _sign_in(user, provisioned=True)


def _create_citizen(form: dict, login_email: str) -> str:
	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": login_email,
			"first_name": form["first"],
			"last_name": form["last"],
			"mobile_no": form["phone"],
			"user_type": "Website User",
			"send_welcome_email": 0,
			"enabled": 1,
			TIN_FIELD: form["tin"],
		}
	).insert(ignore_permissions=True)
	# Citizen and only Citizen — as the e-ID door provisions.
	user.add_roles("Citizen")
	return user.name


def _file_identity(user: str, kind: str, file_name: str, content: bytes) -> None:
	"""The attached document, as the person's own Identity document. The File
	goes through documents.validate_attachment like every other upload."""
	from gdb_bank.documents import DOCTYPE, RECEIVED

	row = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"applicant": user,
			"applicant_name": frappe.utils.get_fullname(user),
			"document_type": "Identity",
			"status": RECEIVED,
			"uploaded_by": user,
		}
	).insert(ignore_permissions=True)
	stored = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{kind} - {file_name}",
			"attached_to_doctype": DOCTYPE,
			"attached_to_name": row.name,
			"is_private": 1,
			"content": content,
		}
	).insert(ignore_permissions=True)
	row.db_set(
		{
			"file_url": stored.file_url,
			"file_name": stored.file_name,
			"file_size": len(content),
			"uploaded_on": frappe.utils.now_datetime(),
		}
	)


def _save_profile(user: str, phone: str, born, person: dict | None = None) -> None:
	"""Phone and date of birth, on their profile — where every form reads them —
	and, when the KYC register knows the TIN, where they live."""
	from gdb_bank import profiles

	doc = frappe.get_doc(profiles.DOCTYPE, profiles._ensure(user))
	doc.phone = phone
	doc.date_of_birth = born
	if person:
		doc.region = person["region"] or doc.region
		doc.village_or_town = person["village"] or doc.village_or_town
		doc.address = person["address"] or doc.address
	doc.save(ignore_permissions=True)


# --------------------------------------------------------------------------
# sign-in
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="tin", limit=8, seconds=60)
def tin_login(tin: str, password: str) -> dict:
	"""TIN and password against the citizen realm. Right ones open a code
	challenge; no session exists until verify_login_otp."""
	_require_door()
	tin = _normalize_tin(tin)
	if not TIN_SHAPE.match(tin):
		frappe.throw(_("Enter your TIN — the 9-digit number from the GRA."))
	if not password:
		frappe.throw(_("Password is required."))

	citizen = identity.keycloak_settings(identity.CITIZEN)
	try:
		token = identity._request_token(citizen, tin, password)
	except identity._Unreachable:
		frappe.throw(_("Could not reach the sign-in service. Please try again."))
	if not token:
		frappe.throw(_("Incorrect TIN or password."), frappe.AuthenticationError)

	info = identity._userinfo(citizen, token)
	if (info.get("preferred_username") or "") != tin:
		_logger().error(f"tin login: typed {tin}, keycloak vouched for {info.get('preferred_username')}")
		frappe.throw(_("Incorrect TIN or password."), frappe.AuthenticationError)
	user = frappe.db.get_value("User", {TIN_FIELD: tin}, "name")
	if not user:
		frappe.throw(_("Your TIN is recognised, but it has no GDB account. Please contact GDB."), frappe.AuthenticationError)
	_check_may_enter(user)
	return {"otp_required": True, **_issue(LOGIN, user=user, phone=frappe.db.get_value("User", user, "mobile_no") or "")}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="challenge", limit=10, seconds=60)
def verify_login_otp(challenge: str, otp: str) -> dict:
	"""The code from tin_login, then a signed-in session."""
	held = _redeem(challenge, otp, LOGIN)
	return _sign_in(held["user"], provisioned=False)


def _check_may_enter(user: str) -> None:
	identity._check_enabled(user)
	refusal = sign_in_policy.refusal(user, sign_in_policy.TIN)
	if refusal:
		frappe.throw(refusal, frappe.AuthenticationError)


def _sign_in(user: str, *, provisioned: bool) -> dict:
	_check_may_enter(user)
	sign_in_policy.mark(sign_in_policy.TIN)
	frappe.local.login_manager.login_as(user)
	frappe.db.commit()
	_logger().info(f"tin login: {user}")
	realm = identity.keycloak_settings(identity.CITIZEN)["realm"]
	return identity._session_summary(user, realm=realm, provisioned=provisioned)


def _require_door() -> None:
	if not identity.keycloak_settings(identity.CITIZEN):
		frappe.throw(_("TIN sign-in is not configured on this site."))
