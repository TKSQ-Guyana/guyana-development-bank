/** `Draft` is the applicant's own workspace — saved, evidence attached, not yet
 *  before the Bank. Staff queues never show it. */
export type LoanStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected';

/** Where the case is on the journey the applicant actually walks. Derived
 *  SERVER-SIDE in api._stage_for, because everything past the credit decision
 *  lives in other records — the offer, the conditions, the booked loan — and a
 *  client that reassembled the ladder itself would be a second opinion about
 *  what stage somebody's loan is at. Render it; never compute it. */
export type LoanStage = 'Draft' | 'Review' | 'Approved' | 'Signing' | 'Disbursed' | 'Rejected';

/** The five-step ladder, in order, as the applicant's tracker draws it.
 *  `Rejected` is deliberately absent: a declined case leaves the ladder rather
 *  than sitting at a step on it. */
export const LOAN_STAGES: LoanStage[] = ['Draft', 'Review', 'Approved', 'Signing', 'Disbursed'];

/** One line of the funding step's use-of-funds table. Sent JSON-encoded as
 *  `sections.use_of_funds`; the server stores each line as a row of the
 *  GDB Use Of Funds Line child table and answers them back as `use_of_funds`,
 *  with Frappe's SUM of them as `use_of_funds_total`. */
export interface UseOfFundsRow {
  item: string;
  amount: number;
}

/** One declared co-owner of the business a loan is for: a partner in a
 *  partnership, a shareholder in an incorporated company. DECLARED — naming
 *  somebody here records what the applicant said, not that person's agreement,
 *  which they give through their own sign-in. */
export interface OwnershipRow {
  eid: string;
  name: string;
  share: number;
}

export interface LoanApplication {
  name: string;
  /** Which product the case is filed on. A Quick Loan is applied for on its own
   *  form, has no Letter of Offer, and is decided and paid by a Disbursement
   *  Officer in one act (gdb_bank.api.decide_quick_loan). */
  product: 'standard' | 'quick';
  /** When a Quick Loan's borrower accepted its terms, at submission. */
  terms_accepted_on: string | null;
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
  /** 'Existing' or 'New' — which half of Sections G/H applies, and which
   *  evidence documents.required_types expects. */
  business_stage: string | null;
  /** The business this case is filed for. Already served by _portal_dict
   *  (`gdb_business_name`) — added here so a list row can identify the case
   *  by this or `cluster` instead of the free-text `purpose`, which has no
   *  length limit and nothing stops it holding a whole pasted business plan. */
  business_name: string | null;
  /** The DCRA registration this case was filed against, where there is one.
   *  Served by `_portal_dict` and needed when a draft is resumed from the
   *  server — without it the wizard reopens with the registration blank. */
  dcra_number: string | null;
  /** The journey stage and the customer-safe sentence that goes with it, both
   *  from the server. `stage_label` is what the applicant reads — never a raw
   *  status value. */
  stage: LoanStage;
  stage_label: string;
  /** Set once a Letter of Offer exists on this case. */
  offer_status: 'Draft' | 'Issued' | 'Accepted' | 'Declined' | 'Expired' | 'Withdrawn' | null;
  /** Required conditions precedent still Outstanding. Funds cannot be released
   *  while this is above zero — the server enforces that, this only shows it. */
  conditions_outstanding: number;
  /** The booked lending Loan, once the case has one. */
  loan: string | null;
  /** lending's own status on that Loan (Sanctioned, Partially Disbursed, …). */
  loan_status: string | null;
  disbursed_amount: number;
  /** `loan_amount` / `term_months` are what was REQUESTED. These followed:
   *  approved_* — the live Letter of Offer, the underwriter's decision;
   *  sanctioned_amount — the booked Loan, as lending holds it;
   *  facility_* — whichever of those stands now. All from the server. */
  approved_amount: number | null;
  approved_term: number | null;
  sanctioned_amount: number | null;
  facility_amount: number;
  facility_term: number;
  /** False only for a Loan booked on the requested amount instead of the
   *  executed offer — release is refused until it is rebooked. */
  booked_on_offer: boolean | null;
  /** What lending says is still drawable, for a loan awaiting release. Present
   *  only on all_loans rows. */
  drawable?: number | null;
  rate_of_interest: number | null;
  /** The instalment as lending states it at this stage of the case: the
   *  repayment schedule once money has moved, else the booked Loan's, else the
   *  offer's, else the application's indicative figure. Never computed here. */
  monthly_repayment: number | null;
  /** Sections B-H of the application — the business narrative, keyed without
   *  the gdb_ prefix the doctype uses. Whitelisted server-side against
   *  install.APPLICATION_SECTIONS, so an unknown key is dropped, never
   *  written. */
  sections: Record<string, string | number | null>;
  /** Section C's use-of-funds lines, as the child-table rows Frappe holds. */
  use_of_funds: UseOfFundsRow[];
  /** Frappe's SUM of those lines; null when there are none. Never add the
   *  lines up in the client. */
  use_of_funds_total: number | null;
  /** Everybody who owns a share of the business besides the applicant, and the
   *  applicant's own share. Empty and null respectively for a sole trader, who
   *  owns all of it, and for a cluster, which is not owned in shares. */
  ownership_lines: OwnershipRow[];
  applicant_share: number | null;
  /** Expected document types not yet on file, for a queue row. Batched
   *  server-side (see api._evidence_missing_map) — present only from
   *  all_loans; the case page reads the live shelf via DocumentShelf instead. */
  evidence_missing?: string[];
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
  /** Per type — a Trading Photo takes photographs, not only PDFs. */
  accepts_by_type?: Record<string, string>;
  max_bytes: number;
}

