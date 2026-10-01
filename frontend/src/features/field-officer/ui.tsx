import type { ReactNode } from 'react';

/** The case page's rail parts (pages/LoanDetail) and the drawers' input class
 *  (features/underwriting/CaseDrawers), for the field officer's screens. */

export const FIELD =
  'mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

export function RailTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
      {aside}
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {children}
    </p>
  );
}

/** A dated list — the information-requests panel's row treatment. */
export function Timeline({ items, empty }: { items: { key: string; title: ReactNode; meta: ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((i) => (
        <li key={i.key} className="py-2.5">
          <p className="text-sm font-medium text-slate-800">{i.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{i.meta}</p>
        </li>
      ))}
    </ul>
  );
}
