export function formatGyd(amount: number): string {
  return new Intl.NumberFormat('en-GY', {
    style: 'currency',
    currency: 'GYD',
    maximumFractionDigits: 0,
  }).format(amount ?? 0);
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value.replace(' ', 'T')).toLocaleDateString('en-GY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
