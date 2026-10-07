/** Thin client for the Frappe/ERPNext REST surface.
 *
 * Every call is POST /api/method/<dotted.path> with a JSON body; auth is the
 * Frappe session cookie set by /api/method/login. Frappe wraps results in
 * { message: ... } and errors in _server_messages / exception.
 */

import type {
  BankReceipt,
  LendingRuleProposal,
  LendingRuleType,
  ReceiptCandidate,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (typeof d._server_messages === "string") {
      try {
        const messages = JSON.parse(d._server_messages) as string[];
        const first = messages[0]
          ? (JSON.parse(messages[0]) as { message?: string })
          : null;
        if (first?.message) return first.message.replace(/<[^>]+>/g, "");
      } catch {
        /* fall through */
      }
    }
    if (typeof d.message === "string" && d.message) return d.message;
    if (typeof d.exception === "string" && d.exception) {
      return d.exception.split(":").slice(1).join(":").trim() || d.exception;
    }
  }
  return fallback;
}

export const WHOAMI = "gdb_bank.api.whoami";

/** Fired on the window when the server refuses a call. The session cookie is
 *  shared by every tab, so a refusal may mean this tab's idea of who is signed
 *  in has gone stale; the auth provider listens and re-reads it (auth.tsx). */
export const SESSION_CHECK = "gdb:session-check";

/** The applicant's own endpoints that a Field Officer may call FOR an
 *  applicant, under that applicant's consent (backend security/assist.py).
 *  Every one of them accepts `acting`; nothing else is sent it, because an
 *  endpoint that ignored it would quietly act on the officer's own account. */
const ACTING_METHODS = new Set([
  "gdb_bank.api.loan_detail",
  "gdb_bank.api.save_application",
  "gdb_bank.api.my_bank_details",
  "gdb_bank.api.save_bank_details",
  "gdb_bank.api.my_bank_accounts",
  "gdb_bank.api.verify_bank_account",
  "gdb_bank.api.dcra_lookup",
  "gdb_bank.api.my_businesses",
  "gdb_bank.profiles.my_profile",
  "gdb_bank.profiles.record_consent",
  "gdb_bank.profiles.save_profile",
  "gdb_bank.profiles.pending_applications",
  "gdb_bank.profiles.pending_application",
  "gdb_bank.profiles.save_pending_application",
  "gdb_bank.documents.list_documents",
  "gdb_bank.documents.new_document",
  "gdb_bank.documents.confirm_document",
  "gdb_bank.documents.delete_document",
  "gdb_bank.documents.list_requests",
]);

// ponytail: one module-level consent rather than a prop threaded through the
// wizard and every shelf component it renders. Set only by the assisted-mode
// page (features/field-officer/AssistedApply), which clears it on unmount.
let acting: string | null = null;

/** Act for the applicant who granted `consent`, or stop (null). */
export function setActing(consent: string | null) {
  acting = consent;
}

