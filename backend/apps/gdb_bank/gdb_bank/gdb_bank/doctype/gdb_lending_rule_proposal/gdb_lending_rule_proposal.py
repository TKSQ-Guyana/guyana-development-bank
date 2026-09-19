"""GDB Lending Rule Proposal — Finance proposes, another Finance officer decides.

Changing a lending rule (rate, ceiling, term limits, required documents,
standard conditions, capacity calculation, charges) is Finance's job, but never
a rule Finance sets unilaterally: install.ensure_lending_rule_proposal_workflow
drives this through a Draft -> Pending -> Approved/Rejected workflow, and the
role gate there lets any Finance Officer decide a Pending proposal.

That role gate alone is a naming convention, not a control — a person granted
Finance Officer could draft and decide the same proposal. before_save is the
second, explicit gate that makes it real, the same shape as
api.disburse_loan's four-eyes check: refuse the SAME officer who proposed it,
whatever role they hold.

Approving a proposal here records the decision. It does not, by itself, touch
the live product terms (install.LOAN_PRODUCT_NAME, ensure_product_terms) — that
stays a deliberate, separate step, so a rule never changes just because a
record was approved.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class GDBLendingRuleProposal(Document):
	def before_insert(self):
		self.proposed_by = frappe.session.user
		self.proposed_on = now_datetime()

	def before_save(self):
		if self.workflow_state not in ("Approved", "Rejected"):
			return
		if not self.has_value_changed("workflow_state"):
			return

		if frappe.session.user == self.proposed_by:
			frappe.throw(
				_("You proposed this rule change. Another Finance officer must approve or reject it."),
				frappe.PermissionError,
			)
		if self.workflow_state == "Rejected" and not self.decision_note:
			frappe.throw(_("A rejection needs a reason."))

		self.decided_by = frappe.session.user
		self.decided_on = now_datetime()
