/** Line icons only the administration console uses — same 20x20 grid and
 *  currentColor stroke as components/ui/icons. */

type IconProps = { className?: string };
const base = 'h-5 w-5';
const stroke = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ShieldIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M10 2.5 4 5v4.5c0 3.6 2.5 6.6 6 8 3.5-1.4 6-4.4 6-8V5l-6-2.5Z" {...stroke} />
      <path d="m7.5 10 1.8 1.8L12.8 8.3" {...stroke} />
    </svg>
  );
}

export function KeyIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="7" cy="12.5" r="3.5" {...stroke} />
      <path d="m9.5 10 6-6M13.5 6l2 2M12 7.5l1.5 1.5" {...stroke} />
    </svg>
  );
}

export function ServerIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <rect x="3" y="3.5" width="14" height="5" rx="1.5" {...stroke} />
      <rect x="3" y="11.5" width="14" height="5" rx="1.5" {...stroke} />
      <path d="M6 6h.01M6 14h.01" {...stroke} strokeWidth={2.2} />
    </svg>
  );
}

export function AlertIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M10 3 2.5 16h15L10 3Z" {...stroke} />
      <path d="M10 8v3.5M10 13.8h.01" {...stroke} />
    </svg>
  );
}

export function DatabaseIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <ellipse cx="10" cy="5" rx="6" ry="2.5" {...stroke} />
      <path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" {...stroke} />
    </svg>
  );
}

export function PlugIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0v-3ZM10 14.5v3" {...stroke} />
    </svg>
  );
}

export function SearchIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="9" cy="9" r="5.5" {...stroke} />
      <path d="m13 13 4 4" {...stroke} />
    </svg>
  );
}

export function ChevronRightIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="m8 5 5 5-5 5" {...stroke} />
    </svg>
  );
}

export function RefreshIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3" {...stroke} />
    </svg>
  );
}
