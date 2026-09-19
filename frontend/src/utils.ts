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
