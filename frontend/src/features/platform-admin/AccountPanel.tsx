import { useCallback, useEffect, useState } from 'react';
import { roleLabel } from '../../shared/personas';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { getAccount, resetPassword, setAccountEnabled, setAccountRegion, setAccountRoles } from './api';
import type { AccountDetail, KeycloakOutcome } from './types';
import { errorText, formatDateTime, hasReason, inputClass, Notice, OneTimePassword, ReasonField } from './ui';

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

/** One account: who it is, what it may do, and the three things an
 *  administrator can change about it — its roles, whether it is enabled (the
 *  kill switch), and a one-time password to replace whatever it signs in with.
 *  Opened from the list with the account held in page state, never in the URL:
 *  its name is an email address. */
export function AccountPanel({
  name,
  initialOutcome,
  initialOneTimePassword,
  onChanged,
  onClose,
}: {
  name: string;
  initialOutcome?: KeycloakOutcome | null;
  /** From the create call that opened this panel, if it issued one. */
  initialOneTimePassword?: string | null;
  onChanged: () => void;
  onClose: () => void;
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

  const show = useCallback((next: AccountDetail) => {
    setAccount(next);
    setRoles(next.roles.filter((r) => next.grantable_roles.includes(r)));
    setRegion(next.region ?? '');
  }, []);

  useEffect(() => {
    setAccount(null);
    setError(null);
    setMessage(null);
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
      onChanged();
    } catch (err) {
      setError(errorText(err, 'The change was not made.'));
    } finally {
      setBusy(false);
    }
  };

  if (!account) {
    return (
      <Card>
        {error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-slate-500">Loading…</p>}
      </Card>
    );
  }

  const staff = account.kind === 'staff';
  const currentGrantable = account.roles.filter((r) => account.grantable_roles.includes(r));
  const rolesChanged =
    roles.length !== currentGrantable.length || roles.some((r) => !currentGrantable.includes(r));
  const toggle = (role: string) =>
    setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));

  return (
    <Card className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-slate-900">{account.full_name}</h2>
          <p className="truncate text-sm text-slate-500">{account.email}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-700">
          Close
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <CardLabel>Account</CardLabel>
          <dd className="mt-1">{staff ? 'Staff — work email' : 'Citizen — e-ID'}</dd>
        </div>
        <div>
          <CardLabel>Status</CardLabel>
          <dd className="mt-1">
            <Badge tone={account.enabled ? 'success' : 'danger'}>{account.enabled ? 'Active' : 'Disabled'}</Badge>
          </dd>
        </div>
        <div>
          <CardLabel>{staff ? 'National e-ID (conflict check)' : 'e-ID'}</CardLabel>
          <dd className="mt-1 font-mono">{account.eid ?? '—'}</dd>
        </div>
        <div>
          <CardLabel>Last sign-in</CardLabel>
          <dd className="mt-1">{formatDateTime(account.last_login)}</dd>
        </div>
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
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Roles</legend>
              <div className="flex flex-wrap gap-3">
                {account.grantable_roles.map((role) => (
                  <label key={role} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} disabled={busy} />
                    {roleLabel(role)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {account.can_change_roles && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Region</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} className={inputClass}>
                <option value="">None</option>
                {account.regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!staff && (
            <p className="text-sm text-slate-500">
              A citizen account carries no staff role. Its password is managed by the e-ID service.
            </p>
          )}

          <ReasonField value={reason} onChange={setReason} disabled={busy} />

          <div className="flex flex-wrap gap-2">
            {account.can_change_roles && (
              <Button
                disabled={busy || !rolesChanged || roles.length === 0 || !hasReason(reason)}
                onClick={() => void run(() => setAccountRoles(account.name, roles, reason.trim()), 'Roles updated.')}
              >
                Save roles
              </Button>
            )}
            {account.can_change_roles && (
              <Button
                variant="secondary"
                disabled={busy || region === (account.region ?? '') || !hasReason(reason)}
                onClick={() => void run(() => setAccountRegion(account.name, region, reason.trim()), 'Region updated.')}
              >
                Save region
              </Button>
            )}
            <Button
              variant={account.enabled ? 'danger' : 'secondary'}
              disabled={busy || !hasReason(reason)}
              onClick={() =>
                void run(
                  () => setAccountEnabled(account.name, !account.enabled, reason.trim()),
                  account.enabled
                    ? 'Account disabled. Its open sessions have been ended.'
                    : 'Account enabled.',
                )
              }
            >
              {account.enabled ? 'Disable account' : 'Enable account'}
            </Button>
            {account.can_reset_password && account.keycloak_managed && (
              <Button
                variant="secondary"
                disabled={busy || !hasReason(reason)}
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
                Reset password
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
