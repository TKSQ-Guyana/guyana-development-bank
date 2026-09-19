/** `Draft` is the applicant's own workspace — saved, evidence attached, not yet
 *  before the Bank. Staff queues never show it. */
export type LoanStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected';

export interface LoanApplication {
  name: string;
  applicant: string;
  /** The applicant's national e-ID. This, not the mailbox in `applicant`, is
   *  how GDB staff identify a person — so every staff-facing view shows it. */
  applicant_eid: string | null;
  applicant_name: string;
  loan_amount: number;
  purpose: string;
  term_months: number;
  monthly_income: number;
  phone: string | null;
  status: LoanStatus;
  cluster: string | null;
  underwriter_remarks: string | null;
  reviewed_by: string | null;
  reviewed_on: string | null;
  creation: string;
  modified: string;
}

/** One piece of evidence on the shelf. The file itself is private and is
 *  reached through `file_url`, which Frappe serves only to someone allowed to
 *  read this row. */
export interface ApplicantDocument {
  name: string;
  applicant: string;
  applicant_name: string | null;
  /** Null for a personal document (identity, proof of address) held against
   *  the person rather than against one case. */
  application: string | null;
  document_type: string;
  status: 'Received' | 'Accepted' | 'Rejected' | 'Replaced';
  request: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  uploaded_on: string | null;
  reviewed_by: string | null;
  reviewed_on: string | null;
  review_note: string | null;
  superseded_by: string | null;
  creation: string;
}

export interface DocumentSettings {
  types: string[];
  personal_types: string[];
  accepts: string;
  max_bytes: number;
}

export interface DocumentShelf {
  documents: ApplicantDocument[];
  /** Required document types not yet on file. Empty means submittable — the
   *  server says so, the form never works it out. */
  missing: string[];
  settings: DocumentSettings;
}

/** Something the Bank has asked this applicant for, itemised so both sides can
 *  say exactly what the case is waiting on. */
export interface InformationRequest {
  name: string;
  application: string;
  applicant: string;
  status: 'Open' | 'Satisfied' | 'Withdrawn';
  document_type: string | null;
  item: string;
  requested_by: string | null;
  requested_on: string | null;
  satisfied_by: string | null;
  responded_on: string | null;
}

export interface MemberProfileSummary {
  user: string;
  phone: string | null;
  region: string | null;
  village_or_town: string | null;
  occupation: string | null;
  verified_phone: string | null;
}

export interface ClusterMember {
  /** Null while an invitation is outstanding against an e-ID that has not
   *  signed in yet — the invitation names a person, not an account. */
  member: string | null;
  member_eid: string | null;
  member_name: string;
  member_status: 'Invited' | 'Active' | 'Declined' | 'Exited';
  is_head: boolean;
  is_you: boolean;
  invited_on: string | null;
  joined_on: string | null;
  /** Staff only. Members never see each other's details. */
  profile: MemberProfileSummary | null;
}

/** A cluster this person has been asked to join and has not yet answered. */
export interface ClusterInvitation {
  name: string;
  cluster_name: string;
  region: string | null;
  sector: string | null;
  head: string;
  head_name: string;
  invited_on: string | null;
}

/** The applicant's own details, in two blocks that are never merged: what the
 *  e-ID directory asserted, and what they declared themselves. */
export interface CitizenProfile {
  name: string;
  user: string;
  eid: string | null;
  full_name: string | null;
  updated_on: string | null;
  phone: string | null;
  date_of_birth: string | null;
  occupation: string | null;
  region: string | null;
  village_or_town: string | null;
  address: string | null;
  next_of_kin: string | null;
  next_of_kin_phone: string | null;
  verified_full_name: string | null;
  verified_email: string | null;
  verified_phone: string | null;
  verified_birth_date: string | null;
  verified_address: string | null;
  identity_source: string | null;
  verified_on: string | null;
}

export interface ClusterCase {
  name: string;
  applicant_name: string;
  status: LoanStatus;
  shared: boolean;
  private: boolean;
  loan_amount?: number;
  term_months?: number;
  purpose?: string;
  monthly_repayment?: number;
}

export interface Cluster {
  name: string;
  region: string | null;
  sector: string | null;
  loan_purpose: string | null;
  business_plan: string | null;
  head: string;
  is_head: boolean;
  viewer: string;
  members: ClusterMember[];
  applications: ClusterCase[];
}

export interface ScheduleRow {
  payment_date: string;
  principal_amount: number;
  interest_amount: number;
  total_payment: number;
  balance_loan_amount: number;
}

/** Straight from lending.api.get_due_details — never computed in the portal. */
export interface LoanDues {
  overdue_principal_amount?: number;
  overdue_interest_amount?: number;
  overdue_charges?: number;
  overdue_total_amount?: number;
  principal_outstanding?: number;
  oldest_due_date?: string | null;
  unbooked_interest?: number;
  excess_amount_paid?: number;
}

export interface BookedLoan {
  name: string;
  status: string;
  loan_amount: number;
  disbursed_amount: number;
  total_payment: number;
  total_amount_paid: number;
  total_principal_paid: number;
  monthly_repayment_amount: number;
  rate_of_interest: number;
  repayment_periods: number;
}

