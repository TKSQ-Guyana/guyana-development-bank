"""Eighteen internal states, five things a citizen is told.

`statuses.py` is the machine's view: every state a case can be in and who may
move it. This is the applicant's view of the same case — the five-step tracker
on the dashboard, and the one plain sentence underneath it.

WHY THIS MAPPING LIVES ON THE SERVER
    Two reasons, and the second is the one that matters.

    The SPA is an untrusted client, so it renders what it is handed rather than
    deriving anything. But more practically: a nineteenth state added to
    `statuses.ALL_STATUSES` must not be able to fall silently off a `switch` in
    a React component and render as a blank tracker. Here, `assert_total()`
    fails the build instead.

WHY FIVE STEPS AND NOT EIGHTEEN
    `project_overview.md` section 4 promises the applicant can see "where the
    application has reached" — not the bank's internal queue structure. The
    difference between `Submitted`, `Under Review` and `Verification Pending`
    is real to an underwriter and noise to the person waiting: all three mean
    "GDB has it and is looking at it". Collapsing them is the honest summary,
    not a simplification.

ON THE WORDING
    The sentences below are the Bank speaking to an applicant about their own
    money, so they are policy rather than copy. They say what is happening and
    who is doing it, never "please wait". Changing one is a product decision.

A TERMINAL STATE IS NOT A STEP
    Declined, Offer Declined and Withdrawn end the journey rather than advance
    it, so each maps to the step it ended ON, plus `terminal=True`. A tracker
    that showed "Declined" as step 5 of 5 would read as completion.
"""

from __future__ import annotations

from dataclasses import dataclass

from gdb_bank.domain import statuses as st

# --------------------------------------------------------------------- steps
STARTED = "started"
UNDER_REVIEW = "under_review"
DECISION = "decision"
SIGNING = "signing"
FUNDS_RELEASED = "funds_released"

STEPS: tuple[tuple[str, str], ...] = (
	(STARTED, "Started"),
	(UNDER_REVIEW, "Under review"),
	(DECISION, "Decision"),
	(SIGNING, "Signing"),
	(FUNDS_RELEASED, "Funds released"),
)

STEP_KEYS: tuple[str, ...] = tuple(key for key, _ in STEPS)
STEP_LABELS: dict[str, str] = dict(STEPS)


@dataclass(frozen=True)
class Stage:
	step: str
	"""Which of the five the tracker highlights."""

	label: str
	"""The status word shown on the card's badge."""

	message: str
	"""The one sentence under the tracker. What is happening, and who by."""

	terminal: bool = False
	"""The journey ended here. The tracker must not read as progress."""

	needs_applicant: bool = False
	"""The next move is the applicant's. Drives the "what you need to do" call
	to action — the difference between waiting and being waited on."""

	@property
	def step_index(self) -> int:
		"""1-based, for the tracker. Never 0, so a Draft still shows step 1 of 5
		rather than an empty rail."""
		return STEP_KEYS.index(self.step) + 1


