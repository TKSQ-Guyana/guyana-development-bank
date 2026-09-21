"""The capability vocabulary — the atoms every authorization decision is made of.

Nothing in `services/` or `api/` ever asks "is this user an Underwriter?".
It asks "may this user APPROVE_CREDIT?". That indirection is what makes a new
persona a data change (one entry in `personas.PERSONAS`) instead of a grep
across the codebase.

ADDING A CAPABILITY
    1. Add the constant below, inside the section it belongs to.
    2. Grant it to the personas that should hold it in `personas.py`.
    3. Guard the service function with `@require(CAP_X)`.
    Nothing else. `ALL_CAPABILITIES` is derived, and `provisioning.py` reconciles
    Frappe's roles on the next `bench migrate`.

NAMING
    "<domain>.<verb>" — lowercase, dot-separated, stable forever. The string is
    persisted in audit rows and shipped to the SPA, so renaming one is a
    migration, not an edit. Retire instead: see `personas.RETIRED_CAPABILITIES`.
"""

from __future__ import annotations

# ---------------------------------------------------------------- identity --
IDENTITY_VIEW_SELF = "identity.view_self"
IDENTITY_GIVE_CONSENT = "identity.give_consent"
IDENTITY_VIEW_GOVERNMENT_RECORD = "identity.view_government_record"

# ------------------------------------------------------------- application --
APPLICATION_CREATE = "application.create"
APPLICATION_EDIT_DRAFT = "application.edit_draft"
APPLICATION_SUBMIT = "application.submit"
APPLICATION_VIEW_OWN = "application.view_own"
APPLICATION_VIEW_FACILITATED = "application.view_facilitated"
APPLICATION_VIEW_ANY = "application.view_any"
APPLICATION_VIEW_QUEUE = "application.view_queue"
APPLICATION_REQUEST_INFO = "application.request_info"
APPLICATION_RESPOND_TO_INFO_REQUEST = "application.respond_to_info_request"
# Delegated authority (Phase 2.5) — act for a cluster you are mandated to serve.
APPLICATION_DRAFT_ON_BEHALF = "application.draft_on_behalf"
APPLICATION_SUBMIT_ON_BEHALF = "application.submit_on_behalf"

# ---------------------------------------------------------------- document --
DOCUMENT_UPLOAD_OWN = "document.upload_own"
DOCUMENT_VIEW_OWN = "document.view_own"
DOCUMENT_UPLOAD_ON_BEHALF = "document.upload_on_behalf"
DOCUMENT_VIEW_ANY = "document.view_any"

# ------------------------------------------------------------ underwriting --
VERIFICATION_VIEW_COMPARISON = "verification.view_comparison"
CREDIT_APPROVE = "credit.approve"
CREDIT_DECLINE = "credit.decline"
OFFER_ISSUE = "offer.issue"
OFFER_ACCEPT = "offer.accept"
OFFER_COUNTERSIGN = "offer.countersign"
LOAN_BOOK = "loan.book"
DECISION_VIEW_OWN_HISTORY = "decision.view_own_history"

# ----------------------------------------------------------- disbursement --
CONDITION_VIEW = "condition.view"
CONDITION_COMPLETE_OWN = "condition.complete_own"
CONDITION_VERIFY = "condition.verify"
DISBURSEMENT_VIEW_QUEUE = "disbursement.view_queue"
DISBURSEMENT_RELEASE = "disbursement.release"
DISBURSEMENT_EXPORT_PAYMENT_FILE = "disbursement.export_payment_file"
DISBURSEMENT_RECORD_OUTCOME = "disbursement.record_outcome"
DISBURSEMENT_RECORD_EXCEPTION = "disbursement.record_exception"
DISBURSEMENT_CONFIRM_RECEIPT = "disbursement.confirm_receipt"

# ----------------------------------------------------------------- finance --
FINANCE_VIEW_LEDGER = "finance.view_ledger"
FINANCE_RECONCILE = "finance.reconcile"
FINANCE_REFUND = "finance.refund"
FINANCE_PORTFOLIO_DETAIL = "finance.portfolio_detail"

# --------------------------------------------------------------- repayment --
REPAYMENT_VIEW_OWN_SCHEDULE = "repayment.view_own_schedule"
REPAYMENT_PAY = "repayment.pay"
REPAYMENT_REQUEST_STATEMENT = "repayment.request_statement"

# ----------------------------------------------------------------- cluster --
CLUSTER_CREATE = "cluster.create"
CLUSTER_INVITE_MEMBER = "cluster.invite_member"
CLUSTER_ACCEPT_INVITE = "cluster.accept_invite"
CLUSTER_VIEW_MEMBERS = "cluster.view_members"
CLUSTER_GRANT_FACILITATOR_MANDATE = "cluster.grant_facilitator_mandate"

# ----------------------------------------------------------- lending rules --
RULE_PROPOSE = "rule.propose"
RULE_APPROVE = "rule.approve"
RULE_VIEW_HISTORY = "rule.view_history"

# ----------------------------------------------------------------- reports --
REPORT_PORTFOLIO_AGGREGATE = "report.portfolio_aggregate"
REPORT_ARREARS_AGGREGATE = "report.arrears_aggregate"
REPORT_TRENDS_AGGREGATE = "report.trends_aggregate"

# ------------------------------------------------------------------- admin --
ADMIN_MANAGE_USERS = "admin.manage_users"
ADMIN_GRANT_ROLES = "admin.grant_roles"
ADMIN_DISABLE_USER = "admin.disable_user"
ADMIN_VIEW_SYSTEM_HEALTH = "admin.view_system_health"
ADMIN_MANAGE_INTEGRATIONS = "admin.manage_integrations"


def _collect() -> frozenset[str]:
	"""Every CAP constant declared above, by convention: module-level uppercase
	names bound to a str. Keeps the inventory honest without a second list to
	forget to update."""
	return frozenset(
		value
		for name, value in globals().items()
		if name.isupper() and not name.startswith("_") and isinstance(value, str)
	)


ALL_CAPABILITIES: frozenset[str] = _collect()
