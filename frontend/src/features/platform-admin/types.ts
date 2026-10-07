/** Shapes returned by gdb_bank.platform_admin — see that module and
 *  services/accounts.py, services/system_health.py and
 *  services/integration_settings.py for what each field means. */

export type AccountKind = 'staff' | 'citizens';

export interface AccountSummary {
  /** The Frappe account name. Sent back in POST bodies only — never put in a
   *  URL, because it is an email address. */
  name: string;
  full_name: string;
  kind: AccountKind;
  enabled: boolean;
  last_login: string | null;
  /** A citizen's sign-in e-ID, or the national e-ID recorded on a staff
   *  account for the conflict-of-interest check. */
  eid: string | null;
  /** The region a staff member works; it scopes a Field Officer's pool. */
  region: string | null;
  roles: string[];
  manageable: boolean;
  protected_reason: string | null;
}

export interface AccountDetail extends AccountSummary {
  email: string;
  grantable_roles: string[];
  regions: string[];
  can_change_roles: boolean;
  can_reset_password: boolean;
  /** Whether the portal can create, disable and set a one-time password on the
   *  Keycloak half itself. */
  keycloak_managed: boolean;
  warnings: string[];
}

export interface AccountPage {
  users: AccountSummary[];
  has_more: boolean;
  /** Every account matching the filters, not only this page. */
  total: number;
  /** What the server will let an administrator grant. */
  grantable_roles: string[];
  regions: string[];
}

export type KeycloakStatus = 'issued' | 'linked' | 'manual' | 'failed' | 'mirrored' | 'absent';

export interface KeycloakOutcome {
  status: KeycloakStatus;
  detail: string;
}

export interface CreateStaffResult {
  user: AccountDetail;
  keycloak: KeycloakOutcome;
  /** Present only when status is `issued`. Shown to the administrator once,
   *  held in component state only, and never sent anywhere else. */
  one_time_password: string | null;
}

export interface ResetPasswordResult {
  user: AccountDetail;
  one_time_password: string;
  detail: string;
}

export interface ChangeResult {
  user: AccountDetail;
  changed: boolean;
  keycloak?: KeycloakOutcome | null;
}

export interface AccessChange {
  name: string;
  action: string;
  subject: string;
  subject_user: string | null;
  actor: string;
  acted_on: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
}

export interface AccessHistoryPage {
  rows: AccessChange[];
  has_more: boolean;
}

export type IntegrationMode = 'configured' | 'off' | 'live';

export interface IntegrationStatus {
  key: string;
  label: string;
  mode: IntegrationMode;
}

export interface SystemHealth {
  checked_on: string;
  window_hours: number;
  scheduler: {
    state: 'running' | 'inactive' | 'disabled' | 'paused' | 'maintenance';
    last_run: string | null;
    failed_count: number;
    failed_jobs: { job: string; at: string }[];
  };
  queues: {
    available: boolean;
    workers: number;
    queues: { name: string; queued: number; failed: number }[];
  };
  errors: {
    count: number;
    recent: { title: string; at: string }[];
  };
  backups: {
    last_database: string | null;
    last_private_files: string | null;
    includes_private_files: boolean;
  };
  integrations: IntegrationStatus[];
}

export type SettingSource = 'settings' | 'site_config' | 'environment' | null;

export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  /** Always null for a secret — the server never returns one. */
  value: string | null;
  is_set: boolean;
  source: SettingSource;
}

export interface IntegrationGroup extends IntegrationStatus {
  fields: IntegrationField[];
  last_change: { actor: string; acted_on: string } | null;
}

export interface IntegrationTest {
  ok: boolean | null;
  latency_ms: number | null;
  detail: string;
}

export interface AccountCounts {
  active: number;
  disabled: number;
  total: number;
}

/** gdb_bank.platform_admin.admin_overview — the console's landing figures. */
export interface AdminOverview {
  staff: AccountCounts;
  citizens: AccountCounts;
  roles: { role: string; count: number }[];
  staff_never_signed_in: number;
  recent: AccessChange[];
}

/** What became of one spreadsheet row (GDB Citizen Import Row.result). */
export type ImportRowResult = 'New' | 'Existing' | 'Duplicate' | 'Error' | 'Created' | 'Failed';

export type ImportStatus = 'Previewed' | 'Queued' | 'Running' | 'Completed' | 'Failed';

/** gdb_bank.platform_admin.preview_citizen_import / run_citizen_import /
 *  citizen_import — one MPS call-list workbook and what became of it. */
export interface CitizenImport {
  name: string;
  status: ImportStatus;
  file_name: string;
  uploaded_by: string;
  uploaded_on: string;
  run_by: string | null;
  reason: string | null;
  started_on: string | null;
  finished_on: string | null;
  counts: {
    total: number;
    new: number;
    existing: number;
    duplicate: number;
    error: number;
    created: number;
    failed: number;
    sms_sent: number;
  };
  sheets: ({ sheet: string; total: number } & Partial<Record<Lowercase<ImportRowResult>, number>>)[];
  notes: string[];
  failure: string | null;
  /** /private/files/… — the workbook of errors, skipped and created rows. */
  error_report: string | null;
  /** An earlier COMPLETED import of this exact file, when there is one. */
  already_imported_as: string | null;
  sms_configured: boolean;
  keycloak_configured: boolean;
  /** Rows that did not (or will not) become an account; the first 500. */
  issues: {
    sheet: string;
    row_number: number;
    result: ImportRowResult;
    message: string | null;
    full_name: string | null;
    id_number: string | null;
    id_type: string | null;
  }[];
  issues_truncated: boolean;
}

export interface CitizenImportSummary {
  name: string;
  status: ImportStatus;
  source_file_name: string;
  uploaded_by: string;
  uploaded_on: string;
  run_by: string | null;
  finished_on: string | null;
  total_rows: number;
  new_rows: number;
  existing_rows: number;
  duplicate_rows: number;
  error_rows: number;
  created_count: number;
  failed_count: number;
  error_report: string | null;
}
