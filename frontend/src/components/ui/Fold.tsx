import type { ReactNode } from 'react';
import { ChevronDownIcon } from './icons';

/** A closed-by-default section: reference material kept one click away. */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-white shadow">
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDownIcon className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-slate-100 px-6 py-5">{children}</div>
    </details>
  );
}
