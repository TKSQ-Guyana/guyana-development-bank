interface BadgeProps {
  children: React.ReactNode;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
}

const TONES: Record<NonNullable<BadgeProps['tone']>, string> = {
  brand: 'bg-brand-light text-brand-text',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-600',
  neutral: 'bg-slate-100 text-slate-600',
};

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
