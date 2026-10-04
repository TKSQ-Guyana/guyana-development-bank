import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MapPinIcon, PlusIcon, SlidersIcon, UsersIcon } from '../../components/ui/icons';
import { accessHistory } from './api';
import { KeyIcon, SearchIcon, ShieldIcon } from './icons';
import type { AccessChange, AccessHistoryPage as HistoryPage } from './types';
import { roleLabel } from '../../shared/personas';
import { errorText, formatDateTime, inputClass, Notice, Panel, PageHeader, relativeTime, selectClass } from './ui';

const PAGE = 50;

/** How each kind of entry is drawn: an icon on a colour, and the verb. */
const ACTIONS: Record<string, { icon: ReactNode; tone: string; verb: string }> = {
  'Account Created': { icon: <PlusIcon />, tone: 'bg-emerald-100 text-emerald-700', verb: 'created the account' },
  'Roles Changed': { icon: <ShieldIcon />, tone: 'bg-sky-100 text-sky-700', verb: 'changed the roles of' },
  'Account Disabled': { icon: <UsersIcon />, tone: 'bg-rose-100 text-rose-700', verb: 'disabled' },
  'Account Enabled': { icon: <UsersIcon />, tone: 'bg-emerald-100 text-emerald-700', verb: 'enabled' },
  'Region Changed': { icon: <MapPinIcon />, tone: 'bg-teal-100 text-teal-700', verb: 'changed the region of' },
  'One-Time Password Issued': { icon: <KeyIcon />, tone: 'bg-amber-100 text-amber-700', verb: 'issued a one-time password for' },
  'Set-Password Email Sent': { icon: <KeyIcon />, tone: 'bg-amber-100 text-amber-700', verb: 'sent a set-password email to' },
  'Password Chosen': { icon: <KeyIcon />, tone: 'bg-slate-100 text-slate-600', verb: 'chose their own password for' },
  'Integration Settings Changed': { icon: <SlidersIcon />, tone: 'bg-violet-100 text-violet-700', verb: 'changed the settings of' },
};
const FALLBACK = { icon: <SlidersIcon />, tone: 'bg-slate-100 text-slate-600', verb: '' };

/** A recorded value as the portal names it — roles under their shown names. */
function readable(value: string): string {
  return value
    .split(/(,\s*|\n)/)
    .map((part) => roleLabel(part))
    .join('');
}

/** One entry of the access trail: who did what to whom, before and after,
 *  and why. Also used on the overview. */
export function ChangeLine({ row, compact }: { row: AccessChange; compact?: boolean }) {
  const style = ACTIONS[row.action] ?? FALLBACK;
  // "uday chose their own password" — not "… for uday" — when the person
  // acted on their own account.
  const self = row.actor === row.subject;
  return (
    <li className={`flex gap-3 ${compact ? 'py-3' : 'py-4'}`}>
      <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full [&>svg]:h-4 [&>svg]:w-4 ${style.tone}`}>
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-900">{row.actor}</span>{' '}
            {self && row.action === 'Password Chosen' ? (
              'chose their own password'
            ) : (
              <>
                {style.verb || row.action.toLowerCase()}{' '}
                <span className="font-semibold text-slate-900">{row.subject}</span>
              </>
            )}
          </p>
          <time className="text-xs text-slate-400" dateTime={row.acted_on} title={formatDateTime(row.acted_on)}>
            {compact ? relativeTime(row.acted_on) : formatDateTime(row.acted_on).split(', ').pop()}
          </time>
        </div>
        {(row.old_value || row.new_value) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {/* What it WAS and what it BECAME — the whole point of an audit line. */}
            {row.old_value && (
              <span className="whitespace-pre-line rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through decoration-rose-300">
                {readable(row.old_value)}
              </span>
            )}
            {row.old_value && row.new_value && <span className="text-slate-300">→</span>}
            {row.new_value && (
              <span className="whitespace-pre-line rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{readable(row.new_value)}</span>
            )}
          </div>
        )}
        {row.reason && !compact && (
          <p className="mt-1.5 border-l-2 border-slate-200 pl-2.5 text-xs italic text-slate-500">“{row.reason}”</p>
        )}
      </div>
    </li>
  );
}

function dayLabel(value: string): string {
  const date = new Date(value.replace(' ', 'T'));
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-GY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Every account and settings change: who, what, before, after, when, why.
 *  Read-only here and append-only on the server — nobody, administrators
 *  included, can edit or delete an entry. */
export function AccessHistoryPage() {
  const [start, setStart] = useState(0);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    accessHistory(start)
      .then(setPage)
      .catch((err) => setError(errorText(err, 'Could not load the access history.')));
  }, [start]);

  // Narrowing within the loaded page: the trail is read newest first, and the
  // question is nearly always about the last few days.
  const rows = useMemo(() => {
    const term = text.trim().toLowerCase();
    return (page?.rows ?? []).filter(
      (r) =>
        (!kind || r.action === kind) &&
        (!term || [r.actor, r.subject, r.reason, r.old_value, r.new_value].some((v) => (v ?? '').toLowerCase().includes(term))),
    );
  }, [page, kind, text]);

  const days = useMemo(() => {
    const out: { day: string; rows: AccessChange[] }[] = [];
    rows.forEach((r) => {
      const day = dayLabel(r.acted_on);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(r);
    });
    return out;
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Access history"
        lede="Every account and integration change made in this console, with the reason given. Entries cannot be edited or deleted — by anyone."
      />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search the history</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by person, account, reason or value"
            className={`${inputClass} pl-9`}
          />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of change" className={`${selectClass} flex-1 sm:flex-none`}>
          <option value="">All changes</option>
          {Object.keys(ACTIONS).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <Panel bodyClassName="px-5 py-2">
        {!page && !error && <p className="py-4 text-sm text-slate-400">Loading…</p>}
        {page && days.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            {page.rows.length ? 'No change on this page matches.' : 'No changes recorded yet.'}
          </p>
        )}
        {days.map((group) => (
          <section key={group.day}>
            <h2 className="-mx-5 border-y border-slate-100 bg-slate-50 px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 first:border-t-0">
              {group.day}
            </h2>
            <ul className="divide-y divide-slate-100">
              {group.rows.map((row) => (
                <ChangeLine key={row.name} row={row} />
              ))}
            </ul>
          </section>
        ))}
        {page && (start > 0 || page.has_more) && (
          <div className="-mx-5 mt-2 flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <span className="text-xs text-slate-500">
              Entries {start + 1}–{start + page.rows.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={start === 0}
                onClick={() => setStart(Math.max(0, start - PAGE))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Newer
              </button>
              <button
                type="button"
                disabled={!page.has_more}
                onClick={() => setStart(start + PAGE)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Older
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
