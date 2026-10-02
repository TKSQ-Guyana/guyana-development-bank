import type { ContactAttempt, DeskRow, DeskTab, VisitCheck } from '../types';

/** The Field Officer's rules that are not the server's to answer: which list a
 *  queue row sits in, what the officer does next on it, and what still stands
 *  between a field report and the Loan Officer. Pure, so the screens stay thin
 *  and the rules are tested once (desk.test.ts). The server still decides —
 *  a row's status and every refusal come from gdb_bank.field_officer. */

export type Bucket = 'action' | 'waiting' | 'done';

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'action', label: 'To do' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
];

/** What the officer does next on a row: a button, or why there is nothing to do. */
export type Next = { cta: string; secondary?: boolean } | { wait: string };

const ASSIST: Record<string, [Bucket, Next]> = {
  Waiting: ['action', { cta: 'Review & accept' }],
  Accepted: ['action', { cta: 'Contact applicant' }],
  'Visit booked': ['action', { cta: 'View details', secondary: true }],
};

const ASSISTED: Record<string, [Bucket, Next]> = {
  'In progress': ['action', { cta: 'Finish application' }],
  'Waiting for consent': ['waiting', { wait: 'Applicant to allow access' }],
  'Waiting for applicant': ['waiting', { wait: 'Applicant to review & submit' }],
  Submitted: ['waiting', { wait: 'With GDB for assessment' }],
};

/** A task row's kind rides at the front of `what` ("Site Visit · ACC-LOAP-…"). */
export function taskKind(row: Pick<DeskRow, 'what'>): 'Site Visit' | 'Reference Check' {
  return row.what.startsWith('Reference Check') ? 'Reference Check' : 'Site Visit';
}

/** A task row's case reference, from the same `what`. */
export function taskCase(row: Pick<DeskRow, 'what'>): string {
  return row.what.split(' · ')[1] ?? '';
}

function classify(tab: DeskTab, row: DeskRow): [Bucket, Next] {
  if (tab === 'assist') return ASSIST[row.status] ?? ['done', { wait: 'Resolved' }];
  if (tab === 'assisted') return ASSISTED[row.status] ?? ['done', { wait: row.status }];
  if (row.status === 'Open') return ['action', { cta: 'Accept task' }];
  if (row.status === 'Accepted') return ['action', { cta: taskKind(row) === 'Site Visit' ? 'Finish visit' : 'Finish calls' }];
  return ['done', { wait: row.status === 'Submitted' ? 'Report with Loan Officer' : row.status }];
}

export const bucketOf = (tab: DeskTab, row: DeskRow): Bucket => classify(tab, row)[0];
export const nextStep = (tab: DeskTab, row: DeskRow): Next => classify(tab, row)[1];

export type Since = 'any' | 'today' | 'week';
export const SINCE: { id: Since; label: string }[] = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
];

/** The queue's search box and date filter. `now` is passed so a test can pin it. */
export function matches(row: DeskRow, q: string, since: Since, now = Date.now()): boolean {
  const needle = q.trim().toLowerCase();
  if (needle && ![row.who, row.name, row.what, row.eid].some((v) => v?.toLowerCase().includes(needle))) return false;
  if (since === 'any' || !row.on) return since === 'any';
  const days = (now - new Date(row.on.replace(' ', 'T')).getTime()) / 86_400_000;
  return since === 'today' ? new Date(row.on.replace(' ', 'T')).toDateString() === new Date(now).toDateString() : days <= 7;
}

// -- the field report ---------------------------------------------------------

export const REFERENCES_NEEDED = 2;

/** One thing still missing from a report, and the part of the screen it lives in. */
export interface Gap {
  label: string;
  where: string;
}

export interface VisitDraft {
  checks: VisitCheck[];
  pinned: boolean;
  photos: number;
  findings: string;
}

/** What stops a site visit being submitted. Mirrors services.field_operations
 *  ._report_gaps, plus one rule of the officer's own screen: a "No" is explained. */
export function visitGaps(d: VisitDraft): Gap[] {
  const gaps: Gap[] = [];
  d.checks.forEach((c, i) => {
    if (!c.result) gaps.push({ label: `Check ${i + 1} not answered`, where: 'Checklist' });
    else if (c.result === 'No' && !c.note?.trim()) gaps.push({ label: `Check ${i + 1} needs a note for "No"`, where: 'Checklist' });
  });
  if (!d.photos) gaps.push({ label: 'At least one photo', where: 'Photos' });
  if (!d.pinned) gaps.push({ label: 'Captured location', where: 'Location' });
  if (!d.findings.trim()) gaps.push({ label: 'Summary of what you saw', where: 'Summary' });
  return gaps;
}

/** What stops a reference check being submitted. Mirrors ._report_gaps. */
export function referenceGaps(calls: ContactAttempt[]): Gap[] {
  const named = calls.filter((c) => c.contact_name?.trim());
  const key = (c: ContactAttempt) => (c.contact_name ?? '').trim().toLowerCase();
  const gaps: Gap[] = [];
  if (new Set(named.map(key)).size < REFERENCES_NEEDED) gaps.push({ label: `Call ${REFERENCES_NEEDED} references`, where: 'References' });
  named
    .filter((c) => c.result === 'Reached' && !c.verdict)
    .forEach((c) => gaps.push({ label: `Verdict for ${c.contact_name!.trim()}`, where: 'References' }));
  if (!named.some((c) => c.result === 'Reached')) gaps.push({ label: 'Reach at least one reference', where: 'References' });
  return gaps;
}

/** The visit details a "Visit booked" outcome carries — the request keeps them
 *  as its outcome note, so they read back exactly as the officer booked them. */
export function visitNote(v: { date: string; time: string; place: string; bring: string[] }): string {
  // Written out in words: the note is read back as text, not parsed.
  const when = new Date(`${v.date}T${v.time || '00:00'}`);
  const day = when.toLocaleDateString('en-GY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const hour = v.time ? when.toLocaleTimeString('en-GY', { hour: 'numeric', minute: '2-digit' }) : '';
  return [
    `When: ${[day, hour].filter(Boolean).join(', ')}`,
    `Where: ${v.place.trim()}`,
    v.bring.length ? `Bring: ${v.bring.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Whether a Field Officer, not the applicant, put this application before
 *  GDB (field_operations.submit_for records them as gdb_submitted_by). The tag
 *  every screen shows for it reads this, so they all agree. */
export function submittedByOfficer(loan: { submitted_by?: string | null; applicant?: string | null }): boolean {
  return Boolean(loan.submitted_by && loan.applicant && loan.submitted_by !== loan.applicant);
}

export const OFFICER_SUBMITTED = 'Submitted by Field Officer';

/** The loan an assist request is about, as staff name it (quick_loan.FIELD_OFFICER_PRODUCTS). */
export function productLabel(product: string | null | undefined): string {
  return product === 'Quick' ? 'Quick Loan' : product === 'Standard' ? 'SME Loan' : product || '—';
}

/** Whether a task holds a real pin. Frappe stores an unset Float as 0, so a
 *  task nobody pinned reads back as 0, 0 — a point in the Atlantic, not Guyana. */
export function hasPin(lat: number | null | undefined, lon: number | null | undefined): boolean {
  return lat != null && lon != null && !(lat === 0 && lon === 0);
}

/** An OpenStreetMap link — the pin needs no map library to be checked. */
export function mapLink(lat: number, lon: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

