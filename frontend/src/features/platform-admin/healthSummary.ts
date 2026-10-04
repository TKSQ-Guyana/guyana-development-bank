import type { SystemHealth } from './types';

export interface HealthIssue {
  severity: 'critical' | 'warning';
  text: string;
  /** Where on the health page it is explained. */
  area: 'scheduler' | 'queues' | 'errors' | 'backups';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What in a health report needs a person, most urgent first. An empty list
 *  is the "all systems operational" state. */
export function healthIssues(h: SystemHealth): HealthIssue[] {
  const out: HealthIssue[] = [];
  if (h.scheduler.state !== 'running') {
    out.push({ severity: 'critical', area: 'scheduler', text: `The background scheduler is ${h.scheduler.state}.` });
  }
  if (!h.queues.available) {
    out.push({ severity: 'critical', area: 'queues', text: 'The job queue cannot be reached.' });
  } else if (h.queues.workers === 0) {
    out.push({ severity: 'critical', area: 'queues', text: 'No background workers are online.' });
  }
  const failedJobs = h.queues.available ? h.queues.queues.reduce((n, q) => n + q.failed, 0) : 0;
  if (failedJobs) out.push({ severity: 'warning', area: 'queues', text: `${plural(failedJobs, 'background job')} failed.` });
  if (h.scheduler.failed_count) {
    out.push({ severity: 'warning', area: 'scheduler', text: `${plural(h.scheduler.failed_count, 'scheduled job')} failed.` });
  }
  if (!h.backups.last_database) {
    out.push({ severity: 'critical', area: 'backups', text: 'No database backup has been taken.' });
  } else if (!h.backups.includes_private_files) {
    out.push({ severity: 'warning', area: 'backups', text: 'The newest backup does not include applicant documents.' });
  }
  if (h.errors.count) {
    out.push({ severity: 'warning', area: 'errors', text: `${plural(h.errors.count, 'error')} logged in the last ${h.window_hours} hours.` });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}
