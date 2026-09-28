"""The national e-ID: its shape, and the one canonical way to write it.

3 / 4 / 4 digits, DASHES INCLUDED — the SPA joins its three boxes with '-' and
submits that string as the Keycloak username, so it is the stored form too.
Mirrored in frontend/src/eid.ts; the two must agree.
"""

import re

EID_PART_LENGTHS = (3, 4, 4)
EID_SHAPE = re.compile(r"^\d{3}-\d{4}-\d{4}$")

# The custom field on User that carries the link (install.USER_CUSTOM_FIELDS).
EID_FIELD = "gdb_eid"


def normalize_eid(value: str | None) -> str:
	"""Accept what a human might paste — spaces, en/em dashes, bare digits —
	and answer the canonical `123-4567-8901`. Anything that is not eleven digits
	comes back unchanged so the caller's shape check can reject it."""
	raw = (value or "").strip()
	if not raw:
		return ""
	digits = re.sub(r"\D", "", raw)
	if len(digits) != sum(EID_PART_LENGTHS):
		return raw
	a, b, c = EID_PART_LENGTHS
	return f"{digits[:a]}-{digits[a : a + b]}-{digits[a + b : a + b + c]}"
