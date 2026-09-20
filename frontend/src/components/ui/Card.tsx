import type { HTMLAttributes } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-6 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{children}</p>;
}
