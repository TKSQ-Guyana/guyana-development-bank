/** Small pieces every administration screen shares. */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { RequiredMark } from '../../components/ui/RequiredMark';

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

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function PageHeader({ title, lede, action }: { title: string; lede: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{lede}</p>
      </div>
      {action}
    </div>
  );
}

type NoticeTone = 'success' | 'error' | 'warning' | 'info';

const NOTICE_TONES: Record<NoticeTone, string> = {
  success: 'bg-emerald-50 text-emerald-800',
  error: 'bg-rose-50 text-rose-700',
  warning: 'bg-amber-50 text-amber-800',
  info: 'bg-slate-100 text-slate-700',
};

export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg px-3 py-2 text-sm ${NOTICE_TONES[tone]}`}
    >
      {children}
    </p>
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
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">One-time password — shown only now</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all rounded-md bg-white px-3 py-2 font-mono text-base tracking-wider text-slate-900">
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
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
    </label>
  );
}

export const hasReason = (reason: string) => reason.trim().length >= 3;

export const inputClass =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:bg-slate-50';