export interface DocumentShelf {
  documents: ApplicantDocument[];
  /** Required document types not yet on file. Empty means submittable — the
   *  server says so, the form never works it out. */
  missing: string[];
  /** This reader's own shelf, so they may add to it. The server decides. */
  can_upload: boolean;
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

/** A person's own finances, declared on their profile. Money is G$ per month. */
export interface DeclaredFinancials {
  employment_status: string | null;
  monthly_income: number | null;
  other_monthly_income: number | null;
  monthly_expenses: number | null;
  monthly_loan_repayments: number | null;
  total_debts: number | null;
  savings: number | null;
  dependents: number | null;
  /** Set once they have been saved — the member's step is done. */
  financials_updated_on: string | null;
}

export interface MemberProfileSummary extends DeclaredFinancials {
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
export interface CitizenProfile extends DeclaredFinancials {
  name: string;
  user: string;
  eid: string | null;
  full_name: string | null;
  updated_on: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  /** Declared by the applicant on the Quick Loan's About you step. */
  national_id: string | null;
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
  consent_version: string | null;
  consent_accepted_on: string | null;
}

export interface ClusterCase {
  name: string;
  applicant_name: string;
  status: LoanStatus;
  shared: boolean;
  private: boolean;
  loan_amount?: number;
  term_months?: number;
  facility_amount?: number;
  facility_term?: number;
  purpose?: string;
  monthly_repayment?: number;
}

/** The seven questions the shared plan asks. Keyed to match the backend's
 *  PLAN_SECTIONS exactly, so the two cannot drift. */
export interface ClusterPlan {
  plan_executive_summary: string | null;
  plan_how_formed: string | null;
  plan_governance: string | null;
  plan_market: string | null;
  plan_shared_project: string | null;
  plan_operations: string | null;
  plan_impact: string | null;
}

export type ClusterPlanSection = keyof ClusterPlan;

export interface Cluster {
  name: string;
  region: string | null;
  sector: string | null;
  loan_purpose: string | null;
  /** The single free-text plan this portal wrote before the plan was
   *  sectioned. Still shown where it holds anything. */
  business_plan: string | null;
  group_purpose: string | null;
  locality: string | null;
  is_registered: string | null;
  /** Null while the facilitator's e-ID has no portal account yet — the e-ID
   *  below still names them, exactly as an invitation does for a member. */
  facilitator: string | null;
  facilitator_eid: string | null;
  facilitator_name: string | null;
  facilitator_requested: boolean;
  plan: ClusterPlan;
  head: string;
  is_head: boolean;
  is_facilitator: boolean;
  /** The head or the attached facilitator. Mirrors the server's own rule;
   *  the server enforces it either way. */
  can_edit_plan: boolean;
  viewer: string;
  members: ClusterMember[];
  /** Members who have ACCEPTED, and invitations still unanswered — neither
   *  counting the head. The difference is not cosmetic: only an accepted
   *  member can see the group's application, and only an accepted member is
   *  given a signature line when its offer is issued. Counted on the server so
   *  the portal and the rules that act on it read the same number. */
  joined_count: number;
  invited_count: number;
  applications: ClusterCase[];
}

/** One party's line on a cluster's Letter of Offer. */
export interface OfferSignature {
  name: string;
  member: string | null;
  member_eid: string | null;
  member_name: string;
  is_head: boolean;
  signature_status: 'Pending' | 'Signed' | 'Declined';
  signed_name: string | null;
  signed_on: string | null;
}

/** Absent on an individual offer, which is accepted rather than signed. */
export interface OfferExecution {
  joint: boolean;
  signed: number;
  total: number;
  outstanding: string[];
  declined?: string[];
  complete: boolean | null;
}

/** A GDB facilitator a group may ask for. `placeholder` is true while the
 *  roster is a stand-in rather than GDB's appointed officers. */
export interface Facilitator {
  eid: string;
  full_name: string;
  region: string;
  placeholder?: boolean;
}

/** What `lookup_eid` answers: a name only for an e-ID that already holds a
 *  portal account, and nothing else about that person. */
export interface EidLookup {
  eid: string;
  registered: boolean;
  name: string | null;
  is_you?: boolean;
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

/** One payment received against a facility. On a cluster's loan several
 *  members pay into the same account, so the payer is part of the record. */
export interface LoanPayment {
  name: string;
  posting_date: string;
  amount_paid: number;
  principal_amount_paid: number;
  repayment_type: string;
  /** Null for a receipt applied by the Bank from Collections rather than paid
   *  through the portal. */
  paid_by_name: string | null;
  paid_by_eid: string | null;
}

export interface LoanAccount {
  application: string;
  loan: BookedLoan | null;
  schedule: ScheduleRow[];
  /** Optional so an older cached payload still type-checks. */
  payments?: LoanPayment[];
  /** The group this facility belongs to, or null for a sole borrower's loan. */
  cluster?: string | null;
  dues?: LoanDues;
  /** What lending says is still drawable. Server-side only for underwriters;
   *  null for everyone else. Never derive this on the client. */
  disbursable?: number | null;
  /** The instalment lending bills: the current repayment schedule's, else the
   *  booked Loan's. `loan.monthly_repayment_amount` is only the figure at
   *  booking and goes stale once a smaller amount is released. */
  instalment?: number | null;
  /** The executed offer's terms, and whether lending was booked on them. */
  approved_amount?: number | null;
  approved_term?: number | null;
  booked_on_offer?: boolean | null;
  /** Present when loan_account was asked for a period (from_date/to_date). */
  statement?: LoanStatement | null;
}

/** One line of lending's Loan Statement of Account, exactly as the report
 *  gives it: a disbursement or a payment, and lending's running balance after
 *  it. */
export interface StatementLine {
  posting_date: string;
  transaction_type: string;
  transaction_doctype: string;
  transaction_name: string;
  debit: number;
  credit: number;
  balance: number;
  remarks: string | null;
}

/** A statement period, every figure lending's. What happened is its Loan
 *  Statement of Account cut to the period: the balance before it, every line
 *  in it, the balance after it. What was planned is kept apart: the schedule
 *  rows falling due in the period and their sum. */
export interface LoanStatement {
  from_date: string;
  to_date: string;
  transactions: StatementLine[];
  opening_balance: number;
  closing_balance: number;
  rows: ScheduleRow[];
  instalments_due: number;
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
  /** Runs the platform — accounts, roles, the kill switch, health and
   *  integration settings — and sees no case, decides no credit and moves no
   *  money. The server refuses this role at every credit and money endpoint. */
  is_platform_admin: boolean;
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
  /** lending's get_monthly_repayment_amount on the offered terms. */
  monthly_instalment: number;
  /** The principal on an interest-free offer; null with a rate, where the
   *  total is what lending's schedule accrues once disbursed. */
  total_repayable: number | null;
  first_repayment_date: string | null;
  conditions: string[];
  agreement_text: string | null;
  issued_by: string | null;
  issued_on: string | null;
  accepted_name: string | null;
  responded_on: string | null;
  decline_reason: string | null;
  can_accept: boolean;
  signatures: OfferSignature[];
  execution: OfferExecution;
  /** This viewer has an unsigned line on a cluster offer. */
  can_sign: boolean;
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
  /** Whether the signed-in citizen's e-ID is among this business's proprietors.
   *  null when GDB has no e-ID on file to check against; absent on results
   *  that came from the citizen's own proprietor list (my_businesses), where
   *  ownership is already the reason the record appears at all. */
  owned_by_caller?: boolean | null;
}
