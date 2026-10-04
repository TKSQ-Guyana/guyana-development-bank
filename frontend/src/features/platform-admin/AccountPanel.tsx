import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { getAccount, resetPassword, setAccountEnabled, setAccountRegion, setAccountRoles } from './api';
import type { AccountDetail, KeycloakOutcome } from './types';
import {
  Avatar,
  errorText,
  formatDateTime,
  hasReason,
  inputClass,
  Notice,
  OneTimePassword,
  ReasonField,
  relativeTime,
  RoleChip,
  RolePicker,
  StatusPill,
} from './ui';

const OUTCOME_TONE = {
  issued: 'success',
  linked: 'success',
  mirrored: 'success',
  manual: 'warning',
  absent: 'warning',
  failed: 'error',
} as const;

function KeycloakNotice({ outcome }: { outcome: KeycloakOutcome | null | undefined }) {
  if (!outcome) return null;
  return <Notice tone={OUTCOME_TONE[outcome.status]}>Keycloak: {outcome.detail}</Notice>;
}

type ActionResult = {
  user: AccountDetail;
  keycloak?: KeycloakOutcome | null;
  oneTimePassword?: string | null;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-slate-100 pt-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm text-slate-800 ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

/** One account: who it is, what it may do, and the things an administrator
 *  can change about it — its roles and region, whether it is enabled (the
 *  kill switch), and a one-time password to replace whatever it signs in with.
 *  Opened from the list with the account held in page state, never in the URL:
 *  its name is an email address. */
export function AccountPanel({
  name,
  initialOutcome,
  initialOneTimePassword,
  onChanged,
}: {
  name: string;
  initialOutcome?: KeycloakOutcome | null;
  /** From the create call that opened this panel, if it issued one. */
  initialOneTimePassword?: string | null;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [region, setRegion] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<KeycloakOutcome | null | undefined>(initialOutcome);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(initialOneTimePassword ?? null);
  const [confirming, setConfirming] = useState<'toggle' | 'reset' | null>(null);

  const show = useCallback((next: AccountDetail) => {
    setAccount(next);
    setRoles(next.roles.filter((r) => next.grantable_roles.includes(r)));
    setRegion(next.region ?? '');
  }, []);

  useEffect(() => {
    setAccount(null);
    setError(null);
    setMessage(null);
    setConfirming(null);
    setOutcome(initialOutcome);
    setOneTimePassword(initialOneTimePassword ?? null);
    getAccount(name)
      .then(show)
      .catch((err) => setError(errorText(err, 'Could not load this account.')));
  }, [name, initialOutcome, initialOneTimePassword, show]);

  const run = async (action: () => Promise<ActionResult>, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setOutcome(null);
    setOneTimePassword(null);
    try {
      const result = await action();
      show(result.user);
      setOutcome(result.keycloak);
      setOneTimePassword(result.oneTimePassword ?? null);
      setMessage(done);
      setReason('');
      setConfirming(null);
      onChanged();
    } catch (err) {
      setError(errorText(err, 'The change was not made.'));
    } finally {
      setBusy(false);
    }
  };

  if (!account) {
    return error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-slate-500">Loading…</p>;
  }

  const staff = account.kind === 'staff';
  const currentGrantable = account.roles.filter((r) => account.grantable_roles.includes(r));
  const rolesChanged = roles.length !== currentGrantable.length || roles.some((r) => !currentGrantable.includes(r));
  const regionChanged = region !== (account.region ?? '');
  const toggle = (role: string) =>
    setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));
  const reasonOk = hasReason(reason);

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-50 to-white p-4 ring-1 ring-slate-200/70">
        <Avatar name={account.full_name} size="lg" muted={!account.enabled} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-slate-900">{account.full_name}</p>
          <p className="truncate text-sm text-slate-500">{account.email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusPill enabled={account.enabled} />
            {account.roles.map((r) => (
              <RoleChip key={r} role={r} />
            ))}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Fact label="Signs in with">{staff ? 'Work email' : 'e-ID or National ID'}</Fact>
        <Fact label="Last sign-in">
          <span title={formatDateTime(account.last_login)}>{relativeTime(account.last_login)}</span>
        </Fact>
        <Fact label={staff ? 'National e-ID' : 'e-ID'} mono>
          {account.eid ?? '—'}
        </Fact>
        <Fact label="Region">{account.region ?? '—'}</Fact>
      </dl>

      {message && <Notice tone="success">{message}</Notice>}
      {oneTimePassword ? (
        <OneTimePassword password={oneTimePassword} detail={outcome?.detail ?? ''} />
      ) : (
        <KeycloakNotice outcome={outcome} />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {account.warnings.map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}

      {!account.manageable ? (
        <Notice tone="info">{account.protected_reason}</Notice>
      ) : (
        <>
          {account.can_change_roles && (
            <Section title="Access" hint="What this person can do in the portal. Facilitator and Field Officer are held alone.">
              <RolePicker roles={account.grantable_roles} selected={roles} onToggle={toggle} disabled={busy} />
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Region</span>
                <select value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} className={inputClass}>
                  <option value="">None</option>
                  {account.regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-400">A Field Officer sees only applicants in their region.</span>
              </label>
            </Section>
          )}
          {!staff && (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500">
              A citizen account carries no staff role. Its password is managed by the e-ID service.
            </p>
          )}

          <Section title="Save changes">
            <ReasonField value={reason} onChange={setReason} disabled={busy} />
            {account.can_change_roles && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !rolesChanged || roles.length === 0 || !reasonOk}
                  onClick={() => void run(() => setAccountRoles(account.name, roles, reason.trim()), 'Roles updated.')}
                >
                  Save roles
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !regionChanged || !reasonOk}
                  onClick={() => void run(() => setAccountRegion(account.name, region, reason.trim()), 'Region updated.')}
                >
                  Save region
                </Button>
              </div>
            )}
          </Section>

          <Section title="Account actions">
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {account.enabled ? 'Disable this account' : 'Enable this account'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {account.enabled
                      ? 'Refused at every sign-in from now on; open sessions end at once.'
                      : 'They can sign in again with their existing password.'}
                  </p>
                </div>
                {confirming === 'toggle' ? (
                  <span className="flex gap-2">
                    <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant={account.enabled ? 'danger' : 'primary'}
                      disabled={busy || !reasonOk}
                      onClick={() =>
                        void run(
                          () => setAccountEnabled(account.name, !account.enabled, reason.trim()),
                          account.enabled ? 'Account disabled. Its open sessions have been ended.' : 'Account enabled.',
                        )
                      }
                    >
                      {account.enabled ? 'Yes, disable' : 'Yes, enable'}
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant={account.enabled ? 'danger' : 'secondary'}
                    disabled={busy || !reasonOk}
                    title={reasonOk ? undefined : 'Give a reason first'}
                    onClick={() => setConfirming('toggle')}
                  >
                    {account.enabled ? 'Disable' : 'Enable'}
                  </Button>
                )}
              </div>
              {account.can_reset_password && account.keycloak_managed && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">Reset password</p>
                    <p className="text-xs text-slate-500">Issues a one-time password, shown once; they choose their own at sign-in.</p>
                  </div>
                  {confirming === 'reset' ? (
                    <span className="flex gap-2">
                      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                      <Button
                        disabled={busy || !reasonOk}
                        onClick={() =>
                          void run(async () => {
                            const result = await resetPassword(account.name, reason.trim());
                            return {
                              user: result.user,
                              keycloak: { status: 'issued', detail: result.detail },
                              oneTimePassword: result.one_time_password,
                            };
                          }, 'Password reset. Their open sessions have been ended.')
                        }
                      >
                        Yes, reset
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={busy || !reasonOk}
                      title={reasonOk ? undefined : 'Give a reason first'}
                      onClick={() => setConfirming('reset')}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              )}
            </div>
            {!reasonOk && <p className="text-xs text-slate-400">Give a reason above to enable these actions.</p>}
          </Section>
        </>
      )}
    </div>
  );
}
