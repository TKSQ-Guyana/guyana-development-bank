"""The applicant-facing tracker must cover the whole lifecycle.

WHAT FAILS IF THIS TEST DOES NOT EXIST. Somebody adds a nineteenth status to
`statuses.py` — a perfectly ordinary thing to do — and every citizen whose case
reaches it sees a tracker with no step highlighted and a generic sentence,
while every staff screen works fine. Nothing errors. The people who would
notice are the ones who cannot report it.

Site-free: `domain/` imports no frappe, which is the point of keeping the
mapping there rather than in a service.
"""

from __future__ import annotations

import unittest

from gdb_bank.domain import journey
from gdb_bank.domain import statuses as st


class TotalityTest(unittest.TestCase):
	def test_every_status_maps_to_exactly_one_stage(self):
		journey.assert_total()

	def test_no_status_is_left_out(self):
		# Spelled out as well as asserted inside `assert_total`, so a failure
		# names the status rather than only the invariant.
		for status in st.ALL_STATUSES:
			self.assertIn(status, journey.STAGES, f"{status!r} has no applicant-facing stage")

	def test_every_step_is_reachable(self):
		used = {stage.step for stage in journey.STAGES.values()}
		for key in journey.STEP_KEYS:
			self.assertIn(key, used, f"tracker step {key!r} can never light up")

	def test_terminal_agrees_with_the_lifecycle(self):
		"""A tracker that showed a declined case as step 5 of 5 would read as
		completion. The two definitions of "ended" must not drift apart."""
		for status, stage in journey.STAGES.items():
			self.assertEqual(
				stage.terminal,
				status in st.TERMINAL_STATUSES,
				f"{status!r} disagrees about being terminal",
			)


class StageTest(unittest.TestCase):
	def test_draft_is_step_one_not_step_zero(self):
		self.assertEqual(journey.stage_for(st.DRAFT).step_index, 1)

	def test_the_three_review_states_read_the_same_to_an_applicant(self):
		"""Submitted / Under Review / Verification Pending are a real
		distinction to an underwriter and noise to the person waiting."""
		steps = {
			journey.stage_for(s).step
			for s in (st.SUBMITTED, st.UNDER_REVIEW, st.VERIFICATION_PENDING)
		}
		self.assertEqual(steps, {journey.UNDER_REVIEW})

	def test_states_waiting_on_the_applicant_are_flagged(self):
		"""Drives the call to action. The difference between being told to wait
		and being told to act is the whole value of the tracker."""
		for status in (st.DRAFT, st.INFO_REQUESTED, st.OFFER_ISSUED, st.CONDITIONS_PENDING):
			self.assertTrue(
				journey.stage_for(status).needs_applicant,
				f"{status!r} waits on the applicant but does not say so",
			)

	def test_states_waiting_on_the_bank_are_not_flagged(self):
		for status in (st.SUBMITTED, st.UNDER_REVIEW, st.APPROVED, st.COUNTERSIGNED):
			self.assertFalse(journey.stage_for(status).needs_applicant)

	def test_an_unmapped_status_degrades_instead_of_raising(self):
		"""The invariant above is what stops this happening. This is what makes
		it survivable if it does: a citizen must not meet a 500 on their own
		case because of a missing dictionary entry."""
		stage = journey.stage_for("Some Future State")
		self.assertEqual(stage.step, journey.UNDER_REVIEW)
		self.assertFalse(stage.terminal)


class PayloadTest(unittest.TestCase):
	def test_payload_carries_what_the_tracker_needs(self):
		payload = journey.as_payload(st.OFFER_ISSUED)
		self.assertEqual(payload["status"], st.OFFER_ISSUED)
		self.assertEqual(payload["step"], journey.SIGNING)
		self.assertEqual(payload["step_count"], len(journey.STEPS))
		self.assertEqual(len(payload["steps"]), len(journey.STEPS))
		self.assertTrue(payload["needs_applicant"])

	def test_step_index_is_within_the_rail(self):
		for status in st.ALL_STATUSES:
			payload = journey.as_payload(status)
			self.assertGreaterEqual(payload["step_index"], 1)
			self.assertLessEqual(payload["step_index"], payload["step_count"])


if __name__ == "__main__":
	unittest.main()
