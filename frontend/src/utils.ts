/** ICU renders GYD as a bare "$" in en-GY, which reads as USD — a ~200x
 *  difference on a Guyanese loan. Format the number and carry the Guyanese
 *  dollar's own G$ mark so an amount is never ambiguous. */
export function formatGyd(amount: number): string {
  const value = amount ?? 0;
  const digits = new Intl.NumberFormat('en-GY', { maximumFractionDigits: 0 }).format(
    Math.abs(value),
  );
  return `${value < 0 ? '-' : ''}G$${digits}`;
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value.replace(' ', 'T')).toLocaleDateString('en-GY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

import type { UseOfFundsRow } from './types';

/** The funding step's use-of-funds table round-trips through the same
 *  Small Text field a free-text draft used to hold — JSON out, JSON back in.
 *  A pre-existing plain-text value (or anything malformed) parses to `null`
 *  rather than throwing, so an older application still displays as text. */
export function encodeUseOfFunds(rows: UseOfFundsRow[]): string {
  const named = rows.filter((r) => r.item.trim());
  return named.length ? JSON.stringify(named) : '';
}

export function parseUseOfFunds(raw: string | number | null | undefined): UseOfFundsRow[] | null {
  if (typeof raw !== 'string' || !raw.trim().startsWith('[')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((r) => r && typeof r.item === 'string' && typeof r.amount === 'number')) {
      return null;
    }
    return parsed as UseOfFundsRow[];
  } catch {
    return null;
  }
}

/** How long a case has sat since `value`, for a queue row — "today", "3 days",
 *  "2 months". Not a countdown and not a promise: it tells an underwriter
 *  which end of the queue is going stale, nothing more precise than that. */
export function formatAge(value: string | null): string {
  if (!value) return '—';
  const then = new Date(value.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'}`;
}
