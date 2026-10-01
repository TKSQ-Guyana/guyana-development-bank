/** Field operations — the shapes gdb_bank.field_officer answers with. */

export type DeskTab = 'assist' | 'assisted' | 'tasks';

export interface DeskRow {
  name: string;
  who: string | null;
  eid?: string | null;
  what: string;
  region: string | null;
  status: string;
  on: string | null;
  due?: string | null;
  mine: boolean;
}

export interface DeskPage {
  region: string | null;
  rows: DeskRow[];
  total: number;
  counts: Record<DeskTab, number>;
  statuses: Record<string, number>;
}

export interface ContactAttempt {
  attempted_on: string;
  contact_name?: string | null;
  phone?: string | null;
  relationship?: string | null;
  result: CallResult;
  verdict?: Verdict | '' | null;
  note?: string | null;
}

export type CallResult = 'Reached' | 'No answer' | 'Wrong number' | 'Call back';
export type Verdict = 'Positive' | 'Neutral' | 'Negative';
export const CALL_RESULTS: CallResult[] = ['Reached', 'No answer', 'Wrong number', 'Call back'];
export const VERDICTS: Verdict[] = ['Positive', 'Neutral', 'Negative'];
export const OUTCOMES = ['Helped remotely', 'Visit booked', 'Application started', "Couldn't reach", 'Closed'] as const;

export interface AssistRequest {
  name: string;
  applicant_name: string;
  phone: string | null;
  business_type: string;
  product: string | null;
  region: string;
  best_time: string | null;
  status: string;
  requested_on: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  accepted_on: string | null;
  outcome_note: string | null;
  closed_on: string | null;
  mine: boolean;
  attempts: ContactAttempt[];
  consent: { name: string; status: string } | null;
}

export interface ApplicantMatch {
  eid: string;
  registered: boolean;
  masked_name: string | null;
  is_you: boolean;
}

export interface AssistConsent {
  name: string;
  status: 'Pending' | 'Granted' | 'Declined' | 'Ended';
  applicant_eid: string | null;
  masked_name: string | null;
  /** Only while the applicant's consent holds. */
  applicant_name: string | null;
  request: string | null;
  application: string | null;
  requested_on: string;
  responded_on: string | null;
  expires_on: string | null;
  ended_on: string | null;
  end_reason: string | null;
  drafts: { name: string; loan_amount: number; purpose: string | null; modified: string; handed_off_on: string | null }[];
  open_requests: { name: string; application: string; item: string; document_type: string | null; requested_on: string }[];
}

/** The citizen's side of a consent. */
export interface MyAssistConsent {
  name: string;
  officer_name: string | null;
  status: 'Pending' | 'Granted';
  requested_on: string;
  expires_on: string | null;
}

export interface VisitCheck {
  item: string;
  result: '' | 'Yes' | 'No' | 'N/A' | null;
  note: string | null;
}

export interface FieldTask {
  name: string;
  application: string;
  applicant_name: string | null;
  applicant_eid: string | null;
  kind: 'Site Visit' | 'Reference Check';
  status: 'Open' | 'Accepted' | 'Submitted' | 'Cancelled';
  region: string | null;
  due_date: string | null;
  instructions: string;
  address: string | null;
  requested_by: string;
  requested_by_name: string | null;
  requested_on: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  accepted_on: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  visited_on: string | null;
  findings: string | null;
  submitted_on: string | null;
  cancelled_on: string | null;
  cancel_reason: string | null;
  checks: VisitCheck[];
  reference_calls: ContactAttempt[];
  photos: { name: string; file_url: string; file_name: string }[];
  /** Officer's view only. */
  mine?: boolean;
  phone?: string | null;
}

export interface HistoryEvent {
  on: string;
  what: string;
  who: string | null;
}
