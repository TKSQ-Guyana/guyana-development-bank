"""The face service: is the person on camera alive, and the person on record?

Called only by the backend (gdb_bank.face_check), never by a browser: compose
publishes no port, and every call must carry the shared FACE_SERVICE_TOKEN.

  POST /verify   {profile_id, expected: ["center","left","right"], frames: [{step, image}]}
  GET  /health

`profile_id` names the reference photo — <PHOTO_DIR>/<profile_id>.jpg (or .jpeg,
.png), the KYC
register's own enrolment picture. It is read here, on the server, and never
returned: the answer is scores and reasons, not images.

WHAT IS CHECKED

  quality    each frame holds exactly one face, large and sharp enough
  liveness   each cue happened, in the random order asked: "left"/"right" turned
             (yaw moved TURN_DEG from the "center" frame, opposite ways when both
             are asked), "up" tilted (pitch moved PITCH_DEG), and "blink" — a
             burst of frames in which the eyes go from open to clearly closed
             (eye aspect ratio) — none of which a printed photo or a still on a
             screen can do on cue
  sameness   every frame is the same person (no swapping faces mid-check)
  match      the frontal frame against the reference photo, cosine similarity
             of ArcFace embeddings: PASS_AT and over passes, REVIEW_AT and over
             is borderline, under it fails

A dedicated passive anti-spoofing model (screens, masks, replays) is not in yet:
`passive` reports "not_configured" until one is added at PASSIVE_MODEL.

Thresholds are the trial's defaults, to be set from GDB's own photos.
"""

import base64
import hmac
import os
import re
from functools import lru_cache

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from insightface.app import FaceAnalysis
from pydantic import BaseModel

PHOTO_DIR = os.environ.get("PHOTO_DIR", "/photos")
TOKEN = os.environ.get("FACE_SERVICE_TOKEN", "")
PASS_AT = float(os.environ.get("FACE_PASS_AT", "0.40"))
REVIEW_AT = float(os.environ.get("FACE_REVIEW_AT", "0.30"))
TURN_DEG = float(os.environ.get("FACE_TURN_DEG", "15"))
CENTER_DEG = float(os.environ.get("FACE_CENTER_DEG", "12"))
SAME_PERSON_AT = float(os.environ.get("FACE_SAME_PERSON_AT", "0.45"))
PITCH_DEG = float(os.environ.get("FACE_PITCH_DEG", "10"))
# A blink: in a burst of frames the eyes go from open to clearly less open. Eye
# openness is the eye aspect ratio (EAR) from the 68-point landmarks.
EAR_OPEN_MIN = float(os.environ.get("FACE_EAR_OPEN_MIN", "0.15"))
BLINK_RATIO = float(os.environ.get("FACE_BLINK_RATIO", "0.70"))
MAX_FRAMES = 20
MIN_FACE_PX = int(os.environ.get("FACE_MIN_PX", "80"))
MIN_SHARPNESS = float(os.environ.get("FACE_MIN_SHARPNESS", "25"))
MAX_FRAME_BYTES = 2 * 1024 * 1024
PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,63}$")
# The reference photo is <profile_id> with the first of these that exists.
PHOTO_EXTENSIONS = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")

engine = FaceAnalysis(
	name=os.environ.get("FACE_MODEL", "buffalo_l"),
	root=os.environ.get("MODEL_ROOT", "/models"),
	providers=["CPUExecutionProvider"],
	allowed_modules=["detection", "recognition", "landmark_3d_68"],
)
engine.prepare(ctx_id=-1, det_size=(640, 640))

app = FastAPI(title="GDB face service", docs_url=None, redoc_url=None, openapi_url=None)


class Frame(BaseModel):
	step: str
	image: str  # base64 JPEG, data: URL allowed


class Verify(BaseModel):
	profile_id: str
	expected: list[str]
	frames: list[Frame]


def _authorised(token: str | None) -> None:
	if not TOKEN or not hmac.compare_digest(token or "", TOKEN):
		raise HTTPException(status_code=401, detail="unauthorised")


def _decode(data: str) -> np.ndarray | None:
	raw = data.split(",", 1)[1] if data.startswith("data:") else data
	try:
		blob = base64.b64decode(raw, validate=True)
	except Exception:
		return None
	if not blob or len(blob) > MAX_FRAME_BYTES:
		return None
	return cv2.imdecode(np.frombuffer(blob, np.uint8), cv2.IMREAD_COLOR)


def _largest(faces):
	return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])) if faces else None


def _sharpness(img: np.ndarray, face) -> float:
	x1, y1, x2, y2 = (int(v) for v in face.bbox)
	crop = img[max(y1, 0) : max(y2, 0), max(x1, 0) : max(x2, 0)]
	if crop.size == 0:
		return 0.0
	return float(cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())


def _ear(face) -> float | None:
	"""Eye aspect ratio, averaged over both eyes, from the 68-point landmarks:
	(two eyelid gaps) / (2 x eye width). Open eyes ~0.2-0.35, closed well under."""
	marks = getattr(face, "landmark_3d_68", None)
	if marks is None:
		return None
	pts = np.asarray(marks)[:, :2]

	def one(i: int) -> float:
		e = pts[i : i + 6]
		width = np.linalg.norm(e[0] - e[3])
		return float((np.linalg.norm(e[1] - e[5]) + np.linalg.norm(e[2] - e[4])) / (2 * width)) if width else 0.0

	return (one(36) + one(42)) / 2


