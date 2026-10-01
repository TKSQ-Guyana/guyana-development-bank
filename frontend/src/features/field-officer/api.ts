import { call } from '../../api';
import type { LoanApplication } from '../../types';
import type {
  ApplicantMatch,
  AssistConsent,
  AssistRequest,
  DeskPage,
  DeskTab,
  FieldTask,
  HistoryEvent,
  MyAssistConsent,
} from './types';

/** gdb_bank.field_officer — every rule is enforced there; these only name the calls. */
const M = 'gdb_bank.field_officer';

export const fo = {
  desk: (tab: DeskTab, status: string, start: number, page_length: number) =>
    call<DeskPage>(`${M}.desk`, { tab, status: status || undefined, start, page_length }),

  assistRequest: (name: string) => call<AssistRequest>(`${M}.assist_request`, { name }),
  acceptRequest: (name: string) => call<AssistRequest>(`${M}.accept_assist_request`, { name }),
  logCall: (name: string, result: string, note: string) =>
    call<AssistRequest>(`${M}.log_contact_attempt`, { name, result, note }),
  setOutcome: (name: string, outcome: string, note: string) =>
    call<AssistRequest>(`${M}.set_assist_outcome`, { name, outcome, note }),

  findApplicant: (eid: string) => call<ApplicantMatch>(`${M}.find_applicant`, { eid }),
  askConsent: (args: { eid?: string; request?: string }) => call<AssistConsent>(`${M}.request_assist_consent`, args),
  consent: (name: string) => call<AssistConsent>(`${M}.assist_consent`, { name }),
  endConsent: (name: string) => call<unknown>(`${M}.end_assist_consent`, { name }),
  handOff: (consent: string, name: string) =>
    call<{ application: string; handed_off_on: string }>(`${M}.hand_off_application`, { consent, name }),
  myConsents: () => call<MyAssistConsent[]>(`${M}.my_assist_consents`),
  respond: (name: string, accept: boolean) =>
    call<MyAssistConsent[]>(`${M}.respond_to_assist_consent`, { name, accept: accept ? 1 : 0 }),

  requestTask: (args: { application: string; kind: string; instructions: string; due_date?: string; address?: string }) =>
    call<FieldTask>(`${M}.request_field_task`, args),
  cancelTask: (name: string, reason: string) => call<FieldTask>(`${M}.cancel_field_task`, { name, reason }),
  tasksFor: (application: string) => call<FieldTask[]>(`${M}.field_tasks_for`, { application }),
  task: (name: string) => call<FieldTask>(`${M}.field_task`, { name }),
  acceptTask: (name: string) => call<FieldTask>(`${M}.accept_field_task`, { name }),
  saveReport: (name: string, report: object) => call<FieldTask>(`${M}.save_field_report`, { name, report }),
  submitReport: (name: string, report: object) => call<FieldTask>(`${M}.submit_field_report`, { name, report }),
  removePhoto: (name: string, file: string) => call<FieldTask>(`${M}.remove_field_photo`, { name, file }),

  caseView: (application: string) =>
    call<{ case: LoanApplication; history: HistoryEvent[]; tasks: FieldTask[] }>(`${M}.case_view`, { application }),
};