# The whole mapping, as data. Every member of `statuses.ALL_STATUSES` appears
# exactly once — `assert_total()` is what keeps that true.
STAGES: dict[str, Stage] = {
	st.DRAFT: Stage(
		step=STARTED,
		label="Started",
		message="Not submitted yet. You can carry on where you left off.",
		needs_applicant=True,
	),
	st.SUBMITTED: Stage(
		step=UNDER_REVIEW,
		label="Under review",
		message="GDB has your application and will begin reviewing it.",
	),
	st.UNDER_REVIEW: Stage(
		step=UNDER_REVIEW,
		label="Under review",
		message="GDB is reviewing your application.",
	),
	st.VERIFICATION_PENDING: Stage(
		step=UNDER_REVIEW,
		label="Under review",
		# Deliberately not "verification failed". An external check that timed
		# out is the Bank's problem to resolve, not a finding against the
		# applicant — project_overview.md is explicit that a timeout yields a
		# pending state for manual review, never a business rejection.
		message="GDB is confirming some details with other agencies.",
	),
	st.INFO_REQUESTED: Stage(
		step=UNDER_REVIEW,
		label="Action needed",
		message="GDB has asked you for something specific. Send it back to continue.",
		needs_applicant=True,
	),
	st.APPROVED: Stage(
		step=DECISION,
		label="Approved",
		message="Your application was approved. Your letter of offer is being prepared.",
	),
	st.DECLINED: Stage(
		step=DECISION,
		label="Declined",
		message="GDB was not able to approve this application. The reason is on your case.",
		terminal=True,
	),
	st.OFFER_ISSUED: Stage(
		step=SIGNING,
		label="Offer ready",
		message="Your letter of offer is ready to read, accept or decline.",
		needs_applicant=True,
	),
	st.OFFER_ACCEPTED: Stage(
		step=SIGNING,
		label="Signing",
		message="You accepted the offer. GDB is countersigning.",
	),
	st.OFFER_DECLINED: Stage(
		step=SIGNING,
		label="Offer declined",
		message="You declined this offer. Nothing further will happen on this application.",
		terminal=True,
	),
	st.COUNTERSIGNED: Stage(
		step=SIGNING,
		label="Signing",
		message="GDB has countersigned. The conditions to be met before payment are being set.",
	),
	st.CONDITIONS_PENDING: Stage(
		step=SIGNING,
		label="Conditions",
		message="Some conditions must be met before the money is released.",
		needs_applicant=True,
	),
	st.CLEARED_FOR_DISBURSEMENT: Stage(
		step=SIGNING,
		label="Signing",
		message="Payment is being arranged.",
	),
	st.PARTIALLY_DISBURSED: Stage(
		step=FUNDS_RELEASED,
		label="Part released",
		message="Part of your financing has been released. The rest is being arranged.",
	),
	st.DISBURSED: Stage(
		step=FUNDS_RELEASED,
		label="Funds released",
		message="Your financing has been released. Confirm when you have received it.",
		needs_applicant=True,
	),
	st.REPAYING: Stage(
		step=FUNDS_RELEASED,
		label="Repaying",
		message="Your facility is active. Your repayment schedule is in Payments.",
	),
	st.CLOSED: Stage(
		step=FUNDS_RELEASED,
		label="Closed",
		message="This facility is fully repaid and closed. Your records stay available.",
		terminal=True,
	),
	st.WITHDRAWN: Stage(
		step=STARTED,
		label="Withdrawn",
		message="This application was withdrawn.",
		terminal=True,
	),
}


def stage_for(status: str) -> Stage:
	"""The applicant's view of one internal status.

	An unmapped status falls back rather than raising: a citizen looking at
	their own case must not be shown a 500 because somebody added a state and
	forgot this file. `assert_total()` is what makes sure that never ships, and
	this is what makes the failure survivable if it does.
	"""
	stage = STAGES.get(status)
	if stage is not None:
		return stage
	return Stage(
		step=UNDER_REVIEW,
		label="In progress",
		message="GDB is working on your application.",
	)


def as_payload(status: str) -> dict:
	"""What the SPA receives. The internal status is included because staff
	screens render it; a citizen's own screens use `label` and `message`."""
	stage = stage_for(status)
	return {
		"status": status,
		"step": stage.step,
		"step_index": stage.step_index,
		"step_count": len(STEPS),
		"label": stage.label,
		"message": stage.message,
		"terminal": stage.terminal,
		"needs_applicant": stage.needs_applicant,
		"steps": [{"key": key, "label": label} for key, label in STEPS],
	}


def assert_total() -> None:
	"""Every lifecycle status maps to exactly one step, and every step is
	reachable. Called by the test suite.

	The second half matters as much as the first: a step no status maps to is a
	rail segment that can never light up, which reads to an applicant as a
	stage their case is stuck before.
	"""
	missing = [s for s in st.ALL_STATUSES if s not in STAGES]
	if missing:
		raise AssertionError(f"lifecycle statuses with no applicant-facing stage: {missing}")

	unknown = [s for s in STAGES if s not in st.ALL_STATUSES]
	if unknown:
		raise AssertionError(f"stages mapped from statuses that do not exist: {unknown}")

	used = {stage.step for stage in STAGES.values()}
	unreachable = [key for key in STEP_KEYS if key not in used]
	if unreachable:
		raise AssertionError(f"tracker steps no status maps to: {unreachable}")

	for status, stage in STAGES.items():
		if (status in st.TERMINAL_STATUSES) != stage.terminal:
			raise AssertionError(
				f"{status!r}: terminal in statuses.py is "
				f"{status in st.TERMINAL_STATUSES}, but the stage says {stage.terminal}"
			)
