"""The e-ID's shape, and the demo identities that have to fit it.

WHY THIS IS WORTH A TEST FILE
    An e-ID that the sign-in form cannot express fails at Keycloak's token
    endpoint as `invalid_grant` - the same answer it gives for a wrong
    password. So a demo account seeded in the wrong shape does not look like a
    seeding bug. It looks like the developer typed their password wrong, and it
    stays looking like that for as long as they are willing to retype it.

    That is exactly what was on disk before: `999-1001-001` is 3-4-3, while the
    card, the screenshots and the three-box control are all 3-4-4.

No frappe, no site, no database - which is the reason `domain/eid_format.py`
and `rbac/demo.py` are kept free of frappe imports.
"""

from __future__ import annotations

import unittest

from gdb_bank.domain import eid_format
from gdb_bank.rbac import demo


class ShapeTest(unittest.TestCase):
	def test_accepts_the_canonical_spelling(self):
		self.assertTrue(eid_format.is_valid("592-1111-0001"))

	def test_rejects_the_old_three_four_three_shape(self):
		# The shape every demo account carried before this change.
		self.assertFalse(eid_format.is_valid("999-1001-001"))

	def test_rejects_letters(self):
		# The previous validator accepted this: [A-Z0-9]{2,6} three times over.
		# It would then have become a row-scoping filter.
		self.assertFalse(eid_format.is_valid("AB-CD-EF"))
		self.assertFalse(eid_format.is_valid("ABC-DEFG-HIJK"))

	def test_rejects_the_wrong_number_of_digits(self):
		self.assertFalse(eid_format.is_valid("592-1111"))
		self.assertFalse(eid_format.is_valid("592-1111-00012"))

	def test_accepts_eleven_digits_grouped_any_way(self):
		"""`is_valid` normalizes first, deliberately. The grouping a citizen
		typed is not the thing being validated - the eleven digits are - so a
		mis-grouped paste is corrected rather than refused."""
		self.assertTrue(eid_format.is_valid("59211110001"))
		self.assertTrue(eid_format.is_valid("592-11-11-0001"))


class NormalizeTest(unittest.TestCase):
	"""Lenient about what a human pastes, strict about what it answers."""

	def test_accepts_eleven_bare_digits(self):
		self.assertEqual(eid_format.normalize("59211110001"), "592-1111-0001")

	def test_accepts_spaces(self):
		self.assertEqual(eid_format.normalize(" 592 1111 0001 "), "592-1111-0001")

	def test_accepts_an_en_dash(self):
		# What a word processor turns a hyphen into. A citizen copying their
		# e-ID out of a letter should not be told their own number is wrong.
		self.assertEqual(eid_format.normalize("592–1111–0001"), "592-1111-0001")

	def test_leaves_a_non_eid_alone_rather_than_guessing(self):
		# Not eleven digits, so there is no grouping to infer. Handing back a
		# half-guess would mean storing something nobody typed.
		self.assertEqual(eid_format.normalize("hello"), "hello")

	def test_empty_is_empty(self):
		self.assertEqual(eid_format.normalize(None), "")
		self.assertEqual(eid_format.normalize(""), "")

	def test_split_refuses_a_partial_eid(self):
		self.assertEqual(eid_format.split("59211110001"), ("592", "1111", "0001"))
		with self.assertRaises(ValueError):
			eid_format.split("592-1111")


class DemoIdentityTest(unittest.TestCase):
	def test_every_demo_eid_is_one_the_sign_in_form_can_express(self):
		demo.assert_well_formed()

	def test_one_identity_per_active_persona(self):
		from gdb_bank.rbac import personas as reg

		self.assertEqual(
			[identity.persona for identity in demo.identities()],
			[persona.key for persona in reg.ACTIVE_PERSONAS],
		)

	def test_username_is_the_eid_not_the_email(self):
		"""Under PKCE the citizen types this into Keycloak's own page. An email
		username means there is no e-ID sign-in, however well the rest of the
		stack handles one."""
		for identity in demo.identities():
			self.assertEqual(identity.username, identity.eid)
			self.assertNotIn("@", identity.username)

	def test_demo_eids_are_reserved(self):
		for identity in demo.identities():
			self.assertTrue(identity.eid.startswith(demo.EID_PREFIX + "-"))


if __name__ == "__main__":
	unittest.main()
