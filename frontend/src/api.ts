/** Thin client for the Frappe/ERPNext REST surface.
 *
 * Every call is POST /api/method/<dotted.path> with a JSON body; auth is the
 * Frappe session cookie set by /api/method/login. Frappe wraps results in
 * { message: ... } and errors in _server_messages / exception.
 */

import type { BankReceipt, LendingRuleProposal, LendingRuleType, ReceiptCandidate } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    if (typeof d._server_messages === 'string') {
      try {
        const messages = JSON.parse(d._server_messages) as string[];
        const first = messages[0] ? (JSON.parse(messages[0]) as { message?: string }) : null;
        if (first?.message) return first.message.replace(/<[^>]+>/g, '');
      } catch {
        /* fall through */
      }
    }
    if (typeof d.message === 'string' && d.message) return d.message;
    if (typeof d.exception === 'string' && d.exception) {
      return d.exception.split(':').slice(1).join(':').trim() || d.exception;
    }
  }
  return fallback;
}

export async function call<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/method/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, `Request failed (${res.status})`), res.status);
  }
  // Frappe omits `message` entirely when a whitelisted method returns None
  if (data && typeof data === 'object' && !('message' in data)) return null as T;
  const d = data as { message?: T };
  return (d?.message ?? (data as T)) as T;
}

export const logout = () => call<unknown>('logout');

/** Keycloak authenticates everybody, through two doors. Either way the backend
 *  runs the Keycloak password grant and mints the same Frappe `sid` session, so
 *  everything downstream — whoami, roles, permissions — is identical. Which
 *  door may open which kind of account is decided server-side
 *  (gdb_bank/security/sign_in_policy.py), never here. */

/** Citizens: national e-ID + password, against the citizen realm. */
export const eidLogin = (eid: string, pwd: string) =>
  call<unknown>('gdb_bank.identity.password_login', { eid, password: pwd });

/** GDB staff: work email + password, against the staff realm. Opens only an
 *  account the platform administrator created. A one-time password opens no
 *  session: it answers `password_change_required`, and staffSetPassword
 *  finishes the sign-in. */
export const staffLogin = (email: string, pwd: string) =>
  call<{ password_change_required?: boolean } | null>('gdb_bank.identity.staff_login', { email, password: pwd });

/** First staff sign-in: swap the one-time password for the person's own, then
 *  sign in with it. */
export const staffSetPassword = (email: string, oneTimePassword: string, newPassword: string) =>
  call<unknown>('gdb_bank.identity.staff_set_password', {
    email,
    password: oneTimePassword,
    new_password: newPassword,
  });

/** Upload one file through Frappe's OWN endpoint, attached to a document.
 *
 *  Not a gdb_bank endpoint on purpose. `File.has_permission` delegates a
 *  private file's access to the document it hangs off, so attaching here is
 *  what makes an applicant's PDF readable by that applicant and by GDB staff
 *  and by nobody else — the framework decides, and there is no second copy of
 *  that rule in the portal to drift out of step.
 *
 *  Content-Type is deliberately unset: the browser has to write the multipart
 *  boundary itself, and naming the type by hand breaks the upload.
 */
export async function uploadFile(
  file: File,
  opts: { doctype: string; docname: string },
): Promise<{ file_url: string; file_name: string }> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('doctype', opts.doctype);
  form.append('docname', opts.docname);
  form.append('is_private', '1');

  const res = await fetch('/api/method/upload_file', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    body: form,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    // A body too large for the proxy never reaches Frappe, so there is no
    // _server_messages to read — the reply is the proxy's own HTML. Say what
    // happened rather than surfacing "Upload failed (413)".
    const fallback =
      res.status === 413
        ? 'That file is too large to upload. Please attach a smaller PDF.'
        : `Upload failed (${res.status})`;
    throw new ApiError(extractErrorMessage(data, fallback), res.status);
  }
  const message = (data as { message?: { file_url?: string; file_name?: string } })?.message ?? {};
  return { file_url: message.file_url ?? '', file_name: message.file_name ?? file.name };
}

export interface ReportColumn {
  label: string;
  fieldname: string;
  fieldtype?: string;
  width?: number;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** Frappe's own total row, keyed like `rows`, when the report has Add Total
   *  Row set — query_report.run sums it server-side. Null otherwise. Display
   *  it; never add the rows up here instead. */
  total: Record<string, unknown> | null;
}

