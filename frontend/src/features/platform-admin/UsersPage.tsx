import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PlusIcon } from '../../components/ui/icons';
import { Pager } from '../../components/ui/Pager';
import { roleLabel } from '../../shared/personas';
import { AccountPanel } from './AccountPanel';
import { adminOverview, listAccounts } from './api';
import { CreateStaffForm } from './CreateStaffForm';
import { ChevronRightIcon, SearchIcon } from './icons';
import type { AccountKind, AccountPage, AdminOverview, KeycloakOutcome } from './types';
import { Avatar, errorText, formatDateTime, inputClass, Notice, PageHeader, relativeTime, RoleChip, selectClass, StatusPill } from './ui';

/** The one-time password rides here only between the create call and the
 *  panel that shows it; choosing any other row drops it. */
type Side =
  | { mode: 'none' }
  | { mode: 'create' }
  | { mode: 'account'; name: string; outcome?: KeycloakOutcome; oneTimePassword?: string | null };

const SEARCH_DELAY_MS = 300;
const PAGE_SIZES = [10, 25, 50];

export function UsersPage() {
  // Which list, its filters and its page size live in the address bar, so a
  // filtered list survives a reload and the overview can link straight to one.
  // The account opened stays in state only: its name is an email address.
  const [params, setParams] = useSearchParams();
  const kind: AccountKind = params.get('kind') === 'citizens' ? 'citizens' : 'staff';
  const status = (params.get('status') ?? '') as '' | 'active' | 'disabled';
  const role = kind === 'staff' ? (params.get('role') ?? '') : '';
  const search = params.get('q') ?? '';
  const pageLength = PAGE_SIZES.includes(Number(params.get('rows'))) ? Number(params.get('rows')) : 25;

  const [typed, setTyped] = useState(search);
  const [start, setStart] = useState(0);
  const [page, setPage] = useState<AccountPage | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>(() => (params.get('new') ? { mode: 'create' } : { mode: 'none' }));

  const update = useCallback(
    (changes: Record<string, string>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
          next.delete('new');
          return next;
        },
        { replace: true },
      );
      setStart(0);
    },
    [setParams],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== search) update({ q: typed.trim() });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, search, update]);

  const load = useCallback(() => {
    setError(null);
    listAccounts(kind, search, start, { status, role, pageLength })
      .then(setPage)
      .catch((err) => setError(errorText(err, 'Could not load accounts.')));
  }, [kind, search, start, status, role, pageLength]);

  const loadCounts = useCallback(() => {
    adminOverview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

  useEffect(load, [load]);
  useEffect(loadCounts, [loadCounts]);

  const changed = () => {
    load();
    loadCounts();
  };

  const switchKind = (next: AccountKind) => {
    update({ kind: next === 'staff' ? '' : next, role: '' });
    setSide({ mode: 'none' });
  };

  const filtered = Boolean(search || status || role);
  const tabs: { id: AccountKind; label: string; count?: number }[] = [
    { id: 'staff', label: 'Staff', count: overview?.staff.total },
    { id: 'citizens', label: 'Citizens', count: overview?.citizens.total },
  ];

  return (
    <div>
      <PageHeader
        title="Users & roles"
        lede="Staff accounts are created here and sign in with their work email. Citizen accounts open on a citizen's first sign-in and can be disabled here — the kill switch holds even while Keycloak still accepts their password."
        action={
          <Button onClick={() => setSide({ mode: 'create' })} disabled={!page}>
            <PlusIcon className="h-4 w-4" /> New staff account
          </Button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 pt-3">
          <div className="flex gap-6" role="tablist" aria-label="Account kind">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={kind === t.id}
                onClick={() => switchKind(t.id)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                  kind === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                      kind === t.id ? 'bg-brand-light text-brand-text' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {t.count.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
          <label className="relative min-w-[220px] flex-[2]">
            <span className="sr-only">Search accounts</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={kind === 'staff' ? 'Search name, email or e-ID' : 'Search name or e-ID'}
              className={`${inputClass} pl-9`}
            />
          </label>
          <select
            value={status}
            onChange={(e) => update({ status: e.target.value })}
            aria-label="Status"
            className={`${selectClass} min-w-[130px] flex-1 sm:flex-none`}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          {kind === 'staff' && (
            <select
              value={role}
              onChange={(e) => update({ role: e.target.value })}
              aria-label="Role"
              className={`${selectClass} min-w-[160px] flex-1 sm:flex-none`}
            >
              <option value="">Any role</option>
              {[...(page?.grantable_roles ?? []), 'Platform Admin'].map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          )}
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setTyped('');
                update({ q: '', status: '', role: '' });
              }}
              className="text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              Clear
            </button>
          )}
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
              header: 'Person',
              cell: (u) => (
                <span className="flex items-center gap-3">
                  <Avatar name={u.full_name} muted={!u.enabled} />
                  <span className="min-w-0">
                    <span className={`block truncate font-semibold ${u.enabled ? 'text-slate-900' : 'text-slate-400'}`}>
                      {u.full_name}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {kind === 'staff' ? u.name : (u.eid ?? 'No e-ID')}
                    </span>
                  </span>
                </span>
              ),
            },
            ...(kind === 'staff'
              ? [
                  {
                    key: 'roles',
                    header: 'Roles',
                    cell: (u: AccountPage['users'][number]) => (
                      <span className="flex flex-wrap gap-1">
                        {u.roles.length ? u.roles.map((r) => <RoleChip key={r} role={r} />) : <span className="text-slate-400">—</span>}
                      </span>
                    ),
                  },
                  {
                    key: 'region',
                    header: 'Region',
                    className: 'text-slate-500',
                    cell: (u: AccountPage['users'][number]) => u.region ?? '—',
                  },
                ]
              : []),
            {
              key: 'status',
              header: 'Status',
              cell: (u) => <StatusPill enabled={u.enabled} />,
            },
            {
              key: 'last_login',
              header: 'Last sign-in',
              nowrap: true,
              className: 'text-slate-500',
              cell: (u) => (
                <span title={formatDateTime(u.last_login)} className={u.last_login ? '' : 'text-amber-600'}>
                  {relativeTime(u.last_login)}
                </span>
              ),
            },
            {
              key: 'open',
              header: <span className="sr-only">Open</span>,
              align: 'right',
              cell: () => <ChevronRightIcon className="ml-auto h-4 w-4 text-slate-300" />,
            },
          ]}
          rows={page?.users ?? []}
          rowKey={(u) => u.name}
          onRowClick={(u) => setSide({ mode: 'account', name: u.name })}
          rowClassName={(u) => (side.mode === 'account' && side.name === u.name ? 'bg-brand-light/40' : '')}
          minWidth="44rem"
          footnote={false}
          empty={!page ? 'Loading accounts…' : filtered ? 'No accounts match these filters.' : 'No accounts yet.'}
        />

        {page && (
          <div className="border-t border-slate-100 px-4 pb-3">
            <Pager
              start={start}
              pageLength={pageLength}
              total={page.total}
              onChange={setStart}
              pageSizes={PAGE_SIZES}
              onPageLength={(n) => update({ rows: n === 25 ? '' : String(n) })}
            />
          </div>
        )}
      </div>

      <Drawer
        open={side.mode === 'create'}
        onClose={() => setSide({ mode: 'none' })}
        title="New staff account"
        subtitle="They sign in with their work email. A one-time password is shown once the account exists."
        wide
      >
        {side.mode === 'create' && page && (
          <CreateStaffForm
            grantableRoles={page.grantable_roles}
            regions={page.regions}
            onCancel={() => setSide({ mode: 'none' })}
            onCreated={(result) => {
              if (kind !== 'staff') switchKind('staff');
              setSide({
                mode: 'account',
                name: result.user.name,
                outcome: result.keycloak,
                oneTimePassword: result.one_time_password,
              });
              changed();
            }}
          />
        )}
      </Drawer>

      <Drawer
        open={side.mode === 'account'}
        onClose={() => setSide({ mode: 'none' })}
        title={kind === 'staff' ? 'Staff account' : 'Citizen account'}
        wide
      >
        {side.mode === 'account' && (
          <AccountPanel
            name={side.name}
            initialOutcome={side.outcome}
            initialOneTimePassword={side.oneTimePassword}
            onChanged={changed}
          />
        )}
      </Drawer>
    </div>
  );
}
