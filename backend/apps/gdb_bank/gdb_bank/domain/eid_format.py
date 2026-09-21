"""The shape of the national e-ID, and nothing else.

WHY THIS IS SEPARATE FROM `security/eid.py`. That module stores and looks up an
e-ID, so it imports frappe and needs a site to do anything. The *format* needs
neither, and three things have to agree about it:

    this module                      the canonical statement
    security/eid.py                  storage, lookup, User binding
    keycloak-local/themes/gdb/...    the three boxes a citizen types into
    rbac/demo.py                     every seeded demo identity

Keeping the shape here means the site-free test suite can assert that the
identities we seed are ones the sign-in form can actually accept - which is the
failure this file exists to prevent. A demo account whose e-ID the login page
cannot express is indistinguishable, from the outside, from a wrong password.

THE SHAPE IS 3-4-4. Eleven digits in three boxes, `592-1111-0001`, matching the
card. It was previously validated as `[A-Z0-9]{2,6}` three times over, which
accepted `AB-CD-EF` and let it through to become a row-scoping filter.

LENIENT IN, STRICT OUT. `normalize()` accepts what a human might paste - spaces,
en and em dashes, or eleven bare digits - and answers the one canonical
spelling. `is_valid()` accepts only that spelling. Anything `normalize()` cannot
make sense of comes back unchanged, so the caller's own check still rejects it
rather than a half-guess being stored.
"""

from __future__ import annotations

import re

PART_LENGTHS: tuple[int, int, int] = (3, 4, 4)
"""The e-ID's own grouping, and the width of each box on the sign-in form."""

TOTAL_DIGITS = sum(PART_LENGTHS)

SHAPE = re.compile(r"^\d{3}-\d{4}-\d{4}$")
"""Dashes included: the sign-in form joins its three boxes with '-' and submits
that combined string, so this is the stored form too."""

# Everything a human might type or paste between the groups. The en dash and em
# dash are here because they are what a word processor turns a hyphen into, and
# a citizen copying their e-ID out of a letter should not be told it is wrong.
_SEPARATORS = re.compile(r"[\s_‐-―−]+")


def normalize(raw: str | None) -> str:
	"""The one canonical spelling, or the input unchanged if it is not an e-ID.

	Returns `""` for nothing at all. Never raises - deciding whether the result
	is acceptable is `is_valid()`'s job, and separating the two means a caller
	can normalize a value it is about to reject and log it in the same shape it
	would have stored.
	"""
	if not raw:
		return ""

	value = _SEPARATORS.sub("-", str(raw)).strip()
	digits = re.sub(r"\D", "", value)
	if len(digits) != TOTAL_DIGITS:
		# Not an e-ID's worth of digits. Hand it back as-is rather than
		# inventing a grouping for it.
		return value

	a, b, c = PART_LENGTHS
	return f"{digits[:a]}-{digits[a : a + b]}-{digits[a + b : a + b + c]}"


def is_valid(raw: str | None) -> bool:
	return bool(SHAPE.match(normalize(raw)))


def split(value: str) -> tuple[str, str, str]:
	"""The three boxes of a valid e-ID. Raises on anything else - a partial
	e-ID has no meaningful box split, and guessing one is how half a citizen's
	number ends up rendered next to two empty boxes."""
	normalized = normalize(value)
	if not SHAPE.match(normalized):
		raise ValueError("not a valid e-ID")
	first, second, third = normalized.split("-")
	return first, second, third
