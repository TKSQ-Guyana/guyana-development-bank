export type LoanStatus = 'Submitted' | 'Approved' | 'Rejected';

export interface LoanApplication {
  name: string;
  applicant: string;
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

export interface ClusterMember {
  member: string | null;
  member_name: string;
  member_status: string;
  is_head: boolean;
  is_you: boolean;
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

export interface InviteResult {
  email: string;
  full_name: string;
  password: string | null;
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
