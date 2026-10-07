/** Small pieces every administration screen shares. */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { RequiredMark } from '../../components/ui/RequiredMark';
import { roleLabel } from '../../shared/personas';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 min ago", "yesterday", "12 Sept" — for scanning a list; the exact time
 *  goes in the element's title. */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-GY', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function PageHeader({
  title,
  lede,
  action,
  eyebrow = 'Administration',
}: {
  title: string;
  lede: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">{lede}</p>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

type NoticeTone = 'success' | 'error' | 'warning' | 'info';

const NOTICE_TONES: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed ${NOTICE_TONES[tone]}`}
    >
      {children}
    </p>
  );
}

/** A white panel with an optional titled header row. */
export function Panel({
  title,
  icon,
  action,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-light text-brand [&>svg]:h-4 [&>svg]:w-4">
                {icon}
              </span>
            )}
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const STAT_TONES = {
  brand: 'bg-brand-light text-brand',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  sky: 'bg-sky-50 text-sky-600',
} as const;

/** One headline figure with what it means underneath. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {icon && (
          <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-xl [&>svg]:h-4 [&>svg]:w-4 ${STAT_TONES[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const AVATAR_TONES = [
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
];

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Initials on a colour picked from the name, so one person is always the
 *  same colour from list to panel. */
export function Avatar({ name, size = 'md', muted }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  const key = [...(name ?? '')].reduce((n, c) => n + c.charCodeAt(0), 0);
  const sizes = { sm: 'h-8 w-8 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-14 w-14 text-lg' };
  return (
    <span
      aria-hidden
      className={`flex flex-none items-center justify-center rounded-full font-bold ${sizes[size]} ${
        muted ? 'bg-slate-100 text-slate-400' : AVATAR_TONES[key % AVATAR_TONES.length]
      }`}
    >
      {initials(name)}
    </span>
  );
}

/** What each grantable role lets its holder do — shown wherever a role is
 *  chosen, so an administrator grants a job, not a word. */
export const ROLE_INFO: Record<string, { summary: string; tone: string }> = {
  'Loan Underwriter': { summary: 'Reviews applications and approves or declines them.', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  'Disbursement Officer': { summary: 'Books approved loans and releases the funds.', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  'Finance Officer': { summary: 'Reconciles repayments and reads the portfolio.', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  Facilitator: { summary: "Prepares a cluster's group application. Held alone.", tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  'Field Officer': { summary: 'Visits applicants in one region and reports. Held alone.', tone: 'bg-teal-50 text-teal-700 ring-teal-200' },
  'GDB Representative': { summary: 'Calls back and books the appointment requests from the website. Held alone.', tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  'GDB Manager': { summary: 'Reads the live GDB Team Report and its fraud review list. Held alone.', tone: 'bg-zinc-100 text-zinc-800 ring-zinc-300' },
  'Platform Admin': { summary: 'Runs this console. Can do none of the Bank’s work.', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
  'System Manager': { summary: 'ERPNext system manager.', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  Citizen: { summary: 'Applies for loans.', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export function RoleChip({ role }: { role: string }) {
  const tone = ROLE_INFO[role]?.tone ?? 'bg-slate-100 text-slate-600 ring-slate-200';
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
      {roleLabel(role)}
    </span>
  );
}

/** Role choices as cards: the name and what it allows, ticked or not. */
export function RolePicker({
  roles,
  selected,
  onToggle,
  disabled,
}: {
  roles: string[];
  selected: string[];
  onToggle: (role: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      {roles.map((role) => {
        const on = selected.includes(role);
        return (
          <label
            key={role}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
              on ? 'border-brand bg-brand-light/40 ring-1 ring-brand/30' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            } ${disabled ? 'cursor-default opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => onToggle(role)}
              disabled={disabled}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">{roleLabel(role)}</span>
              {ROLE_INFO[role] && <span className="block text-xs text-slate-500">{ROLE_INFO[role].summary}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
        enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      {enabled ? 'Active' : 'Disabled'}
    </span>
  );
}

/** A one-time password, shown to the administrator once. It lives in the
 *  caller's component state and nowhere else — never browser storage, never
 *  the URL — so closing the panel is the end of it; the server keeps no copy
 *  either. It opens nothing but the screen where its owner chooses their own. */
export function OneTimePassword({ password, detail }: { password: string; detail: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
      <p className="font-semibold">One-time password — shown only now</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all rounded-lg bg-white px-3 py-2 font-mono text-base tracking-wider text-slate-900">
          {password}
        </code>
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-relaxed">{detail}</p>
    </div>
  );
}

/** Every change an administrator makes needs a reason, and the access history
 *  keeps it. The server refuses a change without one; asking here only saves
 *  a round trip. */
export function ReasonField({
  value,
  onChange,
  disabled,
  placeholder = 'Why is this change being made?',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Reason (kept in the access history)
        <RequiredMark />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={500}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

export const hasReason = (reason: string) => reason.trim().length >= 3;

/** A filter select that sizes to its options rather than the row. */
export const selectClass =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15';

export const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50';
