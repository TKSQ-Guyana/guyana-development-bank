import { describe, expect, it } from 'vitest';
import { healthIssues } from './healthSummary';
import type { SystemHealth } from './types';
import { initials } from './ui';

const healthy: SystemHealth = {
  checked_on: '2026-10-03 10:00:00',
  window_hours: 24,
  scheduler: { state: 'running', last_run: '2026-10-03 09:59:00', failed_count: 0, failed_jobs: [] },
  queues: { available: true, workers: 2, queues: [{ name: 'default', queued: 0, failed: 0 }] },
  errors: { count: 0, recent: [] },
  backups: { last_database: '2026-10-03 02:00:00', last_private_files: '2026-10-03 02:00:00', includes_private_files: true },
  integrations: [],
};

describe('healthIssues', () => {
  it('finds nothing wrong with a healthy platform', () => {
    expect(healthIssues(healthy)).toEqual([]);
  });

  it('puts what is down before what needs a look', () => {
    const issues = healthIssues({
      ...healthy,
      errors: { count: 3, recent: [] },
      queues: { available: true, workers: 0, queues: [{ name: 'long', queued: 4, failed: 1 }] },
    });
    expect(issues.map((i) => i.severity)).toEqual(['critical', 'warning', 'warning']);
    expect(issues[0].text).toBe('No background workers are online.');
    expect(issues.map((i) => i.text)).toContain('1 background job failed.');
    expect(issues.map((i) => i.text)).toContain('3 errors logged in the last 24 hours.');
  });

  it('flags a backup without applicant documents, and no backup at all', () => {
    expect(healthIssues({ ...healthy, backups: { ...healthy.backups, includes_private_files: false } })[0].area).toBe('backups');
    expect(healthIssues({ ...healthy, backups: { ...healthy.backups, last_database: null } })[0].severity).toBe('critical');
  });
});

describe('initials', () => {
  it('takes the first and last names', () => {
    expect(initials('Kevin Ramdass')).toBe('KR');
    expect(initials('Asha Devi Persaud')).toBe('AP');
    expect(initials('madonna')).toBe('M');
    expect(initials('')).toBe('?');
  });
});
