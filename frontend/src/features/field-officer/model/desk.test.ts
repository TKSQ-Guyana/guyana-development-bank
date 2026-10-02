import { describe, expect, it } from 'vitest';
import type { CallResult, ContactAttempt, DeskRow, Verdict, VisitCheck } from '../types';
import {
  bucketOf,
  hasPin,
  matches,
  nextStep,
  productLabel,
  referenceGaps,
  submittedByOfficer,
  taskCase,
  taskKind,
  visitGaps,
  visitNote,
} from './desk';

const row = (over: Partial<DeskRow>): DeskRow => ({
  name: 'R-1',
  who: 'S*** M.',
  what: '',
  region: 'Region 6',
  status: 'Waiting',
  on: '2026-10-02 09:00:00',
  mine: false,
  ...over,
});

describe('the queue', () => {
  it('puts an unclaimed request in the officer’s action list', () => {
    expect(bucketOf('assist', row({}))).toBe('action');
    expect(nextStep('assist', row({}))).toEqual({ cta: 'Review & accept' });
  });

  it('treats a resolved request as done', () => {
    for (const status of ['Helped remotely', 'Application started', "Couldn't reach", 'Closed']) {
      expect(bucketOf('assist', row({ status }))).toBe('done');
    }
  });

  it('waits on the applicant once access is asked or the draft is handed back', () => {
    expect(bucketOf('assisted', row({ status: 'Waiting for consent' }))).toBe('waiting');
    expect(bucketOf('assisted', row({ status: 'Waiting for applicant' }))).toBe('waiting');
    expect(bucketOf('assisted', row({ status: 'In progress' }))).toBe('action');
    expect(bucketOf('assisted', row({ status: 'Expired' }))).toBe('done');
  });

  it('reads a task’s kind and case off the row', () => {
    const t = row({ what: 'Reference Check · ACC-LOAP-2026-00012', status: 'Accepted' });
    expect(taskKind(t)).toBe('Reference Check');
    expect(taskCase(t)).toBe('ACC-LOAP-2026-00012');
    expect(nextStep('tasks', t)).toEqual({ cta: 'Finish calls' });
    expect(bucketOf('tasks', row({ status: 'Submitted' }))).toBe('done');
  });

  it('filters by name, reference and date', () => {
    const now = new Date('2026-10-02T15:00:00').getTime();
    expect(matches(row({}), 's*** m', 'any', now)).toBe(true);
    expect(matches(row({}), 'r-1', 'today', now)).toBe(true);
    expect(matches(row({}), 'nobody', 'any', now)).toBe(false);
    expect(matches(row({ on: '2026-09-20 09:00:00' }), '', 'week', now)).toBe(false);
    expect(matches(row({ on: null }), '', 'today', now)).toBe(false);
  });
});

describe('the field report', () => {
  const checks = (results: VisitCheck['result'][]): VisitCheck[] =>
    results.map((result, i) => ({ item: `c${i}`, result, note: null }));

  it('lists everything a site visit still needs', () => {
    const gaps = visitGaps({ checks: checks(['Yes', '', 'No']), pinned: false, photos: 0, findings: ' ' });
    expect(gaps.map((g) => g.label)).toEqual([
      'Check 2 not answered',
      'Check 3 needs a note for "No"',
      'At least one photo',
      'Captured location',
      'Summary of what you saw',
    ]);
  });

  it('is clear when the visit is complete', () => {
    expect(visitGaps({ checks: checks(['Yes', 'N/A']), pinned: true, photos: 1, findings: 'Trading.' })).toEqual([]);
  });

  it('needs two distinct references, one reached, every reached one judged', () => {
    const call = (contact_name: string, result: CallResult, verdict: Verdict | '' = ''): ContactAttempt => ({
      attempted_on: '',
      contact_name,
      result,
      verdict,
    });
    expect(referenceGaps([call('Ann', 'No answer'), call('ann ', 'No answer')]).map((g) => g.label)).toEqual([
      'Call 2 references',
      'Reach at least one reference',
    ]);
    expect(referenceGaps([call('Ann', 'Reached'), call('Bo', 'No answer')]).map((g) => g.label)).toEqual(['Verdict for Ann']);
    expect(referenceGaps([{ ...call('Ann', 'Reached'), verdict: 'Positive' }, call('Bo', 'No answer')])).toEqual([]);
  });

  it('writes a booked visit as the outcome note, the date in words', () => {
    const [when, where, bring] = visitNote({ date: '2026-10-03', time: '10:30', place: ' Her home ', bring: ['e-ID card'] }).split('\n');
    expect(when).toMatch(/^When: .*3.*Oct.*2026.*10:30/);
    expect(when).not.toContain('2026-10-03');
    expect(where).toBe('Where: Her home');
    expect(bring).toBe('Bring: e-ID card');
  });

  it('treats an unset Frappe Float (0, 0) as no pin', () => {
    expect(hasPin(0, 0)).toBe(false);
    expect(hasPin(null, null)).toBe(false);
    expect(hasPin(8.2, -59.78)).toBe(true);
  });

  it('tags an application only when someone other than the applicant submitted it', () => {
    expect(submittedByOfficer({ applicant: 'a@x', submitted_by: 'officer@gdb.gy' })).toBe(true);
    expect(submittedByOfficer({ applicant: 'a@x', submitted_by: 'a@x' })).toBe(false);
    expect(submittedByOfficer({ applicant: 'a@x', submitted_by: null })).toBe(false);
  });

  it('names the loan an assist request is about', () => {
    expect(productLabel('Quick')).toBe('Quick Loan');
    expect(productLabel('Standard')).toBe('SME Loan');
    expect(productLabel(null)).toBe('—');
  });
});