/** Run one of ERPNext's own script reports and hand back its columns and rows.
 *
 *  These are the same reports the desk renders — Trial Balance, General Ledger
 *  and the financial statements — so the portal shows exactly what the
 *  accountants see, with no second implementation of the numbers to drift.
 *  Permissions are Frappe's: a user without accounting access gets a 403 here,
 *  which is the intended answer, not a bug to route around.
 */
export async function runReport(
  reportName: string,
  filters: Record<string, unknown>,
): Promise<ReportResult> {
  const params = new URLSearchParams({
    report_name: reportName,
    filters: JSON.stringify(filters),
    ignore_prepared_report: '1',
  });
  const res = await fetch(`/api/method/frappe.desk.query_report.run?${params}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, `Could not run ${reportName} (${res.status})`), res.status);
  }
  const message =
    (data as { message?: { columns?: ReportColumn[]; result?: unknown[]; add_total_row?: boolean | number } })
      ?.message ?? {};
  const columns = message.columns ?? [];
  const result = message.result ?? [];
  // Script reports emit the odd separator/total row as a bare array; only
  // keyed rows can be rendered against the column list.
  const rows = result.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
  );
  // With Add Total Row, Frappe appends the total it computed as the LAST row,
  // a bare array aligned to the columns. Keyed back onto the column fieldnames
  // so it reads exactly like a row.
  const last = result[result.length - 1];
  const total =
    message.add_total_row && Array.isArray(last)
      ? Object.fromEntries(columns.map((c, i) => [c.fieldname, last[i]]))
      : null;
  return { columns, rows, total };
}

/** Read a doctype straight off Frappe's generic REST surface.
 *
 *  Safe to call from the portal because the framework, not this client, does
 *  the filtering: gdb_bank registers `permission_query_conditions` on Loan, so
 *  the same query returns the whole book to an underwriter and only their own
 *  rows to a citizen. Reads only — every write still goes through a
 *  gdb_bank.api endpoint, where the portal's own rules live.
 */
/** Money the bank has confirmed arrived, not yet matched to a loan. */
export const unreconciledReceipts = (bankAccount?: string) =>
  call<{ receipts: BankReceipt[]; total_unapplied: number }>(
    'gdb_bank.collections.unreconciled_receipts',
    bankAccount ? { bank_account: bankAccount } : undefined,
  );

/** Ranked loan candidates for one receipt — never applied automatically. */
export const suggestLoans = (bankTransaction: string) =>
  call<{ receipt: BankReceipt; candidates: ReceiptCandidate[] }>(
    'gdb_bank.collections.suggest_loans',
    { bank_transaction: bankTransaction },
  );

export const applyReceipt = (bankTransaction: string, loan: string, amount?: number) =>
  call<{
    repayment: string;
    repayment_type: string;
    applied: number;
    receipt_status: string;
    still_unapplied: number;
  }>('gdb_bank.collections.apply_receipt', { bank_transaction: bankTransaction, loan, amount });

export const listRuleProposals = () =>
  call<LendingRuleProposal[]>('gdb_bank.rules.list_rule_proposals');

export const proposeRuleChange = (payload: {
  rule_type: LendingRuleType;
  current_value: string;
  proposed_value: string;
  justification: string;
  effective_date: string;
}) => call<{ name: string; workflow_state: string }>('gdb_bank.rules.propose_rule_change', payload);

export const decideRuleProposal = (name: string, action: 'Approve' | 'Reject', decisionNote?: string) =>
  call<{ name: string; workflow_state: string }>('gdb_bank.rules.decide_rule_proposal', {
    name,
    action,
    decision_note: decisionNote,
  });

export async function getList<T>(
  doctype: string,
  opts: { fields: string[]; filters?: unknown; orderBy?: string; limit?: number } = { fields: ['name'] },
): Promise<T[]> {
  const params = new URLSearchParams({
    fields: JSON.stringify(opts.fields),
    limit_page_length: String(opts.limit ?? 0),
  });
  if (opts.filters) params.set('filters', JSON.stringify(opts.filters));
  if (opts.orderBy) params.set('order_by', opts.orderBy);

  const res = await fetch(`/api/resource/${encodeURIComponent(doctype)}?${params}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, `Could not load ${doctype} (${res.status})`), res.status);
  }
  return ((data as { data?: T[] })?.data ?? []) as T[];
}
