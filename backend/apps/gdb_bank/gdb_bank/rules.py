"""Lending rule proposals — Finance proposes a change, another Finance officer
decides it.

Storage and the maker-checker rule both live on the doctype itself
(GDB Lending Rule Proposal, gdb_lending_rule_proposal.py) and its workflow
(install.ensure_lending_rule_proposal_workflow). This module is the thin
portal-facing surface over Frappe's own workflow engine, the same relationship
gdb_bank.api has with lending: no second copy of the state machine here.

Approving a proposal records the decision. It does not touch the live product
terms (install.LOAN_PRODUCT_NAME) — applying an approved change stays a
separate, deliberate step, so a rule never changes just because a record was
approved.

Endpoints: POST /api/method/gdb_bank.rules.<name>
"""

import frappe
from frappe import _

from gdb_bank.api import _logger, _require_finance

DOCTYPE = "GDB Lending Rule Proposal"

PROPOSAL_FIELDS = [
	"name",
	"rule_type",
	"effective_date",
	"workflow_state",
	"current_value",
	"proposed_value",
	"justification",
	"proposed_by",
	"proposed_on",
	"decided_by",
	"decided_on",
	"decision_note",
	"docstatus",
	"creation",
]


@frappe.whitelist()
def list_rule_proposals():
	"""Every proposal, newest first — the history features.md asks for:
	who proposed a change, who decided it, and when."""
	_require_finance()
	return frappe.get_all(
		DOCTYPE, fields=PROPOSAL_FIELDS, order_by="creation desc", limit_page_length=0
	)


@frappe.whitelist()
def propose_rule_change(
	rule_type: str,
	current_value: str,
	proposed_value: str,
	justification: str,
	effective_date: str,
):
	"""Draft a rule change and put it before Finance in the same step —
	Draft exists as an audit state, not as a screen anyone has to visit twice."""
	user = _require_finance()

	doc = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"rule_type": rule_type,
			"current_value": current_value,
			"proposed_value": proposed_value,
			"justification": justification,
			"effective_date": effective_date,
		}
	)
	doc.insert()

	from frappe.model.workflow import apply_workflow

	doc = apply_workflow(doc, "Submit")
	frappe.db.commit()
	_logger().info(f"rule proposal {doc.name} ({rule_type}) proposed by {user}")
	return {"name": doc.name, "workflow_state": doc.workflow_state}


@frappe.whitelist()
def decide_rule_proposal(name: str, action: str, decision_note: str | None = None):
	"""Approve or reject a Pending proposal.

	Two gates, same shape as api.disburse_loan: the role gate here lets any
	Finance Officer decide, and gdb_lending_rule_proposal.py's before_save
	refuses the SAME officer who proposed it. A rejection needs a reason,
	written before the transition so the record carries it from the moment it
	becomes Rejected rather than in a second, optional edit.
	"""
	user = _require_finance()
	if action not in ("Approve", "Reject"):
		frappe.throw(_("Not a valid decision."))

	doc = frappe.get_doc(DOCTYPE, name)
	if action == "Reject":
		if not decision_note:
			frappe.throw(_("A rejection needs a reason."))
		doc.decision_note = decision_note
		doc.save()

	from frappe.model.workflow import apply_workflow

	doc = apply_workflow(doc, action)
	frappe.db.commit()
	_logger().info(f"rule proposal {name} {action.lower()}ed by {user}")
	return {"name": doc.name, "workflow_state": doc.workflow_state}
