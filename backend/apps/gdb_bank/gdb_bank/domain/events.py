"""Business audit event types.

These strings are written to `GDB Audit Event.event` and are what the
separation-of-duties engine queries ("who APPROVED this case?"). They are
persisted forever - append, never rename.
"""

from __future__ import annotations

# identity / consent
CONSENT_GIVEN = "consent.given"

# application lifecycle
APPLICATION_CREATED = "application.created"
APPLICATION_DRAFT_SAVED = "application.draft_saved"
APPLICATION_SUBMITTED = "application.submitted"
APPLICATION_INFO_REQUESTED = "application.info_requested"
APPLICATION_INFO_SUPPLIED = "application.info_supplied"

# documents
DOCUMENT_UPLOADED = "document.uploaded"
DOCUMENT_REPLACED = "document.replaced"
DOCUMENT_DOWNLOADED = "document.downloaded"

# credit decision
CREDIT_APPROVED = "credit.approved"
CREDIT_DECLINED = "credit.declined"
OFFER_ISSUED = "offer.issued"
OFFER_ACCEPTED = "offer.accepted"
OFFER_DECLINED = "offer.declined"
OFFER_COUNTERSIGNED = "offer.countersigned"
LOAN_BOOKED = "loan.booked"

# conditions + disbursement
CONDITION_ADDED = "condition.added"
CONDITION_VERIFIED = "condition.verified"
CONDITION_REJECTED = "condition.rejected"
FUNDS_RELEASED = "funds.released"
PAYMENT_FILE_EXPORTED = "payment_file.exported"
DISBURSEMENT_OUTCOME_RECORDED = "disbursement.outcome_recorded"
DISBURSEMENT_EXCEPTION_RECORDED = "disbursement.exception_recorded"
RECEIPT_CONFIRMED = "disbursement.receipt_confirmed"

# finance
REPAYMENT_RECORDED = "repayment.recorded"
REFUND_ISSUED = "refund.issued"
RECONCILIATION_MATCHED = "reconciliation.matched"

# lending rules
RULE_CHANGE_PROPOSED = "rule_change.proposed"
RULE_CHANGE_APPROVED = "rule_change.approved"
RULE_CHANGE_REJECTED = "rule_change.rejected"

# facilitator delegation
MANDATE_GRANTED = "mandate.granted"
MANDATE_REVOKED = "mandate.revoked"
ACTED_ON_BEHALF = "facilitator.acted_on_behalf"

# administration
USER_DISABLED = "admin.user_disabled"
USER_ENABLED = "admin.user_enabled"
ROLES_CHANGED = "admin.roles_changed"

# authorization
ACCESS_DENIED = "security.access_denied"
SEPARATION_VIOLATION_BLOCKED = "security.separation_violation_blocked"
