"""Controller for GDB Loan Application.

Business behaviour lives in `gdb_bank/services/`, not here: CLAUDE.md keeps
domain logic out of Frappe controllers so it can be tested and reused. This
class carries only invariants that must hold no matter which code path writes
the document.
"""

from __future__ import annotations

from frappe.model.document import Document
from frappe.utils import flt

from gdb_bank.domain import statuses
from gdb_bank.security import errors


class GDBLoanApplication(Document):
	"""The loan case file.

	WHY THE DECISION FIELDS ARE NOT `read_only` IN THE SCHEMA
	    `"read_only": 1` on `approved_amount` locks the field in the desk form
	    for *everyone* - the Underwriter included, who is the one person the
	    feature exists for. It is a UI lock masquerading as a control: it stops
	    the only legitimate author and stops nothing else, because `db_set`, a
	    patch, an import and `frappe.client.set_value` all walk past it.

	    What features.md actually states is a *value* rule - "Approve — for the
	    amount asked or less, never more" - and what
	    `plan_signin_and_applicant.md` §4.4 asks for is that rule "enforced in
	    the service, not the form".

	    So the rule lives here, in `validate()`, which every write path runs
	    through, and the decision *service* (Phase 2) owns who may make the
	    decision and when. Two different questions: `validate()` answers "is
	    this document coherent", the service answers "may you do this now".
	    Neither answer belongs to a greyed-out input.

	    `decided_by` / `decided_on` / `doc_version` / `submitted_on` keep
	    `read_only` because nobody types those - they are stamps the server
	    writes. That is what the flag is for.
	"""

	def validate(self) -> None:
		self._assert_approved_amount_within_request()
		self._assert_decline_carries_a_reason()

	# ------------------------------------------------------------------ rules

	def _assert_approved_amount_within_request(self) -> None:
		"""features.md, Underwriter: "Approve — for the amount asked or less,
		never more."

		A falsy `approved_amount` is "no decision recorded yet", not "approved
		for nothing": Currency defaults to 0, so an undecided case would fail
		any unguarded comparison against a request of 0.
		"""
		approved = flt(self.approved_amount)
		if not approved:
			return

		requested = flt(self.requested_amount)
		if approved > requested:
			errors.throw(
				errors.ValidationFailed,
				"The approved amount cannot be more than the amount requested.",
				field="approved_amount",
			)

	def _assert_decline_carries_a_reason(self) -> None:
		"""features.md, Underwriter: "Write down the reason — required, cannot
		be left blank."

		Checked on the status rather than on who is saving, because a decline
		written by a patch or a data import is still a decline the applicant
		will read.
		"""
		if self.status != statuses.DECLINED:
			return

		if not (self.decision_reason or "").strip():
			errors.throw(
				errors.ValidationFailed,
				"A declined application must say why. The reason cannot be left blank.",
				field="decision_reason",
			)
