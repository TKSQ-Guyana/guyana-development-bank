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

export interface Whoami {
  user: string;
  full_name: string;
  roles: string[];
  is_underwriter: boolean;
}
