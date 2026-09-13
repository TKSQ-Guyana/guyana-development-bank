/** Thin client for the Frappe/ERPNext REST surface.
 *
 * Every call is POST /api/method/<dotted.path> with a JSON body; auth is the
 * Frappe session cookie set by /api/method/login. Frappe wraps results in
 * { message: ... } and errors in _server_messages / exception.
 */

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

export const login = (usr: string, pwd: string) => call<unknown>('login', { usr, pwd });
export const logout = () => call<unknown>('logout');

/** e-ID sign-in. The backend runs the Keycloak password grant and mints the
 *  same `sid` session `login` above does, so everything downstream — whoami,
 *  roles, permissions — is identical from here on. */
export const eidLogin = (eid: string, pwd: string) =>
  call<unknown>('gdb_bank.identity.password_login', { eid, password: pwd });

export interface ReportColumn {
  label: string;
  fieldname: string;
  fieldtype?: string;
  width?: number;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
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
  const message = (data as { message?: { columns?: ReportColumn[]; result?: unknown[] } })?.message ?? {};
  // Script reports emit the odd separator/total row as a bare array; only
  // keyed rows can be rendered against the column list.
  const rows = (message.result ?? []).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
  );
  return { columns: message.columns ?? [], rows };
}

/** Read a doctype straight off Frappe's generic REST surface.
 *
 *  Safe to call from the portal because the framework, not this client, does
 *  the filtering: gdb_bank registers `permission_query_conditions` on Loan, so
 *  the same query returns the whole book to an underwriter and only their own
 *  rows to a citizen. Reads only — every write still goes through a
 *  gdb_bank.api endpoint, where the portal's own rules live.
 */
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
