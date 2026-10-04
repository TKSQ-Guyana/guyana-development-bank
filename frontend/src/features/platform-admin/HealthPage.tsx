import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { PulseIcon } from '../../components/ui/icons';
import { systemHealth, testIntegration } from './api';
import { healthIssues } from './healthSummary';
import { AlertIcon, DatabaseIcon, PlugIcon, RefreshIcon, ServerIcon } from './icons';
import type { IntegrationMode, IntegrationTest, SystemHealth } from './types';
import { errorText, formatDateTime, Notice, Panel, PageHeader, relativeTime, StatTile } from './ui';

const MODE_LABEL: Record<IntegrationMode, { text: string; className: string }> = {
  configured: { text: 'Configured', className: 'bg-emerald-50 text-emerald-700' },
  live: { text: 'Live', className: 'bg-emerald-50 text-emerald-700' },
  off: { text: 'Not configured', className: 'bg-slate-100 text-slate-500' },
};

function Reachability({ result }: { result: IntegrationTest | undefined }) {
  if (!result) return <span className="text-xs text-slate-400">Checking…</span>;
  if (result.ok === null) return <span className="text-xs text-slate-400">{result.detail}</span>;
  return (
    <span className={`flex items-center gap-1.5 text-xs ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
      <span className={`h-2 w-2 rounded-full ${result.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      {result.detail}
      {result.latency_ms !== null && <span className="tabular-nums text-slate-400">· {result.latency_ms} ms</span>}
    </span>
  );
}

/** What is running, what is failing, and whether each integration answers.
 *  Counts, times and titles only — the server never sends a traceback, and
 *  the full Error Log stays in the desk for the System Manager. */
export function HealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [reach, setReach] = useState<Record<string, IntegrationTest>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setReach({});
    try {
      const report = await systemHealth();
      setHealth(report);
      // Reachability is probed per integration, in parallel, so one slow
      // dependency does not hold the rest of the screen back.
      report.integrations.forEach((integration) => {
        testIntegration(integration.key)
          .then((result) => setReach((current) => ({ ...current, [integration.key]: result })))
          .catch((err) =>
            setReach((current) => ({
              ...current,
              [integration.key]: { ok: false, latency_ms: null, detail: errorText(err, 'Check failed.') },
            })),
          );
      });
    } catch (err) {
      setError(errorText(err, 'Could not load system health.'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issues = health ? healthIssues(health) : [];
  const critical = issues.some((i) => i.severity === 'critical');
  const failedJobs = health?.queues.available ? health.queues.queues.reduce((n, q) => n + q.failed, 0) : 0;
  const waiting = health?.queues.available ? health.queues.queues.reduce((n, q) => n + q.queued, 0) : 0;

  return (
    <div>
      <PageHeader
        title="System health"
        lede={`The background scheduler, the job queues, recent errors, backups and every integration — over the last ${health?.window_hours ?? 24} hours.`}
        action={
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>
            <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Checking…' : 'Check again'}
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      {health && (
        <div className="space-y-6">
          <div
            className={`flex flex-wrap items-start gap-4 rounded-2xl border p-5 ${
              !issues.length
                ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white'
                : critical
                  ? 'border-rose-200 bg-gradient-to-r from-rose-50 to-white'
                  : 'border-amber-200 bg-gradient-to-r from-amber-50 to-white'
            }`}
          >
            <span
              className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl ${
                !issues.length ? 'bg-emerald-500 text-white' : critical ? 'bg-rose-500 text-white' : 'bg-amber-400 text-amber-950'
              }`}
            >
              {issues.length ? <AlertIcon /> : <PulseIcon />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-900">
                {!issues.length
                  ? 'All systems operational'
                  : critical
                    ? 'Something is down'
                    : `${issues.length} thing${issues.length === 1 ? '' : 's'} to look at`}
              </p>
              {issues.length ? (
                <ul className="mt-1.5 space-y-1">
                  {issues.map((i) => (
                    <li key={i.text} className={`flex items-center gap-2 text-sm ${i.severity === 'critical' ? 'text-rose-700' : 'text-amber-800'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${i.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                      {i.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-sm text-slate-600">The scheduler, workers, backups and error log are all as they should be.</p>
              )}
            </div>
            <p className="text-xs text-slate-400">Checked {formatDateTime(health.checked_on)}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Scheduler"
              value={<span className="capitalize">{health.scheduler.state}</span>}
              hint={`Last run ${relativeTime(health.scheduler.last_run).toLowerCase()}`}
              icon={<ServerIcon />}
              tone={health.scheduler.state === 'running' ? 'brand' : 'rose'}
            />
            <StatTile
              label="Workers"
              value={health.queues.available ? health.queues.workers : '—'}
              hint={health.queues.available ? `${waiting} job${waiting === 1 ? '' : 's'} waiting · ${failedJobs} failed` : 'Queue unreachable'}
              icon={<PulseIcon />}
              tone={health.queues.available && health.queues.workers ? 'brand' : 'rose'}
            />
            <StatTile
              label="Errors"
              value={health.errors.count}
              hint={`in the last ${health.window_hours} hours`}
              icon={<AlertIcon />}
              tone={health.errors.count ? 'amber' : 'slate'}
            />
            <StatTile
              label="Last backup"
              value={relativeTime(health.backups.last_database)}
              hint={health.backups.includes_private_files ? 'Includes applicant documents' : 'Database only'}
              icon={<DatabaseIcon />}
              tone={health.backups.last_database ? (health.backups.includes_private_files ? 'brand' : 'amber') : 'rose'}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Background job queues" icon={<ServerIcon />} bodyClassName="p-0">
              {health.queues.available ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2.5 font-semibold">Queue</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Waiting</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {health.queues.queues.map((q) => (
                      <tr key={q.name}>
                        <td className="px-5 py-2.5 font-medium capitalize text-slate-700">{q.name}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{q.queued}</td>
                        <td className={`px-5 py-2.5 text-right tabular-nums ${q.failed ? 'font-semibold text-rose-600' : 'text-slate-600'}`}>
                          {q.failed}
                        </td>
                      </tr>
                    ))}
                    {!health.queues.queues.length && (
                      <tr>
                        <td colSpan={3} className="px-5 py-4 text-center text-slate-400">
                          No queues reported.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <div className="p-5">
                  <Notice tone="error">The job queue could not be reached.</Notice>
                </div>
              )}
            </Panel>

            <Panel title="Recent errors" icon={<AlertIcon />} bodyClassName="p-0">
              {health.errors.recent.length ? (
                <ul className="divide-y divide-slate-100">
                  {health.errors.recent.map((e) => (
                    <li key={`${e.title}-${e.at}`} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0 truncate text-sm text-slate-700">{e.title || 'Untitled error'}</span>
                      <span className="flex-none text-xs text-slate-400" title={formatDateTime(e.at)}>
                        {relativeTime(e.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-center text-sm text-slate-500">No errors logged. </p>
              )}
              {health.scheduler.failed_jobs.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Failed scheduled jobs</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                    {health.scheduler.failed_jobs.map((j) => (
                      <li key={`${j.job}-${j.at}`} className="flex justify-between gap-3">
                        <span className="truncate font-mono">{j.job}</span>
                        <span className="flex-none text-slate-400">{relativeTime(j.at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>

            <Panel title="Backups" icon={<DatabaseIcon />}>
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Database</dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-800">{formatDateTime(health.backups.last_database)}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Applicant files</dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-800">{formatDateTime(health.backups.last_private_files)}</dd>
                </div>
              </dl>
              {!health.backups.includes_private_files && (
                <div className="mt-3">
                  <Notice tone="warning">
                    The newest backup does not include applicant documents. A restore from it would bring the Bank
                    back without its evidence.
                  </Notice>
                </div>
              )}
            </Panel>

            <Panel title="Integrations" icon={<PlugIcon />} bodyClassName="p-0">
              <ul className="divide-y divide-slate-100">
                {health.integrations.map((integration) => (
                  <li key={integration.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-800">{integration.label}</span>
                      <Reachability result={reach[integration.key]} />
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MODE_LABEL[integration.mode].className}`}>
                      {MODE_LABEL[integration.mode].text}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
