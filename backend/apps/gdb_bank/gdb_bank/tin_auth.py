"""Online sign-up and sign-in by National ID, each finished with a one-time code.

THE THIRD CITIZEN DOOR. Beside the e-ID door (identity.password_login), a
citizen may open an account with their NATIONAL ID NUMBER — the number the KYC
register knows them by — and a password of their own, and sign in with the
same two. Their GRA TIN is asked too, but is optional. The architecture does
not change: the password lives in KEYCLOAK — the citizen realm, with the
National ID (lowercased, as Keycloak keeps usernames) as the account's username
— and this module only ever mints the ordinary Frappe `sid` once Keycloak and
the one-time code have both said yes.

Accounts opened before 2026-10-03 were keyed by the same number under the name
"TIN"; patches/national_id_from_tin.py moved it across, and sign-in still finds
an account by either field. Which accounts
this door may open is security/sign_in_policy.py (citizens only, as the e-ID
door).

  request_signup_otp(...)     check the form, open a code challenge
  complete_signup(...)        the code, then: Keycloak account, Frappe user,
                              the identity document, and a signed-in session
  national_id_login(...)      Keycloak password grant, then a code challenge
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

from gdb_bank import face_check, identity
from gdb_bank.integrations import keycloak_admin, kyc_registry
from gdb_bank.security import sign_in_policy
from gdb_bank.services.evidence import (
	ID_DOCUMENT_KINDS,
	MAX_FILE_BYTES,
	accepted_extensions,
	clean_id_number,
	is_what_it_claims,
	require_national_id_match,
)
from gdb_bank.utils.formatters import _normalised_phone
from gdb_bank.utils.session import _logger

NID_FIELD = "gdb_national_id"
TIN_FIELD = "gdb_tin"
# A GRA Taxpayer Identification Number: nine digits.
TIN_SHAPE = re.compile(r"^\d{9}$")
# An ID number as the register holds it: national IDs are digits, passport-
# style IDs a letter or two then digits, e-IDs eleven digits.
NID_SHAPE = re.compile(r"^[A-Z0-9]{6,15}$")
NID_MESSAGE = "Enter your National ID number, as printed on your ID card."

# The identity documents a person may sign up with — one, attached. Filed as
# the person's own `Identity` document, which follows them across cases.
# Not a passport: sign-up takes the Guyanese ID documents only. A passport is
# still accepted later, as an Identity upload on an application.
DOCUMENT_KINDS = tuple(k for k in ID_DOCUMENT_KINDS if k != "Passport")

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


def _normalize_nid(value: str | None) -> str:
	return kyc_registry.normalize_id(value) or ""


def _required_nid(value: str | None) -> str:
	nid = _normalize_nid(value)
	if not NID_SHAPE.match(nid):
		frappe.throw(_(NID_MESSAGE))
	return nid


def _optional_tin(value: str | None) -> str | None:
	"""The TIN, when one was given — nine digits, and nobody else's."""
	tin = _normalize_tin(value)
	if not tin:
		return None
	if not TIN_SHAPE.match(tin):
		frappe.throw(_("A TIN is the 9-digit number from the GRA. Check it, or leave it blank."))
	if frappe.db.exists("User", {TIN_FIELD: tin}):
		frappe.throw(_("This TIN is already linked to another GDB account."))
	return tin


def _account_for(number: str) -> str | None:
	"""The citizen account opened with this National ID — or, for an account
	from before the National ID field, the same number held as its TIN."""
	return frappe.db.get_value("User", {NID_FIELD: number}, "name") or frappe.db.get_value(
		"User", {TIN_FIELD: number}, "name"
	)


def _username(nid: str) -> str:
	"""The Keycloak username for this National ID; Keycloak lowercases them."""
	return nid.lower()


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


PHONE_CHANGE_MESSAGE = (
	"Your sign-up code can only be sent to the phone number on record for this National ID. "
	"To change that number, visit a GDB Field Officer or any GDB branch with your ID."
)


def _registry_phone(nid, use_registry_phone) -> str | None:
	"""The phone the sign-up code goes to when the KYC register has one for
	this National ID — and then ONLY that phone. A different number cannot be
	typed online: changing the number on record is done in person, with a GDB
	Field Officer, so a stolen ID number cannot be paired with the thief's phone.

	None when the register has no phone for this ID; the person then types
	theirs. The form never sees the number on record whole."""
	person = kyc_registry.lookup(_normalize_nid(nid))
	on_record = person["phone"] if person else None
	if frappe.utils.cint(use_registry_phone):
		if not on_record:
			frappe.throw(_("There is no phone on record for this National ID. Enter your phone number."))
		return on_record
	if on_record:
		frappe.throw(_(PHONE_CHANGE_MESSAGE))
	return None