def _cos(a: np.ndarray, b: np.ndarray) -> float:
	return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def _reference(profile_id: str):
	"""(embedding or None, reason). A usable photo is remembered, since the same
	person may retry; a missing or unusable one is not, so a photo added later
	is found without a restart."""
	for ext in PHOTO_EXTENSIONS:
		path = os.path.join(PHOTO_DIR, f"{profile_id}{ext}")
		if os.path.isfile(path):
			return _embedding(path, os.path.getmtime(path))
	return None, "no_reference_photo"


@lru_cache(maxsize=256)
def _embedding(path: str, mtime: float):
	"""Keyed on the file's modified time too: a replaced photo is read afresh."""
	img = cv2.imread(path, cv2.IMREAD_COLOR)
	if img is None:
		return None, "reference_unreadable"
	faces = engine.get(img)
	if not faces:
		return None, "no_face_in_reference"
	return _largest(faces).normed_embedding, "ok"


@app.get("/health")
def health():
	return {"ok": True, "model": os.environ.get("FACE_MODEL", "buffalo_l"), "photo_dir": os.path.isdir(PHOTO_DIR)}


@app.post("/reference")
def reference(body: dict, x_face_token: str | None = Header(default=None)):
	"""Whether a usable reference photo exists for this profile — so sign-up can
	ask for the face check only of someone it can actually check."""
	_authorised(x_face_token)
	profile_id = str(body.get("profile_id") or "")
	if not PROFILE_ID.match(profile_id):
		return {"usable": False, "reason": "bad_profile_id"}
	embedding, reason = _reference(profile_id)
	return {"usable": embedding is not None, "reason": reason}


@app.post("/verify")
def verify(body: Verify, x_face_token: str | None = Header(default=None)):
	_authorised(x_face_token)
	if not PROFILE_ID.match(body.profile_id):
		raise HTTPException(status_code=400, detail="bad profile_id")
	reference, ref_reason = _reference(body.profile_id)
	result = {
		"decision": "fail",
		"reasons": [],
		"reference": ref_reason,
		"passive": "not_configured",
		"frames": [],
		"match": None,
	}
	if reference is None:
		result["reasons"].append(ref_reason)
		return result

	by_step = {}
	blinks = []  # (ear, face) for every usable frame of the blink burst
	for frame in body.frames[:MAX_FRAMES]:
		img = _decode(frame.image)
		info = {"step": frame.step, "faces": 0}
		if img is None:
			info["problem"] = "unreadable"
		else:
			faces = engine.get(img)
			info["faces"] = len(faces)
			if len(faces) != 1:
				info["problem"] = "no_face" if not faces else "several_faces"
			else:
				face = faces[0]
				width = float(face.bbox[2] - face.bbox[0])
				sharp = _sharpness(img, face)
				pitch, yaw, roll = (float(v) for v in face.pose)
				ear = _ear(face)
				info.update(
					width=round(width),
					sharpness=round(sharp, 1),
					yaw=round(yaw, 1),
					pitch=round(pitch, 1),
					ear=round(ear, 3) if ear is not None else None,
				)
				if width < MIN_FACE_PX:
					info["problem"] = "face_too_small"
				elif frame.step == "blink":
					# A blink frame is often soft — closed eyes, a moving face.
					if ear is not None:
						blinks.append((ear, face))
				elif sharp < MIN_SHARPNESS:
					info["problem"] = "blurry"
				else:
					by_step[frame.step] = (face, yaw, pitch)
		result["frames"].append(info)

	missing = [s for s in body.expected if s != "blink" and s not in by_step]
	if "blink" in body.expected and len(blinks) < 3:
		missing.append("blink")
	if missing:
		result["reasons"].append("unusable_frames:" + ",".join(missing))
		return result

	# Liveness: every cue that was asked for happened.
	center_yaw = by_step["center"][1] if "center" in by_step else 0.0
	center_pitch = by_step["center"][2] if "center" in by_step else 0.0
	turns = [by_step[s][1] for s in ("left", "right") if s in by_step]
	if turns:
		turned = abs(center_yaw) <= CENTER_DEG and all(abs(y - center_yaw) >= TURN_DEG for y in turns)
		if len(turns) == 2:
			turned = turned and (turns[0] - center_yaw) * (turns[1] - center_yaw) < 0
		if not turned:
			result["reasons"].append("head_turn_not_seen")
	if "up" in by_step and abs(by_step["up"][2] - center_pitch) < PITCH_DEG:
		result["reasons"].append("look_up_not_seen")
	if "blink" in body.expected:
		ears = [e for e, _f in blinks]
		result["blink"] = {"open": round(max(ears), 3), "closed": round(min(ears), 3), "frames": len(ears)}
		if not (max(ears) >= EAR_OPEN_MIN and min(ears) <= BLINK_RATIO * max(ears)):
			result["reasons"].append("blink_not_seen")

	# Sameness: one person throughout — every cued frame, and the blink burst's
	# most open frame.
	faces = [by_step[s][0] for s in body.expected if s in by_step]
	if blinks:
		faces.append(max(blinks, key=lambda b: b[0])[1])
	embeddings = [f.normed_embedding for f in faces]
	same = min((_cos(embeddings[0], e) for e in embeddings[1:]), default=1.0)
	result["same_person"] = round(same, 3)
	if same < SAME_PERSON_AT:
		result["reasons"].append("different_people_in_frames")

	# Match: the frontal frame against the photo on record.
	frontal = by_step.get("center", (faces[0],))[0]
	score = _cos(frontal.normed_embedding, reference)
	result["match"] = round(score, 3)
	if score < REVIEW_AT:
		result["reasons"].append("does_not_match_record")
	elif score < PASS_AT:
		result["reasons"].append("borderline_match")

	if not result["reasons"]:
		result["decision"] = "pass"
	elif result["reasons"] == ["borderline_match"]:
		result["decision"] = "review"
	return result
