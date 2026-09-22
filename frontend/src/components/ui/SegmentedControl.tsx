import type { ReactNode } from 'react';

interface SegmentedControlProps<T extends string> {
  // ReactNode (not just string) so a tab can carry a small badge — e.g. a
  // dot marking a decision still waiting on it — without a second component.
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-white p-1 shadow-[0_8px_30px_-12px_rgba(46,26,107,0.15)]">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            value === opt.id ? 'bg-brand text-white' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