def _validated(first_name, last_name, email, phone, national_id, password, confirm_password, document_kind, date_of_birth=None, use_registry_phone=None, document_number=None, tin=None) -> dict:
	"""Every sign-up rule except the attachment, in the order the form asks."""
	nid = _required_nid(national_id)
	phone = _registry_phone(nid, use_registry_phone) or phone
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

	if _account_for(nid) or _held_by_keycloak(nid):
		frappe.throw(_("This National ID already has an account. Sign in instead."))
	tin = _optional_tin(tin)

	password = password or ""
	if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
		frappe.throw(_("Choose a password of {0} to {1} characters.").format(PASSWORD_MIN, PASSWORD_MAX))
	if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
		frappe.throw(_("Use at least one letter and one number in your password."))
	if nid.lower() in password.lower() or (tin and tin in password):
		frappe.throw(_("Your password cannot contain your ID number or TIN."))
	if password != (confirm_password or ""):
		frappe.throw(_("The two passwords do not match."))

	if document_kind not in DOCUMENT_KINDS:
		frappe.throw(_("Choose the identity document you are attaching."))
	document_kind, document_number = clean_id_number(document_kind, document_number)
	require_national_id_match(document_kind, document_number, nid)

	return {
		"first": first,
		"last": last,
		"email": email,
		"phone": normalised_phone,
		"national_id": nid,
		"tin": tin,
		"password": password,
		"document_kind": document_kind,
		"document_number": document_number,
		"date_of_birth": born,
	}


def _held_by_keycloak(nid: str) -> bool:
	try:
		return keycloak_admin.citizen_username_taken(_username(nid))
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
	accepted = accepted_extensions("Identity")
	if extension not in accepted:
		frappe.throw(
			_("{0}: attach a PDF or a photo ({1}).").format(
				name, ", ".join(e.lstrip(".").upper() for e in accepted if e != ".pdf")
			)
		)
	if len(content) > MAX_FILE_BYTES:
		frappe.throw(_("{0} is larger than {1} MB.").format(name, MAX_FILE_BYTES // 1024 // 1024))
	if not is_what_it_claims(extension, content):
		frappe.throw(_("{0} is not a real {1} file.").format(name, extension.lstrip(".").upper()))
	return name, content


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=12, seconds=60)
def lookup_national_id(national_id: str) -> dict:
	"""What the KYC register holds for this National ID, to fill the sign-up
	form: names, date of birth, where they live, and the phone on record — its
	last four digits only. {"found": False} when it holds nothing, or the ID
	already has an account.

	Rate-limited per caller, because it answers anyone who can type a number."""
	_require_door()
	nid = _normalize_nid(national_id)
	if not NID_SHAPE.match(nid):
		return {"found": False}
	if _account_for(nid):
		return {"found": False, "has_account": True}
	person = kyc_registry.lookup(nid)
	if not person:
		return {"found": False}
	_logger().info(f"signup: register lookup matched {nid}")
	found = kyc_registry.public(person)
	# Said now, not after the whole form: on the register but no photo to check
	# against means this person finishes at a branch (face_check.policy).
	if face_check.policy(nid)[0] == face_check.BLOCKED:
		found["online_signup"] = False
		found["message"] = face_check.NO_PHOTO
	return found


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=60)
def start_face_check(national_id: str) -> dict:
	"""Before the code: whether this National ID needs a face check, and if so
	its prompts. {"required": False} when no photo on record can be compared with."""
	_require_door()
	return face_check.start(_required_nid(national_id))


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=60)
def submit_face_check(check: str, frames) -> dict:
	"""The camera frames for each prompt; a pass answers the face_token that sign-up
	then needs."""
	_require_door()
	return face_check.submit(check, frames)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="national_id", limit=8, seconds=60)
