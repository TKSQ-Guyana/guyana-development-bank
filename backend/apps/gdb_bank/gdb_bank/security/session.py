"""The authenticated actor, resolved once per request.

Everything downstream - guards, repositories, audit rows - takes an `Actor`
rather than reaching for `frappe.session.user`. That keeps row scoping honest
(the scope travels with the actor) and makes the services testable without a
live session.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import frappe

from gdb_bank.rbac import personas as reg
from gdb_bank.rbac.personas import PersonaSpec, RowScope
from gdb_bank.security import eid as eid_mod
from gdb_bank.security import errors


@dataclass(frozen=True)
class Actor:
	user: str
	eid: str | None
	roles: frozenset[str]
	personas: tuple[PersonaSpec, ...]
	capabilities: frozenset[str]
	row_scope: RowScope
	full_name: str = ""

	@property
	def is_system_manager(self) -> bool:
		return "System Manager" in self.roles

	@property
	def persona_keys(self) -> tuple[str, ...]:
		return tuple(p.key for p in self.personas)

	def can(self, capability: str) -> bool:
		return capability in self.capabilities

	def portal_home(self) -> str:
		"""Where the SPA lands this actor. Highest row scope wins, so a user who
		is both citizen and facilitator lands on the facilitator dashboard."""
		if not self.personas:
			return "/"
		return max(self.personas, key=lambda p: len(p.capabilities)).portal_home


def current_actor() -> Actor:
	"""Build the Actor for this request. Raises 401 for Guest."""
	user = frappe.session.user
	if not user or user == "Guest":
		errors.throw(errors.AuthenticationRequired, "Please sign in to continue.")

	roles = frozenset(frappe.get_roles(user))
	personas = reg.personas_for_roles(roles)
	capabilities = reg.capabilities_for_roles(roles)
	scope = reg.widest_row_scope(roles)

	# System Manager keeps desk superpowers, but it is not a GDB persona: it
	# grants no GDB capability on its own. Credit and money still require a
	# persona that declares them. (features.md notes the admin gap; this is the
	# part of it we do close.)
	return Actor(
		user=user,
		eid=eid_mod.for_user(user),
		roles=roles,
		personas=personas,
		capabilities=capabilities,
		row_scope=scope,
		full_name=frappe.utils.get_fullname(user) or user,
	)


def actor_for(user: str) -> Actor:
	"""An Actor for a user other than the session one - used by admin screens
	to preview what a grant would buy. Never used to authorize."""
	roles = frozenset(frappe.get_roles(user))
	return Actor(
		user=user,
		eid=eid_mod.for_user(user),
		roles=roles,
		personas=reg.personas_for_roles(roles),
		capabilities=reg.capabilities_for_roles(roles),
		row_scope=reg.widest_row_scope(roles),
		full_name=frappe.utils.get_fullname(user) or user,
	)
