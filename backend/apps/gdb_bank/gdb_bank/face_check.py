"""Sign-up's face check: the person on camera, alive, and the person on record.

National ID / TIN -> GDB KYC Record -> its profile_id -> <profile_id>.jpg, the
register's enrolment photo, held by the face service (face/app.py) and never
shown to anyone signing up. The browser only ever sends camera frames and gets
back a pass, or a reason it can act on.

  start(tin)               a check for this TIN: "center", then three of the four
                           challenges — turn left, turn right, look up, blink —
                           picked and ordered at random; or {required: False}
  submit(check, frames)    the frames, judged by the face service; a pass mints a
                           one-time token bound to the TIN
  require_passed(tin, t)   sign-up's code is sent, and the account made, only
                           with that token (tin_auth)

POLICY — GDB's decisions are still open, so each is a setting:

  on/off        on when FACE_SERVICE_TOKEN is set (env or site_config
                `gdb_face_service_token`); off, sign-up is exactly as before
  who           anyone whose TIN has a KYC record with a usable photo must pass;
                a TIN ON the register with NO usable photo cannot sign up online
                at all (GDB, 2026-10-03) — they finish at a branch or with a
                field officer; a TIN not on the register is not asked
  attempts      FACE_MAX_ATTEMPTS per TIN per hour (default 3)
  borderline    a "review" score is a fail for now (no review queue yet)

NOTHING OF THE FACE IS KEPT. Frames go to the face service and are dropped
there; this side logs only the decision and the scores.
"""

import os
import random
import secrets

import frappe
from frappe import _

from gdb_bank.integrations import kyc_registry
from gdb_bank.utils.session import _logger

CHALLENGES = ["left", "right", "up", "blink"]
# The blink is a short burst of frames, so a check carries up to this many.
MAX_FRAMES = 20
CHECK_TTL = 300
PASS_TTL = 900
ATTEMPT_WINDOW = 3600
MAX_FRAME_BYTES = 2 * 1024 * 1024

FRIENDLY = {
	"head_turn_not_seen": "We couldn't see you turn your head. Follow each prompt as it appears.",
	"look_up_not_seen": "We couldn't see you look up. Tilt your head up when asked.",
	"blink_not_seen": "We couldn't see you blink. Blink slowly when asked.",
	"different_people_in_frames": "Only you should be in front of the camera.",
	"does_not_match_record": "Your face doesn't match the photo GDB has on record for this ID.",
	"borderline_match": "We couldn't confirm your face against the photo on record.",
	"no_reference_photo": "There is no photo on record to compare with.",
	"no_face_in_reference": "The photo on record can't be used for a face check.",
}
UNCLEAR = "We couldn't see your face clearly. Face the camera in good light, and fill the oval."
NO_PHOTO = (
	"We don't have a photo on record for this ID, so we can't verify you online. "
	"Visit a GDB branch, or request a field officer, to open your account."
)
GIVE_UP = (
	"We couldn't verify your face. Visit a GDB branch, or request a field officer, "
	"to finish opening your account."
)


def _setting(key: str, env: str, default: str = "") -> str:
	return str(frappe.conf.get(key) or os.environ.get(env) or default).strip()


def _url() -> str:
	return _setting("gdb_face_service_url", "FACE_SERVICE_URL", "http://face:8000").rstrip("/")


def _token() -> str:
	return _setting("gdb_face_service_token", "FACE_SERVICE_TOKEN")


def enabled() -> bool:
	# PAUSED (2026-10-04): the sign-up face check is switched off for now — no
	# ID needs a face, and an ID with no photo on file can sign up online.
	# To turn it back on, restore the line below (and FACE_CHECK_ON in
	# frontend/src/pages/Signup.tsx), with FACE_SERVICE_TOKEN set.
	# return bool(_token())
	return False


def _max_attempts() -> int:
	return int(_setting("gdb_face_max_attempts", "FACE_MAX_ATTEMPTS", "3") or 3)


def _call(path: str, payload: dict, timeout: int = 45) -> dict:
	import requests

	try:
		r = requests.post(f"{_url()}{path}", json=payload, headers={"X-Face-Token": _token()}, timeout=timeout)
	except requests.RequestException as exc:
		_logger().error(f"face check: service unreachable: {type(exc).__name__}")
		frappe.throw(_("The face check is unavailable right now. Try again in a few minutes."))
	if r.status_code != 200:
		_logger().error(f"face check: service answered {r.status_code} on {path}")
		frappe.throw(_("The face check is unavailable right now. Try again in a few minutes."))
	return r.json()


CHECK, BLOCKED, SKIP = "check", "blocked", "skip"


