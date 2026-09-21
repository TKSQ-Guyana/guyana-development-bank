"""The application lifecycle, declared as data.

One state machine covers every route (sole trader, partnership, cluster). The
transitions table is the authority: `services/` never assigns a status
directly, it calls `assert_transition()` first. Adding a state means adding a
row here, not an `if` in three services.
"""

from __future__ import annotations

from dataclasses import dataclass

from gdb_bank.rbac import capabilities as cap

# --------------------------------------------------------------------- states
DRAFT = "Draft"
SUBMITTED = "Submitted"
INFO_REQUESTED = "Information Requested"
UNDER_REVIEW = "Under Review"
VERIFICATION_PENDING = "Verification Pending"
APPROVED = "Approved"
DECLINED = "Declined"
OFFER_ISSUED = "Offer Issued"
OFFER_ACCEPTED = "Offer Accepted"
OFFER_DECLINED = "Offer Declined"
COUNTERSIGNED = "Countersigned"
CONDITIONS_PENDING = "Conditions Pending"
CLEARED_FOR_DISBURSEMENT = "Cleared for Disbursement"
PARTIALLY_DISBURSED = "Partially Disbursed"
DISBURSED = "Disbursed"
REPAYING = "Repaying"
CLOSED = "Closed"
WITHDRAWN = "Withdrawn"

ALL_STATUSES: tuple[str, ...] = (
	DRAFT,
	SUBMITTED,
	INFO_REQUESTED,
	UNDER_REVIEW,
	VERIFICATION_PENDING,
	APPROVED,
	DECLINED,
	OFFER_ISSUED,
	OFFER_ACCEPTED,
	OFFER_DECLINED,
	COUNTERSIGNED,
	CONDITIONS_PENDING,
	CLEARED_FOR_DISBURSEMENT,
	PARTIALLY_DISBURSED,
	DISBURSED,
	REPAYING,
	CLOSED,
	WITHDRAWN,
)

TERMINAL_STATUSES: frozenset[str] = frozenset({DECLINED, OFFER_DECLINED, CLOSED, WITHDRAWN})

EDITABLE_BY_APPLICANT: frozenset[str] = frozenset({DRAFT, INFO_REQUESTED})
"""The only states in which an applicant (or their facilitator) may write."""

VISIBLE_TO_UNDERWRITER_QUEUE: tuple[str, ...] = (
	SUBMITTED,
	UNDER_REVIEW,
	INFO_REQUESTED,
	VERIFICATION_PENDING,
)

DISBURSEMENT_QUEUE: tuple[str, ...] = (
	COUNTERSIGNED,
	CONDITIONS_PENDING,
	CLEARED_FOR_DISBURSEMENT,
	PARTIALLY_DISBURSED,
)


@dataclass(frozen=True)
class Transition:
	source: str
	target: str
	capability: str
	"""The capability the actor must hold. Not a role - see rbac/capabilities."""


TRANSITIONS: tuple[Transition, ...] = (
	# --- applicant / facilitator
	Transition(DRAFT, SUBMITTED, cap.APPLICATION_SUBMIT),
	Transition(DRAFT, WITHDRAWN, cap.APPLICATION_EDIT_DRAFT),
	Transition(INFO_REQUESTED, SUBMITTED, cap.APPLICATION_RESPOND_TO_INFO_REQUEST),
	Transition(OFFER_ISSUED, OFFER_ACCEPTED, cap.OFFER_ACCEPT),
	Transition(OFFER_ISSUED, OFFER_DECLINED, cap.OFFER_ACCEPT),
	Transition(DISBURSED, REPAYING, cap.DISBURSEMENT_CONFIRM_RECEIPT),
	# --- underwriter
	Transition(SUBMITTED, UNDER_REVIEW, cap.APPLICATION_VIEW_QUEUE),
	Transition(UNDER_REVIEW, INFO_REQUESTED, cap.APPLICATION_REQUEST_INFO),
	Transition(SUBMITTED, INFO_REQUESTED, cap.APPLICATION_REQUEST_INFO),
	Transition(UNDER_REVIEW, VERIFICATION_PENDING, cap.VERIFICATION_VIEW_COMPARISON),
	Transition(VERIFICATION_PENDING, UNDER_REVIEW, cap.VERIFICATION_VIEW_COMPARISON),
	Transition(UNDER_REVIEW, APPROVED, cap.CREDIT_APPROVE),
	Transition(UNDER_REVIEW, DECLINED, cap.CREDIT_DECLINE),
	Transition(SUBMITTED, DECLINED, cap.CREDIT_DECLINE),
	Transition(APPROVED, OFFER_ISSUED, cap.OFFER_ISSUE),
	# --- disbursement officer
	Transition(OFFER_ACCEPTED, COUNTERSIGNED, cap.OFFER_COUNTERSIGN),
	Transition(COUNTERSIGNED, CONDITIONS_PENDING, cap.CONDITION_VERIFY),
	Transition(CONDITIONS_PENDING, CLEARED_FOR_DISBURSEMENT, cap.CONDITION_VERIFY),
	Transition(COUNTERSIGNED, CLEARED_FOR_DISBURSEMENT, cap.CONDITION_VERIFY),
	Transition(CLEARED_FOR_DISBURSEMENT, PARTIALLY_DISBURSED, cap.DISBURSEMENT_RELEASE),
	Transition(CLEARED_FOR_DISBURSEMENT, DISBURSED, cap.DISBURSEMENT_RELEASE),
	Transition(PARTIALLY_DISBURSED, DISBURSED, cap.DISBURSEMENT_RELEASE),
	# --- finance
	Transition(REPAYING, CLOSED, cap.FINANCE_VIEW_LEDGER),
)

_INDEX: dict[tuple[str, str], Transition] = {(t.source, t.target): t for t in TRANSITIONS}


def allowed_targets(source: str) -> tuple[str, ...]:
	return tuple(t.target for t in TRANSITIONS if t.source == source)


def transition_for(source: str, target: str) -> Transition | None:
	return _INDEX.get((source, target))


def is_editable_by_applicant(status: str) -> bool:
	return status in EDITABLE_BY_APPLICANT
