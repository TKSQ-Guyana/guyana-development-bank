"""Registry invariants, checked without a Frappe site.

`rbac/personas.py`, `rbac/capabilities.py`, `rbac/separation.py`,
`rbac/scoping.py` and `domain/` deliberately import nothing from Frappe, so
these run as plain unittest anywhere:

    cd backend/apps/gdb_bank && python -m unittest discover -s gdb_bank/tests -v

They are the safety net for the thing this architecture is built around -
"adding a persona is a data change". If a future edit to the registry breaks
Phase 5's privacy guarantee or leaves a capability stranded, that is a failing
test rather than a production incident.
"""

from __future__ import annotations

import unittest

from gdb_bank.domain import statuses
from gdb_bank.rbac import capabilities as cap
from gdb_bank.rbac import personas as reg
from gdb_bank.rbac import scoping, separation
from gdb_bank.rbac.personas import RowScope


class TestCapabilityVocabulary(unittest.TestCase):
	def test_every_capability_is_granted_to_someone(self):
		"""A capability no persona holds is dead code guarding a dead endpoint."""
		orphans = [c for c, owners in reg.capability_catalogue().items() if not owners]
		self.assertEqual(
			orphans,
			[],
			f"capabilities granted to no persona: {sorted(orphans)}. "
			"Grant them or move them to personas.RETIRED_CAPABILITIES.",
		)

	def test_capability_names_are_well_formed(self):
		for capability in cap.ALL_CAPABILITIES:
			self.assertRegex(capability, r"^[a-z_]+\.[a-z_]+$", f"malformed: {capability}")

	def test_personas_only_declare_known_capabilities(self):
		# PersonaSpec.__post_init__ enforces this at import; assert it bites.
		with self.assertRaises(ValueError):
			reg.PersonaSpec(
				key="bogus",
				role="Bogus",
				title="Bogus",
				description="",
				capabilities=frozenset({"not.a.real.capability"}),
				row_scope=RowScope.NONE,
			)


class TestPersonaRegistry(unittest.TestCase):
	def test_keys_and_roles_are_unique(self):
		keys = [p.key for p in reg.PERSONAS]
		roles = [p.role for p in reg.PERSONAS]
		self.assertEqual(len(keys), len(set(keys)))
		self.assertEqual(len(roles), len(set(roles)))

	def test_legacy_roles_resolve_to_current_personas(self):
		for legacy, current in reg.LEGACY_ROLE_ALIASES.items():
			self.assertIn(current, reg.BY_ROLE, f"{legacy} aliases to unknown role {current}")

		# A user still carrying the old role gets the new persona's powers.
		self.assertEqual(
			reg.capabilities_for_roles({"Citizen"}),
			reg.capabilities_for_roles({"GDB Citizen"}),
		)

	def test_unknown_roles_grant_nothing(self):
		self.assertEqual(reg.capabilities_for_roles({"Some Other App Role"}), frozenset())
		self.assertIs(reg.widest_row_scope({"Some Other App Role"}), RowScope.NONE)

	def test_widest_scope_wins_for_multi_persona_users(self):
		both = {"GDB Citizen", "GDB Underwriter"}
		self.assertIs(reg.widest_row_scope(both), RowScope.ALL)
		# and they hold the union of both capability sets
		self.assertTrue(reg.capabilities_for_roles(both) >= reg.BY_KEY["citizen"].capabilities)

	def test_keycloak_map_covers_every_active_persona(self):
		mapped = set()
		for roles in reg.keycloak_role_map().values():
			mapped.update(roles)
		for persona in reg.ACTIVE_PERSONAS:
			self.assertIn(
				persona.role,
				mapped,
				f"{persona.key} has no keycloak_roles - nobody can ever be granted it by login",
			)


class TestPhase5PrivacyGuarantee(unittest.TestCase):
	"""The Board/CEO must not be able to reach an individual case.

	features.md: "Cannot: see any individual applicant, application, document
	or case. This is enforced, not just hidden."
	"""

	def test_none_scope_personas_hold_no_case_level_permissions(self):
		for persona in reg.ACTIVE_PERSONAS:
			if persona.row_scope is not RowScope.NONE:
				continue
			leaks = [
				p.doctype
				for p in persona.doctype_permissions
				if p.doctype in reg.CASE_LEVEL_DOCTYPES
			]
			self.assertEqual(leaks, [], f"{persona.key} can reach case data: {leaks}")

	def test_board_holds_no_case_level_capability(self):
		board = reg.BY_KEY["board"]
		forbidden = {
			cap.APPLICATION_VIEW_ANY,
			cap.APPLICATION_VIEW_OWN,
			cap.APPLICATION_VIEW_QUEUE,
			cap.DOCUMENT_VIEW_ANY,
			cap.FINANCE_PORTFOLIO_DETAIL,
			cap.VERIFICATION_VIEW_COMPARISON,
		}
		self.assertEqual(board.capabilities & forbidden, frozenset())

	def test_board_reports_are_aggregate_only(self):
		board = reg.BY_KEY["board"]
		self.assertIn(cap.REPORT_PORTFOLIO_AGGREGATE, board.capabilities)
		self.assertIs(board.row_scope, RowScope.NONE)

	def test_no_persona_may_share_or_export_case_data(self):
		"""A shared document bypasses permission_query_conditions entirely, and
		a desk export walks straight past the audited report endpoints."""
		for persona in reg.ACTIVE_PERSONAS:
			for perm in persona.doctype_permissions:
				if perm.doctype not in reg.CASE_LEVEL_DOCTYPES:
					continue
				self.assertFalse(perm.share, f"{persona.key} may share {perm.doctype}")
				self.assertFalse(perm.export, f"{persona.key} may export {perm.doctype}")