def policy(tin: str) -> tuple[str, str | None]:
	"""What sign-up does about this TIN's face:

	  ("check", profile_id)   on the register with a usable photo: must pass
	  ("blocked", None)       on the register, no usable photo: no online sign-up
	  ("skip", None)          face check off, or the TIN is not on the register
	"""
	if not enabled():
		return SKIP, None
	person = kyc_registry.lookup(tin)
	if not person or not person.get("profile_id"):
		return SKIP, None
	usable = _call("/reference", {"profile_id": person["profile_id"]}, timeout=20)
	return (CHECK, person["profile_id"]) if usable.get("usable") else (BLOCKED, None)


def required(tin: str) -> str | None:
	"""The profile_id to check this TIN against, or None when no check applies."""
	verdict, profile_id = policy(tin)
	return profile_id if verdict == CHECK else None


def _attempts_key(tin: str) -> str:
	return f"gdb:face:attempts:{tin}"


def start(tin: str) -> dict:
	verdict, profile_id = policy(tin)
	if verdict == BLOCKED:
		frappe.throw(_(NO_PHOTO))
	if verdict == SKIP:
		return {"required": False}
	used = int(frappe.cache.get_value(_attempts_key(tin)) or 0)
	if used >= _max_attempts():
		frappe.throw(_(GIVE_UP))
	# Three of four challenges, in a random order: what a recording or a mask
	# would have to perform cannot be known in advance.
	steps = ["center", *random.sample(CHALLENGES, 3)]
	check = secrets.token_urlsafe(24)
	frappe.cache.set_value(
		f"gdb:face:check:{check}", {"tin": tin, "profile_id": profile_id, "steps": steps}, expires_in_sec=CHECK_TTL
	)
	return {"required": True, "check": check, "steps": steps, "attempts_left": _max_attempts() - used}


def submit(check: str, frames) -> dict:
	held = frappe.cache.get_value(f"gdb:face:check:{(check or '').strip()}")
	if not held:
		frappe.throw(_("This face check has expired. Start it again."))
	frappe.cache.delete_value(f"gdb:face:check:{check}")  # one submission per check
	tin = held["tin"]

	if isinstance(frames, str):
		frames = frappe.parse_json(frames)
	if not isinstance(frames, list) or not (1 <= len(frames) <= MAX_FRAMES):
		frappe.throw(_("Send the camera frames for each prompt."))
	cleaned = []
	for f in frames:
		image = str((f or {}).get("image") or "")
		if not image or len(image) > MAX_FRAME_BYTES * 4 // 3 + 64:
			frappe.throw(_("A camera frame is missing or too large."))
		cleaned.append({"step": str(f.get("step") or ""), "image": image})

	used = int(frappe.cache.get_value(_attempts_key(tin)) or 0) + 1
	frappe.cache.set_value(_attempts_key(tin), used, expires_in_sec=ATTEMPT_WINDOW)
	left = max(_max_attempts() - used, 0)

	result = _call("/verify", {"profile_id": held["profile_id"], "expected": held["steps"], "frames": cleaned})
	_logger().info(
		f"face check: {tin} -> {result.get('decision')} match={result.get('match')} "
		f"same={result.get('same_person')} reasons={result.get('reasons')} attempt={used}"
	)
	if result.get("decision") == "pass":
		token = secrets.token_urlsafe(24)
		frappe.cache.set_value(f"gdb:face:passed:{token}", {"tin": tin}, expires_in_sec=PASS_TTL)
		return {"passed": True, "face_token": token}

	reasons = result.get("reasons") or []
	messages = []
	for reason in reasons:
		messages.append(UNCLEAR if reason.startswith("unusable_frames") else FRIENDLY.get(reason, UNCLEAR))
	return {
		"passed": False,
		"messages": list(dict.fromkeys(messages)) or [UNCLEAR],
		"attempts_left": left,
		"give_up": GIVE_UP if not left else None,
	}


def require_passed(tin: str, face_token: str | None, consume: bool = False) -> None:
	"""Refuse to go on without a passed face check — when one applies to this TIN —
	and refuse outright a TIN on the register with no photo to check against."""
	verdict, _profile = policy(tin)
	if verdict == BLOCKED:
		frappe.throw(_(NO_PHOTO))
	if verdict == SKIP:
		return
	key = f"gdb:face:passed:{(face_token or '').strip()}"
	held = frappe.cache.get_value(key) if face_token else None
	if not held or held.get("tin") != tin:
		frappe.throw(_("Complete the face check before we send your code."))
	if consume:
		frappe.cache.delete_value(key)
