"""The demo identity for each persona - one formula, three consumers.

DEVELOPMENT ACCOUNTS ONLY. A real deployment provisions people from Keycloak
and never runs any of this. These exist so a developer can sign in as any
persona end to end on a cold `docker compose up`.

WHY IT IS ITS OWN MODULE. The same account has to exist on both sides of the
sign-in, spelled identically:

    install.make_demo_users()        the Frappe User, its roles, its e-ID
    keycloak-local/setup-gdb.mjs     the Keycloak account that authenticates it

Those were two hand-kept formulas in two languages. When they agreed, sign-in
worked; when they drifted by a single digit, Keycloak answered "invalid_grant"
for a username it had never heard of, and the portal reported it as a wrong
password - a precise answer to a question nobody asked. So the formula lives
here, `export_rbac.py` projects it into the generated Keycloak structure module,
and the seeder consumes that rather than recomputing it.

Imports no frappe, so the site-free tests can assert every e-ID below is one the
sign-in form can actually express.
"""

from __future__ import annotations

from dataclasses import dataclass

from gdb_bank.domain import eid_format
from gdb_bank.rbac import personas as reg

DOMAIN = "gdb.gov.gy"

EID_PREFIX = "999"
"""Reserved for demo identities. No real e-ID begins 999, so a development
account can never collide with a citizen's - and a 999 e-ID showing up in a
deployed environment's logs is a finding, not a coincidence."""


@dataclass(frozen=True)
class DemoIdentity:
	persona: str
	eid: str
	email: str
	full_name: str
	keycloak_roles: tuple[str, ...]

	@property
	def username(self) -> str:
		"""What the person types into Keycloak's sign-in form.

		THE E-ID, NOT THE EMAIL. Under Authorization Code + PKCE the credential
		page is Keycloak's, so the Keycloak `username` IS the thing a citizen is
		asked for. An account whose username is an email address cannot be
		signed into with an e-ID, however well the rest of the stack handles
		one.
		"""
		return self.eid


def _eid_for(index: int) -> str:
	"""`999-1001-0001`, `999-1002-0002`, ... - 3-4-4, like the card.

	These were 3-4-3 (`999-1001-001`), which no longer passes `eid_format`, and
	arguably never should have: a demo identity in a shape the sign-in form
	cannot express is not a demo of anything.
	"""
	return f"{EID_PREFIX}-{1000 + index:04d}-{index:04d}"


def identities() -> tuple[DemoIdentity, ...]:
	"""One identity per active persona, in registry order.

	Registry order is the contract between the two consumers: add a persona in
	the middle of `PERSONAS` and every later demo e-ID shifts. That is fine -
	both sides regenerate from here - but it does mean a developer's saved
	password manager entry will point at the wrong persona afterwards.
	"""
	return tuple(
		DemoIdentity(
			persona=persona.key,
			eid=_eid_for(index),
			email=f"{persona.key.replace('_', '.')}@{DOMAIN}",
			full_name=f"Demo {persona.title}",
			keycloak_roles=tuple(persona.keycloak_roles),
		)
		for index, persona in enumerate(reg.ACTIVE_PERSONAS, start=1)
	)


def assert_well_formed() -> None:
	"""Every demo e-ID is one the sign-in form can express, and they are unique.

	Called by the test suite and by `export_rbac.py` before it writes, so a
	registry edit that breaks the formula fails at generation time rather than
	on somebody's cold start three days later.
	"""
	seen: set[str] = set()
	for identity in identities():
		if not eid_format.is_valid(identity.eid):
			raise AssertionError(
				f"demo e-ID {identity.eid!r} for persona {identity.persona!r} "
				f"is not {'-'.join(str(n) for n in eid_format.PART_LENGTHS)} digits"
			)
		if identity.eid in seen:
			raise AssertionError(f"duplicate demo e-ID {identity.eid!r}")
		seen.add(identity.eid)
