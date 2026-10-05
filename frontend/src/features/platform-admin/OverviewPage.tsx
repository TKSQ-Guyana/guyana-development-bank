import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth';
import { HistoryIcon, PlusIcon, UsersIcon } from '../../components/ui/icons';
import { roleLabel } from '../../shared/personas';
import { adminOverview, systemHealth } from './api';
import { ChangeLine } from './AccessHistoryPage';
import { healthIssues } from './healthSummary';
import { AlertIcon, ChevronRightIcon, DatabaseIcon, KeyIcon, ServerIcon, ShieldIcon } from './icons';
import type { AdminOverview, SystemHealth } from './types';
import { errorText, Notice, Panel, relativeTime, ROLE_INFO, StatTile } from './ui';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** The console's landing page: who has access, whether the platform is well,
 *  and what was changed last — each with the way into its own page. */
export function OverviewPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminOverview()
      .then(setOverview)
      .catch((err) => setError(errorText(err, 'Could not load the overview.')));
    systemHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const issues = health ? healthIssues(health) : [];
  const critical = issues.some((i) => i.severity === 'critical');
  const maxRole = Math.max(1, ...(overview?.roles.map((r) => r.count) ?? [1]));
  const firstName = (user?.full_name ?? '').split(' ')[0];
  const integrationsOn = health?.integrations.filter((i) => i.mode !== 'off').length ?? 0;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#000000] via-brand-dark to-brand p-6 text-white shadow-lg shadow-emerald-950/20 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-amber-300/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-emerald-300/10 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Platform administration</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-emerald-50/80">
              Staff access, the platform's health and its integrations. Every change you make here is
              recorded with its reason.
            </p>
            <div className="mt-4">
              {!health ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-emerald-50">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" /> Checking the platform…
                </span>
              ) : (
                <Link
                  to="/admin/health"
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${
                    !issues.length
                      ? 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30 hover:bg-emerald-400/25'
                      : critical
                        ? 'bg-rose-400/20 text-rose-100 ring-rose-300/40 hover:bg-rose-400/30'
                        : 'bg-amber-400/20 text-amber-100 ring-amber-300/40 hover:bg-amber-400/30'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${!issues.length ? 'bg-emerald-300' : critical ? 'bg-rose-300' : 'bg-amber-300'}`}
                  />
                  {!issues.length
                    ? 'All systems operational'
                    : `${issues.length} thing${issues.length === 1 ? '' : 's'} need${issues.length === 1 ? 's' : ''} attention`}
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/users?new=1"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-emerald-950 shadow-sm transition-colors hover:bg-amber-300"
            >
              <PlusIcon className="h-4 w-4" /> New staff account
            </Link>
            <Link
              to="/admin/users"
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/15"
            >
              <UsersIcon className="h-4 w-4" /> Manage users
            </Link>
          </div>
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Staff accounts"
          value={overview?.staff.active ?? '—'}
          hint={overview ? `active · ${overview.staff.disabled} disabled` : ' '}
          icon={<ShieldIcon />}
        />
        <StatTile
          label="Citizen accounts"
          value={overview?.citizens.active.toLocaleString() ?? '—'}
          hint={overview ? `active · ${overview.citizens.disabled} disabled` : ' '}
          icon={<UsersIcon />}
          tone="sky"
        />
        <StatTile
          label="Awaiting first sign-in"
          value={overview?.staff_never_signed_in ?? '—'}
          hint="staff who have never signed in"
          icon={<KeyIcon />}
          tone="amber"
        />
        <StatTile
          label="Errors"
          value={health?.errors.count ?? '—'}
          hint={health ? `in the last ${health.window_hours} hours` : ' '}
          icon={<AlertIcon />}
          tone={health?.errors.count ? 'rose' : 'slate'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Staff by role"
          icon={<ShieldIcon />}
          action={
            <Link to="/admin/users" className="text-xs font-semibold text-brand hover:underline">
              View all
            </Link>
          }
        >
          {!overview ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <ul className="space-y-3.5">
              {overview.roles.map((r) => (
                <li key={r.role}>
                  <Link to={`/admin/users?role=${encodeURIComponent(r.role)}`} className="group block">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-800 group-hover:text-brand">{roleLabel(r.role)}</span>
                      <span className="text-sm font-bold tabular-nums text-slate-900">{r.count}</span>
                    </div>
                    <p className="text-xs text-slate-500">{ROLE_INFO[r.role]?.summary}</p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand to-emerald-400 transition-all"
                        style={{ width: `${(r.count / maxRole) * 100}%` }}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Platform"
          icon={<ServerIcon />}
          action={
            <Link to="/admin/health" className="text-xs font-semibold text-brand hover:underline">
              Details
            </Link>
          }
          bodyClassName="p-0"
        >
          {!health ? (
            <p className="p-5 text-sm text-slate-400">Checking…</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[
                {
                  icon: <ServerIcon />,
                  label: 'Scheduler',
                  value: health.scheduler.state === 'running' ? 'Running' : health.scheduler.state,
                  ok: health.scheduler.state === 'running',
                },
                {
                  icon: <ServerIcon />,
                  label: 'Background workers',
                  value: health.queues.available ? `${health.queues.workers} online` : 'Unreachable',
                  ok: health.queues.available && health.queues.workers > 0,
                },
                {
                  icon: <DatabaseIcon />,
                  label: 'Last backup',
                  value: relativeTime(health.backups.last_database),
                  ok: Boolean(health.backups.last_database),
                },
                {
                  icon: <ShieldIcon />,
                  label: 'Integrations',
                  value: `${integrationsOn} of ${health.integrations.length} configured`,
                  ok: integrationsOn > 0,
                },
              ].map((row) => (
                <li key={row.label} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 [&>svg]:h-4 [&>svg]:w-4">
                    {row.icon}
                  </span>
                  <span className="flex-1 text-sm text-slate-600">{row.label}</span>
                  <span className={`flex items-center gap-1.5 text-sm font-semibold ${row.ok ? 'text-slate-800' : 'text-amber-700'}`}>
                    <span className={`h-2 w-2 rounded-full ${row.ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {row.value}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {issues.length > 0 && (
            <ul className="space-y-1.5 border-t border-slate-100 bg-amber-50/50 px-5 py-3">
              {issues.slice(0, 3).map((i) => (
                <li key={i.text} className={`flex gap-2 text-xs ${i.severity === 'critical' ? 'text-rose-700' : 'text-amber-800'}`}>
                  <AlertIcon className="mt-px h-3.5 w-3.5 flex-none" /> {i.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent changes"
        icon={<HistoryIcon />}
        action={
          <Link to="/admin/history" className="text-xs font-semibold text-brand hover:underline">
            Full access history
          </Link>
        }
        bodyClassName="px-5 py-2"
      >
        {!overview ? (
          <p className="py-3 text-sm text-slate-400">Loading…</p>
        ) : overview.recent.length === 0 ? (
          <p className="py-3 text-sm text-slate-500">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {overview.recent.map((row) => (
              <ChangeLine key={row.name} row={row} compact />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
