import { describe, expect, it } from 'vitest';
import { formatDate } from './utils';

// Guyana is UTC-4: where "2000-01-26" read as midnight UTC became 25 Jan.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/Guyana';

describe('formatDate', () => {
  it('shows a date-only value as that calendar day', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Guyana');
    expect(formatDate('2000-01-26')).toBe('26 Jan 2000');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('still reads a date with a time as local time', () => {
    expect(formatDate('2026-10-05 14:30:00')).toBe('5 Oct 2026');
  });

  it('shows a dash for nothing', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});
