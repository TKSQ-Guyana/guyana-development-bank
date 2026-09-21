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
  underwriter_remarks: string | null;
  reviewed_by: string | null;
  reviewed_on: string | null;
  creation: string;
  modified: string;
}

/**
 * Identity moved to `shared/rbac` and is now capability-shaped rather than
 * role-shaped. Re-exported here so existing imports keep resolving during the
 * migration.
 */
export type { Identity, Identity as Whoami } from './shared/rbac';