/** A Loan row as it comes off Frappe's generic REST surface, for the
 *  disbursement queue. Deliberately a different shape from BookedLoan: this is
 *  the raw doctype, not the portal contract. */
export interface LoanRow {
  name: string;
  applicant_name: string | null;
  loan_application: string | null;
  loan_amount: number;
  disbursed_amount: number;
  status: string;
  posting_date: string | null;
}

export interface LoanAccount {
  application: string;
  loan: BookedLoan | null;
  schedule: ScheduleRow[];
  dues?: LoanDues;
  /** What lending says is still drawable. Server-side only for underwriters;
   *  null for everyone else. Never derive this on the client. */
  disbursable?: number | null;
}

export interface Whoami {
  user: string;
  full_name: string;
  /** The e-ID this login is bound to, when they signed in that way. Null for
   *  an email/password session — the portal keeps both doors open. */
  eid: string | null;
  roles: string[];
  is_underwriter: boolean;
  /** The books: the ledger, portfolio reporting, reconciling receipts, and
   *  proposing (never deciding its own) lending-rule changes. Deliberately
   *  separate from `is_underwriter` and from `is_disbursement` — the officer
   *  who decides a loan is not the officer who pays it, and neither is the
   *  officer who keeps the books. */
  is_finance: boolean;
  /** Release authority: disburse_loan, the payment file. Split out of
   *  is_finance — see api.DISBURSEMENT_ROLES. */
  is_disbursement: boolean;
}

/** One row off ERPNext's Bank Transaction — money the bank has confirmed
 *  arrived, not yet matched to a loan. Straight off
 *  gdb_bank.collections.unreconciled_receipts / .suggest_loans. */
export interface BankReceipt {
  name: string;
  date: string;
  deposit: number;
  withdrawal: number;
  allocated_amount: number;
  unallocated_amount: number;
  description: string | null;
  reference_number: string | null;
  party_type: string | null;
  party: string | null;
  bank_account: string | null;
  status: string;
}

export interface ReceiptCandidate {
  loan: string;
  application: string | null;
  borrower: string | null;
  outstanding: number;
  instalment: number;
  rank: number;
  /** Why this loan ranked where it did, in the words an officer would use —
   *  never applied automatically, so this is what a human reads before
   *  deciding. */
  why: string[];
}

export type LendingRuleType =
  | 'Interest Rate'
  | 'Maximum Loan Amount'
  | 'Minimum Loan Amount'
  | 'Loan Term Limits'
  | 'Required Documents'
  | 'Standard Conditions'
  | 'Capacity Calculation'
  | 'Charges';

export type RuleProposalState = 'Draft' | 'Pending' | 'Approved' | 'Rejected';

/** A GDB Lending Rule Proposal — Finance proposes, another Finance officer
 *  decides. See gdb_lending_rule_proposal.py: the same person can never do
 *  both, whatever role they hold. */
export interface LendingRuleProposal {
  name: string;
  rule_type: LendingRuleType;
  effective_date: string;
  workflow_state: RuleProposalState;
  current_value: string;
  proposed_value: string;
  justification: string;
  proposed_by: string;
  proposed_on: string;
  decided_by: string | null;
  decided_on: string | null;
  decision_note: string | null;
  docstatus: 0 | 1 | 2;
  creation: string;
}

/** A Letter of Offer. Once accepted, this is the executed loan agreement —
 *  `agreement_text` is the wording frozen server-side at issue. */
export interface LoanOffer {
  name: string;
  application: string;
  applicant_name: string;
  business_name: string | null;
  status: 'Draft' | 'Issued' | 'Accepted' | 'Declined' | 'Expired' | 'Withdrawn';
  valid_until: string;
  loan_product: string;
  offered_amount: number;
  term_months: number;
  rate_of_interest: number;
  monthly_instalment: number;
  total_repayable: number;
  first_repayment_date: string | null;
  conditions: string[];
  agreement_text: string | null;
  issued_by: string | null;
  issued_on: string | null;
  accepted_name: string | null;
  responded_on: string | null;
  decline_reason: string | null;
  can_accept: boolean;
}

/** What DCRA said about a registration number. `source` is load-bearing:
 *  only "dcra" is evidence — "sandbox" and "gdb_history" are conveniences. */
/** One account the national payment switch says the applicant holds.
 *  `source` is the whole point: `sandbox` is never evidence, and
 *  `unavailable` means GDB could not tell — not that the account is bad. */
export interface BankAccountRecord {
  bank: string;
  account_number: string;
  account_name: string | null;
  branch_code?: string;
  account_type?: string;
  status?: 'Active' | 'Dormant' | 'Closed' | 'Not Found' | 'Unavailable';
  name_match?: boolean | null;
  result?: 'Verified' | 'Name Mismatch' | 'Inactive Account' | 'Not Found' | 'Unavailable';
  source: 'bank_registry' | 'sandbox' | 'unavailable';
}

export interface DcraRecord {
  registration_number: string;
  business_name: string | null;
  business_type?: string;
  status?: string;
  registered_on?: string;
  region?: string;
  proprietors?: string[];
  source: 'dcra' | 'sandbox' | 'gdb_history' | 'unavailable';
}
