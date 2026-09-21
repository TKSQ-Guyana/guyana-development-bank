// GENERATED FILE - DO NOT EDIT.
// Source of truth: backend/apps/gdb_bank/gdb_bank/rbac/capabilities.py
//                  backend/apps/gdb_bank/gdb_bank/rbac/personas.py
// Regenerate:      cd backend && python scripts/export_rbac.py
//
// The SPA authorizes nothing - these strings drive what it RENDERS. Every
// capability is re-checked server-side by rbac/guards.py on the call that
// uses it, so a tampered client gets a 403, not data.

export const CAP = {
  ADMIN_DISABLE_USER: 'admin.disable_user',
  ADMIN_GRANT_ROLES: 'admin.grant_roles',
  ADMIN_MANAGE_INTEGRATIONS: 'admin.manage_integrations',
  ADMIN_MANAGE_USERS: 'admin.manage_users',
  ADMIN_VIEW_SYSTEM_HEALTH: 'admin.view_system_health',
  APPLICATION_CREATE: 'application.create',
  APPLICATION_DRAFT_ON_BEHALF: 'application.draft_on_behalf',
  APPLICATION_EDIT_DRAFT: 'application.edit_draft',
  APPLICATION_REQUEST_INFO: 'application.request_info',
  APPLICATION_RESPOND_TO_INFO_REQUEST: 'application.respond_to_info_request',
  APPLICATION_SUBMIT: 'application.submit',
  APPLICATION_SUBMIT_ON_BEHALF: 'application.submit_on_behalf',
  APPLICATION_VIEW_ANY: 'application.view_any',
  APPLICATION_VIEW_FACILITATED: 'application.view_facilitated',
  APPLICATION_VIEW_OWN: 'application.view_own',
  APPLICATION_VIEW_QUEUE: 'application.view_queue',
  CLUSTER_ACCEPT_INVITE: 'cluster.accept_invite',
  CLUSTER_CREATE: 'cluster.create',
  CLUSTER_GRANT_FACILITATOR_MANDATE: 'cluster.grant_facilitator_mandate',
  CLUSTER_INVITE_MEMBER: 'cluster.invite_member',
  CLUSTER_VIEW_MEMBERS: 'cluster.view_members',
  CONDITION_COMPLETE_OWN: 'condition.complete_own',
  CONDITION_VERIFY: 'condition.verify',
  CONDITION_VIEW: 'condition.view',
  CREDIT_APPROVE: 'credit.approve',
  CREDIT_DECLINE: 'credit.decline',
  DECISION_VIEW_OWN_HISTORY: 'decision.view_own_history',
  DISBURSEMENT_CONFIRM_RECEIPT: 'disbursement.confirm_receipt',
  DISBURSEMENT_EXPORT_PAYMENT_FILE: 'disbursement.export_payment_file',
  DISBURSEMENT_RECORD_EXCEPTION: 'disbursement.record_exception',
  DISBURSEMENT_RECORD_OUTCOME: 'disbursement.record_outcome',
  DISBURSEMENT_RELEASE: 'disbursement.release',
  DISBURSEMENT_VIEW_QUEUE: 'disbursement.view_queue',
  DOCUMENT_UPLOAD_ON_BEHALF: 'document.upload_on_behalf',
  DOCUMENT_UPLOAD_OWN: 'document.upload_own',
  DOCUMENT_VIEW_ANY: 'document.view_any',
  DOCUMENT_VIEW_OWN: 'document.view_own',
  FINANCE_PORTFOLIO_DETAIL: 'finance.portfolio_detail',
  FINANCE_RECONCILE: 'finance.reconcile',
  FINANCE_REFUND: 'finance.refund',
  FINANCE_VIEW_LEDGER: 'finance.view_ledger',
  IDENTITY_GIVE_CONSENT: 'identity.give_consent',
  IDENTITY_VIEW_GOVERNMENT_RECORD: 'identity.view_government_record',
  IDENTITY_VIEW_SELF: 'identity.view_self',
  LOAN_BOOK: 'loan.book',
  OFFER_ACCEPT: 'offer.accept',
  OFFER_COUNTERSIGN: 'offer.countersign',
  OFFER_ISSUE: 'offer.issue',
  REPAYMENT_PAY: 'repayment.pay',
  REPAYMENT_REQUEST_STATEMENT: 'repayment.request_statement',
  REPAYMENT_VIEW_OWN_SCHEDULE: 'repayment.view_own_schedule',
  REPORT_ARREARS_AGGREGATE: 'report.arrears_aggregate',
  REPORT_PORTFOLIO_AGGREGATE: 'report.portfolio_aggregate',
  REPORT_TRENDS_AGGREGATE: 'report.trends_aggregate',
  RULE_APPROVE: 'rule.approve',
  RULE_PROPOSE: 'rule.propose',
  RULE_VIEW_HISTORY: 'rule.view_history',
  VERIFICATION_VIEW_COMPARISON: 'verification.view_comparison',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/** Persona catalogue, mirrored for labels and admin screens. */
export const PERSONAS = [
  {
    key: 'citizen',
    title: 'Citizen',
    description: 'Applicant or borrower. Sees only their own case.',
    rowScope: 'own_eid',
    portalHome: '/',
    capabilities: ['application.create', 'application.edit_draft', 'application.respond_to_info_request', 'application.submit', 'application.view_own', 'cluster.accept_invite', 'cluster.create', 'cluster.grant_facilitator_mandate', 'cluster.invite_member', 'cluster.view_members', 'condition.complete_own', 'condition.view', 'disbursement.confirm_receipt', 'document.upload_own', 'document.view_own', 'identity.give_consent', 'identity.view_government_record', 'identity.view_self', 'offer.accept', 'repayment.pay', 'repayment.request_statement', 'repayment.view_own_schedule'] as Capability[],
  },
  {
    key: 'facilitator',
    title: 'Regional Facilitator',
    description: 'Drafts and submits on behalf of a cluster that has explicitly mandated them. Never becomes the owner of the application.',
    rowScope: 'facilitated',
    portalHome: '/facilitator',
    capabilities: ['application.draft_on_behalf', 'application.edit_draft', 'application.submit_on_behalf', 'application.view_facilitated', 'cluster.view_members', 'condition.view', 'document.upload_on_behalf', 'identity.view_self'] as Capability[],
  },
  {
    key: 'underwriter',
    title: 'Underwriter',
    description: 'Credit decision maker. Cannot release money, verify conditions, change a lending rule, or review their own application.',
    rowScope: 'all',
    portalHome: '/underwriting',
    capabilities: ['application.request_info', 'application.view_any', 'application.view_queue', 'condition.view', 'credit.approve', 'credit.decline', 'decision.view_own_history', 'document.view_any', 'identity.view_self', 'loan.book', 'offer.issue', 'rule.view_history', 'verification.view_comparison'] as Capability[],
  },
  {
    key: 'disbursement_officer',
    title: 'Disbursement Officer',
    description: 'Verifies conditions, countersigns, releases funds. Cannot decide credit, and cannot release a loan they approved or are party to.',
    rowScope: 'all',
    portalHome: '/disbursement',
    capabilities: ['application.view_any', 'condition.verify', 'condition.view', 'disbursement.export_payment_file', 'disbursement.record_exception', 'disbursement.record_outcome', 'disbursement.release', 'disbursement.view_queue', 'document.view_any', 'identity.view_self', 'offer.countersign', 'rule.view_history'] as Capability[],
  },
  {
    key: 'finance',
    title: 'Finance Officer',
    description: 'Ledger, reconciliation, refunds, portfolio reporting down to the case. Proposes lending rule changes but never approves their own.',
    rowScope: 'all',
    portalHome: '/finance',
    capabilities: ['application.view_any', 'finance.portfolio_detail', 'finance.reconcile', 'finance.refund', 'finance.view_ledger', 'identity.view_self', 'report.arrears_aggregate', 'report.portfolio_aggregate', 'report.trends_aggregate', 'rule.propose', 'rule.view_history'] as Capability[],
  },
  {
    key: 'board',
    title: 'Board / CEO',
    description: 'Aggregate reporting and rule approval. Has NO read permission on any case-level DocType - Phase 5\'s privacy guarantee is the absence of a DocPerm row, not a hidden route.',
    rowScope: 'none',
    portalHome: '/board',
    capabilities: ['identity.view_self', 'report.arrears_aggregate', 'report.portfolio_aggregate', 'report.trends_aggregate', 'rule.approve', 'rule.view_history'] as Capability[],
  },
  {
    key: 'platform_admin',
    title: 'Platform Admin',
    description: 'User and role administration, the kill switch, system health and integration settings. By policy: no credit decisions, no money.',
    rowScope: 'none',
    portalHome: '/admin',
    capabilities: ['admin.disable_user', 'admin.grant_roles', 'admin.manage_integrations', 'admin.manage_users', 'admin.view_system_health', 'identity.view_self', 'rule.view_history'] as Capability[],
  },
] as const;

export type PersonaKey = (typeof PERSONAS)[number]['key'];
