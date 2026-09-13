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