def request_signup_otp(
	first_name: str,
	last_name: str,
	phone: str,
	national_id: str,
	password: str,
	confirm_password: str,
	document_kind: str,
	email: str | None = None,
	date_of_birth: str | None = None,
	use_registry_phone=None,
	face_token: str | None = None,
	document_number: str | None = None,
	tin: str | None = None,
) -> dict:
	"""Check the sign-up form and open a code challenge for its National ID and
	phone.
	Writes nothing else. Where a face check applies, only after it passed."""
	_require_door()
	form = _validated(
		first_name, last_name, email, phone, national_id, password, confirm_password, document_kind, date_of_birth,
		use_registry_phone, document_number=document_number, tin=tin,
	)
	face_check.require_passed(form["national_id"], face_token)
	_logger().info(f"signup: code issued for {form['national_id']}")
	return _issue(SIGNUP, national_id=form["national_id"], phone=form["phone"])


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="national_id", limit=8, seconds=60)
def complete_signup(
	challenge: str,
	otp: str,
	first_name: str,
	last_name: str,
	phone: str,
	national_id: str,
	password: str,
	confirm_password: str,
	document_kind: str,
	document_name: str,
	document_data: str,
	email: str | None = None,
	date_of_birth: str | None = None,
	use_registry_phone=None,
	face_token: str | None = None,
	document_number: str | None = None,
	tin: str | None = None,
) -> dict:
	"""The code, then everything: the Keycloak account (National ID as
	username), the Frappe citizen, their identity document, and a signed-in
	session."""
	_require_door()
	form = _validated(
		first_name, last_name, email, phone, national_id, password, confirm_password, document_kind, date_of_birth,
		use_registry_phone, document_number=document_number, tin=tin,
	)
	face_check.require_passed(form["national_id"], face_token, consume=True)
	file_name, content = _attachment(document_name, document_data)
	held = _redeem(challenge, otp, SIGNUP)
	if held.get("national_id") != form["national_id"] or held.get("phone") != form["phone"]:
		frappe.throw(_("Your National ID or phone changed after the code was sent. Request a new code."))

	nid = form["national_id"]
	login_email = form["email"] or f"{_username(nid)}@{PLACEHOLDER_DOMAIN}"
	try:
		kc_id = keycloak_admin.create_citizen_account(
			_username(nid), login_email, form["first"], form["last"], form["password"]
		)
	except keycloak_admin.PasswordRejected as exc:
		frappe.throw(str(exc))
	except keycloak_admin.KeycloakAdminError as exc:
		frappe.throw(str(exc))

	try:
		user = _create_citizen(form, login_email)
		_file_identity(user, form["document_kind"], file_name, content, form["document_number"])
		_save_profile(user, form["phone"], form["date_of_birth"], kyc_registry.lookup(nid), nid)
		frappe.db.commit()
	except Exception as exc:
		# The Keycloak half must not outlive a portal account that was never made.
		frappe.db.rollback()
		try:
			keycloak_admin.delete_citizen_account(kc_id)
		except keycloak_admin.KeycloakAdminError:
			_logger().error(f"signup: Keycloak account {kc_id} left behind for {nid}")
		if isinstance(exc, frappe.ValidationError):
			raise
		# Frappe parses a PDF on the way in; a damaged one fails there with the
		# parser's own exception, which says nothing a person can act on.
		_logger().error(f"signup failed for {nid}: {type(exc).__name__}: {exc}")
		frappe.throw(_("The document could not be read. Attach another copy and try again."))

	_logger().info(f"signup: {nid} -> {user}")
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
			NID_FIELD: form["national_id"],
			TIN_FIELD: form["tin"],
		}
	).insert(ignore_permissions=True)
	# Citizen and only Citizen — as the e-ID door provisions.
	user.add_roles("Citizen")
	return user.name


def _file_identity(user: str, kind: str, file_name: str, content: bytes, number: str | None = None) -> None:
	"""The attached document, as the person's own Identity document. The File
	goes through documents.validate_attachment like every other upload."""
	from gdb_bank.documents import DOCTYPE, RECEIVED

	row = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"applicant": user,
			"applicant_name": frappe.utils.get_fullname(user),
			"document_type": "Identity",
			"id_document_kind": kind,
			"id_document_number": number,
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


def _save_profile(user: str, phone: str, born, person: dict | None = None, nid: str | None = None) -> None:
	"""Phone, date of birth and National ID, on their profile — where every form
	reads them — and, when the KYC register knows them, where they live."""
	from gdb_bank import profiles

	doc = frappe.get_doc(profiles.DOCTYPE, profiles._ensure(user))
	doc.phone = phone
	doc.date_of_birth = born
	if nid and not doc.get("national_id"):
		doc.national_id = nid
	if person:
		doc.region = person["region"] or doc.region
		doc.village_or_town = person["village"] or doc.village_or_town
		doc.address = person["address"] or doc.address
	doc.save(ignore_permissions=True)


# --------------------------------------------------------------------------
# sign-in
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="national_id", limit=8, seconds=60)
def national_id_login(national_id: str, password: str) -> dict:
	"""National ID and password against the citizen realm. Right ones open a
	code challenge; no session exists until verify_login_otp."""
	_require_door()
	nid = _required_nid(national_id)
	if not password:
		frappe.throw(_("Password is required."))

	citizen = identity.keycloak_settings(identity.CITIZEN)
	try:
		token = identity._request_token(citizen, _username(nid), password)
	except identity._Unreachable:
		frappe.throw(_("Could not reach the sign-in service. Please try again."))
	if not token:
		frappe.throw(_("Incorrect National ID or password."), frappe.AuthenticationError)

	info = identity._userinfo(citizen, token)
	if (info.get("preferred_username") or "").lower() != _username(nid):
		_logger().error(f"login: typed {nid}, keycloak vouched for {info.get('preferred_username')}")
		frappe.throw(_("Incorrect National ID or password."), frappe.AuthenticationError)
	user = _account_for(nid)
	if not user:
		frappe.throw(
			_("Your National ID is recognised, but it has no GDB account. Please contact GDB."),
			frappe.AuthenticationError,
		)
	_check_may_enter(user)
	return {"otp_required": True, **_issue(LOGIN, user=user, phone=frappe.db.get_value("User", user, "mobile_no") or "")}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="challenge", limit=10, seconds=60)
def verify_login_otp(challenge: str, otp: str) -> dict:
	"""The code from national_id_login, then a signed-in session."""
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
		frappe.throw(_("Online sign-in is not configured on this site."))
