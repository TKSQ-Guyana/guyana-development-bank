import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { PlusIcon } from '../../components/ui/icons';
import { AccountPanel } from './AccountPanel';
import { listAccounts } from './api';
import { CreateStaffForm } from './CreateStaffForm';
import type { AccountKind, AccountPage, KeycloakOutcome } from './types';
import { errorText, formatDateTime, Notice, PageHeader } from './ui';

/** The one-time password rides here only between the create call and the
 *  panel that shows it; choosing any other row drops it. */
type Side =
  | { mode: 'none' }
  | { mode: 'create' }
  | { mode: 'account'; name: string; outcome?: KeycloakOutcome; oneTimePassword?: string | null };

const SEARCH_DELAY_MS = 300;

export function UsersPage() {
  const [kind, setKind] = useState<AccountKind>('staff');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(0);
  const [page, setPage] = useState<AccountPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>({ mode: 'none' });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      setStart(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(() => {
    setError(null);
    listAccounts(kind, search, start)
      .then(setPage)
      .catch((err) => setError(errorText(err, 'Could not load accounts.')));
  }, [kind, search, start]);

  useEffect(load, [load]);

  const switchKind = (next: AccountKind) => {
    setKind(next);
    setStart(0);
    setSide({ mode: 'none' });
  };

  const tabClass = (value: AccountKind) =>
    `rounded-full px-4 py-1.5 text-sm font-semibold ${
      kind === value ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100'
    }`;

  return (
    <div>
      <PageHeader
        title="Users"
        lede="Staff accounts are created here and sign in with their work email. Citizen accounts open on a citizen's first e-ID sign-in, and can be disabled here — the kill switch holds even while Keycloak still accepts their password."
        action={
          <Button onClick={() => setSide({ mode: 'create' })} disabled={!page}>
            <PlusIcon className="h-4 w-4" /> New staff account
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="tablist" aria-label="Account kind">
              <button type="button" role="tab" aria-selected={kind === 'staff'} className={tabClass('staff')} onClick={() => switchKind('staff')}>
                Staff
              </button>
              <button type="button" role="tab" aria-selected={kind === 'citizens'} className={tabClass('citizens')} onClick={() => switchKind('citizens')}>
                Citizens
              </button>
            </div>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={kind === 'staff' ? 'Search name, email or e-ID' : 'Search name or e-ID'}
              aria-label="Search accounts"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>

          {error && (
            <div className="p-4">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <DataTable
            bare
            caption={kind === 'staff' ? 'GDB staff accounts' : 'Citizen accounts'}
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (u) => (
                  <>
                    <span className="font-medium text-slate-800">{u.full_name}</span>
                    {kind === 'staff' && (
                      <span className="block text-xs text-slate-400">{u.name}</span>
                    )}
                  </>
                ),
              },
              {
                key: 'identity',
                // Staff sign in by work email and citizens by e-ID, so the
                // column that identifies an account is a different fact for
                // each — named as the one it actually holds.
                header: kind === 'staff' ? 'Roles' : 'e-ID',
                nowrap: kind !== 'staff',
                className: kind === 'staff' ? '' : 'font-mono',
                cell: (u) =>
                  kind === 'staff' ? (
                    <span className="flex flex-wrap gap-1">
                      {u.roles.length ? (
                        u.roles.map((r) => <Badge key={r}>{r}</Badge>)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </span>
                  ) : (
                    (u.eid ?? '—')
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (u) => (
                  <Badge tone={u.enabled ? 'success' : 'danger'}>
                    {u.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                ),
              },
              {
                key: 'last_login',
                header: 'Last sign-in',
                nowrap: true,
                className: 'text-slate-500',
                cell: (u) => formatDateTime(u.last_login),
              },
            ]}
            rows={page?.users ?? []}
            rowKey={(u) => u.name}
            onRowClick={(u) => setSide({ mode: 'account', name: u.name })}
            rowClassName={(u) =>
              side.mode === 'account' && side.name === u.name ? 'bg-brand-light/40' : ''
            }
            minWidth="36rem"
            footnote={false}
            empty="No accounts match."
          />

          {page && (start > 0 || page.has_more) && (
            <div className="flex justify-between border-t border-slate-100 p-3">
              <Button variant="secondary" disabled={start === 0} onClick={() => setStart(Math.max(0, start - 50))}>
                Previous
              </Button>
              <Button variant="secondary" disabled={!page.has_more} onClick={() => setStart(start + 50)}>
                Next
              </Button>
            </div>
          )}
        </Card>

        <div>
          {side.mode === 'create' && page && (
            <CreateStaffForm
              grantableRoles={page.grantable_roles}
              regions={page.regions}
              onCancel={() => setSide({ mode: 'none' })}
              onCreated={(result) => {
                setKind('staff');
                setSide({
                  mode: 'account',
                  name: result.user.name,
                  outcome: result.keycloak,
                  oneTimePassword: result.one_time_password,
                });
                load();
              }}
            />
          )}
          {side.mode === 'account' && (
            <AccountPanel
              name={side.name}
              initialOutcome={side.outcome}
              initialOneTimePassword={side.oneTimePassword}
              onChanged={load}
              onClose={() => setSide({ mode: 'none' })}
            />
          )}
          {side.mode === 'none' && (
            <Card>
              <p className="text-sm text-slate-500">
                Choose an account to see its roles and status, or create a staff account.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