export async function call<T>(
  method: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const body =
    acting && ACTING_METHODS.has(method) ? { ...args, acting } : args;
  const res = await fetch(`/api/method/${method}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && method !== WHOAMI) {
      window.dispatchEvent(new Event(SESSION_CHECK));
    }
    throw new ApiError(
      extractErrorMessage(data, `Request failed (${res.status})`),
      res.status,
    );
  }
  // Frappe omits `message` entirely when a whitelisted method returns None
  if (data && typeof data === "object" && !("message" in data))
    return null as T;
  const d = data as { message?: T };
  return (d?.message ?? (data as T)) as T;
}

export const logout = () => call<unknown>("logout");

/** Keycloak authenticates everybody, through two doors. Either way the backend
 *  runs the Keycloak password grant and mints the same Frappe `sid` session, so
 *  everything downstream — whoami, roles, permissions — is identical. Which
 *  door may open which kind of account is decided server-side
 *  (gdb_bank/security/sign_in_policy.py), never here. */

/** Citizens: national e-ID + password, against the citizen realm. */
export const eidLogin = (eid: string, pwd: string) =>
  call<unknown>("gdb_bank.identity.password_login", { eid, password: pwd });

/** A one-time code challenge: what the code screen needs to say. The code
 *  itself never comes back — `static_code` says it is the fixed demo code. */
export interface OtpChallenge {
  challenge: string;
  /** The phone it was "sent" to, masked: "•••• 7788". */
  phone: string;
  expires_in: number;
  static_code: boolean;
  /** The fixed code to use, while codes are not sent (static_code). */
  demo_code?: string;
}

/** An online sign-up, as the form holds it. The document travels as base64
 *  with the final call, so nothing is stored until the code is right. */
export interface TinSignupForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  /** The National ID number the KYC register knows them by — the account's
   *  sign-in name. */
  national_id: string;
  /** Their GRA TIN. Optional. */
  tin: string;
  password: string;
  confirm_password: string;
  document_kind: string;
  /** The number printed on that document, for the officer to cross-check. */
  document_number: string;
  /** YYYY-MM-DD. At least 18 (tin_auth.MIN_AGE). */
  date_of_birth: string;
  /** 1 when the code goes to the phone on the KYC register, which the person
   *  confirmed is theirs — `phone` is then left empty: the form never had it. */
  use_registry_phone?: 0 | 1;
  /** The pass from the face check, where one applies (gdb_bank.face_check). */
  face_token?: string;
}

/** Whether this National ID needs a face check before its code, and the prompts. */
export interface FaceCheckStart {
  required: boolean;
  check?: string;
  /** "center", then "left" and "right" in a random order. */
  steps?: string[];
  attempts_left?: number;
}

export interface FaceCheckResult {
  passed: boolean;
  face_token?: string;
  messages?: string[];
  attempts_left?: number;
  give_up?: string | null;
}

export const startFaceCheck = (nationalId: string) =>
  call<FaceCheckStart>("gdb_bank.tin_auth.start_face_check", {
    national_id: nationalId,
  });

export const submitFaceCheck = (
  check: string,
  frames: { step: string; image: string }[],
) =>
  call<FaceCheckResult>("gdb_bank.tin_auth.submit_face_check", {
    check,
    frames,
  });

/** What the KYC register holds for a National ID (tin_auth.lookup_national_id). */
export interface KycMatch {
  found: boolean;
  has_account?: boolean;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  region?: string | null;
  village?: string | null;
  has_phone?: boolean;
  /** The phone on record, last four digits only: "•••-5532". */
  phone_masked?: string;
  /** False when this person is on the register with no photo to verify their
   *  face against: they finish at a branch, not online. */
  online_signup?: boolean;
  message?: string;
}

/** Fill sign-up from the KYC register. Writes nothing. */
export const lookupNationalId = (nationalId: string) =>
  call<KycMatch>("gdb_bank.tin_auth.lookup_national_id", {
    national_id: nationalId,
  });

/** Sign-up, step one: check the form and send the code. Creates nothing. */
export const requestSignupOtp = (form: TinSignupForm) =>
  call<OtpChallenge>("gdb_bank.tin_auth.request_signup_otp", { ...form });

/** Sign-up, step two: the code, then the account — and a signed-in session. */
export const completeSignup = (
  form: TinSignupForm,
  challenge: string,
  otp: string,
  // No identity document is asked at sign-up any more; kept for callers that
  // still have one to send.
  document?: { name: string; data: string },
) =>
  call<unknown>("gdb_bank.tin_auth.complete_signup", {
    ...form,
    challenge,
    otp,
    document_name: document?.name,
    document_data: document?.data,
  });

/** National ID sign-in, step one: National ID + password. Right ones answer a
 *  code challenge; no session exists yet. */
export const nationalIdLogin = (nationalId: string, password: string) =>
  call<OtpChallenge & { otp_required: true }>(
    "gdb_bank.tin_auth.national_id_login",
    { national_id: nationalId, password },
  );

/** National ID sign-in, step two: the code, then the session. */
export const verifyLoginOtp = (challenge: string, otp: string) =>
  call<unknown>("gdb_bank.tin_auth.verify_login_otp", { challenge, otp });

/** Forgot password, step one: a code to the phone on the account. */
export const requestPasswordReset = (nationalId: string) =>
  call<OtpChallenge>("gdb_bank.tin_auth.request_password_reset", {
    national_id: nationalId,
  });

/** Forgot password, step two: the code and the new password. Signs nobody in. */
export const resetPassword = (
  challenge: string,
  otp: string,
  password: string,
  confirmPassword: string,
) =>
  call<{ reset: boolean; national_id: string }>(
    "gdb_bank.tin_auth.reset_password",
    { challenge, otp, password, confirm_password: confirmPassword },
  );

/** GDB staff: work email + password, against the staff realm. Opens only an
 *  account the platform administrator created. A one-time password opens no
 *  session: it answers `password_change_required`, and staffSetPassword
 *  finishes the sign-in. */
export const staffLogin = (email: string, pwd: string) =>
  call<{ password_change_required?: boolean } | null>(
    "gdb_bank.identity.staff_login",
    { email, password: pwd },
  );

/** First staff sign-in: swap the one-time password for the person's own, then
 *  sign in with it. */
export const staffSetPassword = (
  email: string,
  oneTimePassword: string,
  newPassword: string,
) =>
  call<unknown>("gdb_bank.identity.staff_set_password", {
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
  form.append("file", file, file.name);
  form.append("doctype", opts.doctype);
  form.append("docname", opts.docname);
  form.append("is_private", "1");

  const res = await fetch("/api/method/upload_file", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
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
        ? "That file is too large to upload. Please attach a smaller PDF."
        : `Upload failed (${res.status})`;
    throw new ApiError(extractErrorMessage(data, fallback), res.status);
  }
  const message =
    (data as { message?: { file_url?: string; file_name?: string } })
      ?.message ?? {};
  return {
    file_url: message.file_url ?? "",
    file_name: message.file_name ?? file.name,
  };
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
    ignore_prepared_report: "1",
  });
  const res = await fetch(
    `/api/method/frappe.desk.query_report.run?${params}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(
      extractErrorMessage(data, `Could not run ${reportName} (${res.status})`),
      res.status,
    );
  }
  const message =
    (
      data as {
        message?: {
          columns?: ReportColumn[];
          result?: unknown[];
          add_total_row?: boolean | number;
        };
      }
    )?.message ?? {};
  const columns = message.columns ?? [];
  const result = message.result ?? [];
  // Script reports emit the odd separator/total row as a bare array; only
  // keyed rows can be rendered against the column list.
  const rows = result.filter(
    (r): r is Record<string, unknown> =>
      !!r && typeof r === "object" && !Array.isArray(r),
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
    "gdb_bank.collections.unreconciled_receipts",
    bankAccount ? { bank_account: bankAccount } : undefined,
  );

/** Ranked loan candidates for one receipt — never applied automatically. */
export const suggestLoans = (bankTransaction: string) =>
  call<{ receipt: BankReceipt; candidates: ReceiptCandidate[] }>(
    "gdb_bank.collections.suggest_loans",
    { bank_transaction: bankTransaction },
  );

export const applyReceipt = (
  bankTransaction: string,
  loan: string,
  amount?: number,
) =>
  call<{
    repayment: string;
    repayment_type: string;
    applied: number;
    receipt_status: string;
    still_unapplied: number;
  }>("gdb_bank.collections.apply_receipt", {
    bank_transaction: bankTransaction,
    loan,
    amount,
  });

export const listRuleProposals = () =>
  call<LendingRuleProposal[]>("gdb_bank.rules.list_rule_proposals");

export const proposeRuleChange = (payload: {
  rule_type: LendingRuleType;
  current_value: string;
  proposed_value: string;
  justification: string;
  effective_date: string;
}) =>
  call<{ name: string; workflow_state: string }>(
    "gdb_bank.rules.propose_rule_change",
    payload,
  );

export const decideRuleProposal = (
  name: string,
  action: "Approve" | "Reject",
  decisionNote?: string,
) =>
  call<{ name: string; workflow_state: string }>(
    "gdb_bank.rules.decide_rule_proposal",
    {
      name,
      action,
      decision_note: decisionNote,
    },
  );

export async function getList<T>(
  doctype: string,
  opts: {
    fields: string[];
    filters?: unknown;
    orderBy?: string;
    limit?: number;
  } = { fields: ["name"] },
): Promise<T[]> {
  const params = new URLSearchParams({
    fields: JSON.stringify(opts.fields),
    limit_page_length: String(opts.limit ?? 0),
  });
  if (opts.filters) params.set("filters", JSON.stringify(opts.filters));
  if (opts.orderBy) params.set("order_by", opts.orderBy);

  const res = await fetch(
    `/api/resource/${encodeURIComponent(doctype)}?${params}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(
      extractErrorMessage(data, `Could not load ${doctype} (${res.status})`),
      res.status,
    );
  }
  return ((data as { data?: T[] })?.data ?? []) as T[];
}
