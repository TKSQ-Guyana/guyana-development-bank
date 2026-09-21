"""Separation of duties, declared as data and enforced against the audit trail.

features.md states three rules underneath everything:

    * whoever approves a loan never releases it;
    * whoever approves a loan never checks its conditions;
    * whoever proposes a rule never approves it.

Plus the per-persona constraints: an underwriter never reviews their own
application, a disbursement officer never releases a loan they are party to.

All of them are the same shape - "you may not do X on a subject where you
previously did Y" - so they are one table and one engine. The engine reads the
`GDB Audit Event` trail rather than a status field, because the trail is the
record of who actually acted; a status can be reached by several routes.

ADDING A RULE
    Append a `SeparationRule`. `assert_allowed()` is called by
    `rbac.guards.require()` for every guarded capability, so a new rule takes
    effect everywhere that capability is used - no service edits.
"""

from __future__ import annotations

from dataclasses import dataclass

from gdb_bank.domain import events as ev
from gdb_bank.rbac import capabilities as cap


@dataclass(frozen=True)
class SeparationRule:
	rule_id: str
	"""Stable id. Surfaced in the 403 payload so support can name the rule that
	blocked an operator, without exposing internals."""

	blocked_capability: str
	"""The capability being exercised right now."""

	conflicting_events: tuple[str, ...]
	"""If the actor is recorded as the author of ANY of these events on the same
	subject, the action is refused."""

	message: str

	include_subject_party: bool = False
	"""Also refuse when the actor is the applicant / a co-applicant / the
	facilitator on the subject - "connected to" in features.md."""


RULES: tuple[SeparationRule, ...] = (
	SeparationRule(
		rule_id="approver_ne_releaser",
		blocked_capability=cap.DISBURSEMENT_RELEASE,
		conflicting_events=(ev.CREDIT_APPROVED, ev.OFFER_ISSUED),
		message="The officer who approved this loan may not release its funds.",
		include_subject_party=True,
	),
	SeparationRule(
		rule_id="approver_ne_condition_checker",
		blocked_capability=cap.CONDITION_VERIFY,
		conflicting_events=(ev.CREDIT_APPROVED, ev.OFFER_ISSUED),
		message="The officer who approved this loan may not verify its conditions.",
		include_subject_party=True,
	),
	SeparationRule(
		rule_id="approver_ne_countersigner",
		blocked_capability=cap.OFFER_COUNTERSIGN,
		conflicting_events=(ev.CREDIT_APPROVED, ev.OFFER_ISSUED),
		message="The officer who issued this offer may not countersign it for the Bank.",
		include_subject_party=True,
	),
	SeparationRule(
		rule_id="proposer_ne_rule_approver",
		blocked_capability=cap.RULE_APPROVE,
		conflicting_events=(ev.RULE_CHANGE_PROPOSED,),
		message="The officer who proposed this rule change may not approve it.",
	),
	SeparationRule(
		rule_id="maker_ne_credit_checker",
		blocked_capability=cap.CREDIT_APPROVE,
		conflicting_events=(
			ev.APPLICATION_CREATED,
			ev.APPLICATION_SUBMITTED,
			ev.ACTED_ON_BEHALF,
		),
		message="You may not decide an application you created, submitted or facilitated.",
		include_subject_party=True,
	),
	SeparationRule(
		rule_id="maker_ne_credit_decliner",
		blocked_capability=cap.CREDIT_DECLINE,
		conflicting_events=(
			ev.APPLICATION_CREATED,
			ev.APPLICATION_SUBMITTED,
			ev.ACTED_ON_BEHALF,
		),
		message="You may not decide an application you created, submitted or facilitated.",
		include_subject_party=True,
	),
	SeparationRule(
		rule_id="refunder_ne_releaser",
		blocked_capability=cap.FINANCE_REFUND,
		conflicting_events=(ev.FUNDS_RELEASED,),
		message="The officer who released these funds may not issue the refund.",
	),
)

BY_CAPABILITY: dict[str, tuple[SeparationRule, ...]] = {}
for _rule in RULES:
	BY_CAPABILITY.setdefault(_rule.blocked_capability, ())
	BY_CAPABILITY[_rule.blocked_capability] += (_rule,)

GUARDED_CAPABILITIES: frozenset[str] = frozenset(BY_CAPABILITY)


def rules_for(capability: str) -> tuple[SeparationRule, ...]:
	return BY_CAPABILITY.get(capability, ())
