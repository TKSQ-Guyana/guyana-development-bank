import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { systemHealth, testIntegration } from './api';
import type { IntegrationMode, IntegrationTest, SystemHealth } from './types';
import { errorText, formatDateTime, Notice, PageHeader } from './ui';

const SCHEDULER_TONE = { running: 'success', inactive: 'warning', paused: 'warning', maintenance: 'warning', disabled: 'danger' } as const;

const MODE_LABEL: Record<IntegrationMode, { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  configured: { text: 'Configured', tone: 'success' },
  live: { text: 'Live', tone: 'success' },
  sandbox: { text: 'Sandbox — not evidence', tone: 'warning' },
  off: { text: 'Not configured', tone: 'neutral' },
};

function Reachability({ result }: { result: IntegrationTest | undefined }) {
  if (!result) return <span className="text-xs text-slate-400">Checking…</span>;
  if (result.ok === null) return <span className="text-xs text-slate-400">{result.detail}</span>;
  return (
    <span className={`text-xs ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
      {result.ok ? '● ' : '○ '}
      {result.detail}
      {result.latency_ms !== null && ` · ${result.latency_ms} ms`}
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

  return (
    <div>
      <PageHeader
        title="System health"
        lede={`The background scheduler, the job queues, recent errors, backups and every integration — over the last ${health?.window_hours ?? 24} hours.`}
        action={
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>
            {busy ? 'Checking…' : 'Check again'}
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      {health && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardLabel>Scheduler</CardLabel>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={SCHEDULER_TONE[health.scheduler.state]}>{health.scheduler.state}</Badge>
              <span className="text-sm text-slate-500">last run {formatDateTime(health.scheduler.last_run)}</span>
            </div>
            <p className="mt-3 text-sm text-slate-700">{health.scheduler.failed_count} failed scheduled job(s)</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {health.scheduler.failed_jobs.map((j) => (
                <li key={`${j.job}-${j.at}`}>
                  {j.job} · {formatDateTime(j.at)}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardLabel>Background jobs</CardLabel>
            {health.queues.available ? (
              <>
                <p className="mt-2 text-sm text-slate-700">
                  {health.queues.workers} worker{health.queues.workers === 1 ? '' : 's'} online
                </p>
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr>
                      <th className="text-left font-medium">Queue</th>
                      <th className="text-right font-medium">Waiting</th>
                      <th className="text-right font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.queues.queues.map((q) => (
                      <tr key={q.name}>
                        <td>{q.name}</td>
                        <td className="text-right">{q.queued}</td>
                        <td className={`text-right ${q.failed ? 'text-rose-600' : ''}`}>{q.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="mt-2">
                <Notice tone="error">The job queue could not be reached.</Notice>
              </div>
            )}
          </Card>

          <Card>
            <CardLabel>Errors</CardLabel>
            <p className="mt-2 text-sm text-slate-700">{health.errors.count} logged</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {health.errors.recent.map((e) => (
                <li key={`${e.title}-${e.at}`} className="truncate">
                  {formatDateTime(e.at)} · {e.title || 'Untitled error'}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardLabel>Backups</CardLabel>
            <p className="mt-2 text-sm text-slate-700">Database: {formatDateTime(health.backups.last_database)}</p>
            <p className="text-sm text-slate-700">Applicant files: {formatDateTime(health.backups.last_private_files)}</p>
            {!health.backups.includes_private_files && (
              <div className="mt-2">
                <Notice tone="warning">
                  The newest backup does not include applicant documents. A restore from it would bring
                  the Bank back without its evidence.
                </Notice>
              </div>
            )}
          </Card>

          <Card className="md:col-span-2">
            <CardLabel>Integrations</CardLabel>
            <ul className="mt-3 divide-y divide-slate-100">
              {health.integrations.map((integration) => (
                <li key={integration.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm font-medium text-slate-800">{integration.label}</span>
                  <span className="flex items-center gap-3">
                    <Reachability result={reach[integration.key]} />
                    <Badge tone={MODE_LABEL[integration.mode].tone}>{MODE_LABEL[integration.mode].text}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