class TestSeparationOfDuties(unittest.TestCase):
	"""The three rules underneath everything (features.md)."""

	def test_approver_is_never_the_releaser(self):
		rule = self._rule("approver_ne_releaser")
		self.assertEqual(rule.blocked_capability, cap.DISBURSEMENT_RELEASE)
		self.assertIn("credit.approved", rule.conflicting_events)

	def test_approver_is_never_the_condition_checker(self):
		rule = self._rule("approver_ne_condition_checker")
		self.assertEqual(rule.blocked_capability, cap.CONDITION_VERIFY)
		self.assertIn("credit.approved", rule.conflicting_events)

	def test_proposer_is_never_the_rule_approver(self):
		rule = self._rule("proposer_ne_rule_approver")
		self.assertEqual(rule.blocked_capability, cap.RULE_APPROVE)
		self.assertIn("rule_change.proposed", rule.conflicting_events)

	def test_no_single_persona_holds_both_sides_of_a_rule(self):
		"""Structural check: a persona that could approve AND release would make
		the runtime rule the only defence. Hold them in separate personas."""
		for rule in separation.RULES:
			makers = {
				p.key
				for p in reg.ACTIVE_PERSONAS
				if rule.blocked_capability in p.capabilities
			}
			# The capability that produces the conflicting event, where we can
			# name it: approval.
			if "credit.approved" in rule.conflicting_events:
				approvers = {
					p.key for p in reg.ACTIVE_PERSONAS if cap.CREDIT_APPROVE in p.capabilities
				}
				overlap = makers & approvers
				self.assertEqual(
					overlap,
					set(),
					f"persona(s) {overlap} hold both sides of {rule.rule_id}",
				)

	def test_rules_reference_real_capabilities(self):
		for rule in separation.RULES:
			self.assertIn(rule.blocked_capability, cap.ALL_CAPABILITIES, rule.rule_id)

	def _rule(self, rule_id):
		match = [r for r in separation.RULES if r.rule_id == rule_id]
		self.assertTrue(match, f"missing separation rule {rule_id}")
		return match[0]


class TestScoping(unittest.TestCase):
	def test_every_case_level_doctype_is_scoped(self):
		"""A case-level DocType with no scope spec gets no row-level filtering,
		which would leave it readable by any persona holding the DocPerm."""
		unscoped = reg.CASE_LEVEL_DOCTYPES - set(scoping.SCOPED_DOCTYPES)
		self.assertEqual(unscoped, set(), f"case-level doctypes without a ScopeSpec: {unscoped}")

	def test_inherited_scopes_point_at_a_scoped_parent(self):
		for spec in scoping.SCOPES:
			if spec.parent_doctype:
				self.assertIsNotNone(
					scoping.spec_for(spec.parent_doctype),
					f"{spec.doctype} inherits from unscoped {spec.parent_doctype}",
				)


class TestLifecycle(unittest.TestCase):
	def test_transitions_reference_real_states_and_capabilities(self):
		for t in statuses.TRANSITIONS:
			self.assertIn(t.source, statuses.ALL_STATUSES, t)
			self.assertIn(t.target, statuses.ALL_STATUSES, t)
			self.assertIn(t.capability, cap.ALL_CAPABILITIES, t)

	def test_terminal_states_have_no_outgoing_transitions(self):
		for state in statuses.TERMINAL_STATUSES:
			self.assertEqual(
				statuses.allowed_targets(state), (), f"{state} should be terminal"
			)

	def test_every_non_terminal_state_is_reachable(self):
		reachable = {statuses.DRAFT} | {t.target for t in statuses.TRANSITIONS}
		unreachable = set(statuses.ALL_STATUSES) - reachable
		self.assertEqual(unreachable, set(), f"unreachable states: {unreachable}")

	def test_approval_and_release_need_different_capabilities(self):
		approve = statuses.transition_for(statuses.UNDER_REVIEW, statuses.APPROVED)
		release = statuses.transition_for(
			statuses.CLEARED_FOR_DISBURSEMENT, statuses.DISBURSED
		)
		self.assertIsNotNone(approve)
		self.assertIsNotNone(release)
		self.assertNotEqual(approve.capability, release.capability)


if __name__ == "__main__":
	unittest.main(verbosity=2)
