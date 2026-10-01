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
