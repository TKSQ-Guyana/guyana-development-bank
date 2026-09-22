import type { ReactNode } from 'react';

/** Form primitives for the application wizard.
 *
 *  One place for the input styling, so the whole application reads as one
 *  instrument rather than as a screen that grew. Everything here is presentation
 *  only — no validation lives in this file, because what a bank will accept is
 *  the server's answer, not the form's. */

const controlClass =
  'w-full rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-300 transition-colors focus:border-brand focus:outline-none ' +
  'focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-500';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  /** Shown to the right of the label — e.g. "From DCRA", "Forecast". */
  tag?: string;
  children: ReactNode;
}

export function Field({ label, hint, required, tag, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">
          {label}
          {!required && <span className="ml-1.5 font-normal text-slate-400">(optional)</span>}
        </span>
        {tag && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {tag}
          </span>
        )}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  required?: boolean;
  tag?: string;
  disabled?: boolean;
  type?: string;
  inputMode?: 'numeric' | 'text' | 'tel';
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  required,
  tag,
  disabled,
  type = 'text',
  inputMode,
}: TextFieldProps) {
  return (
    <Field label={label} hint={hint} required={required} tag={tag}>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={controlClass}
      />
    </Field>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  disabled?: boolean;
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  required,
  rows = 3,
  disabled,
}: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} required={required}>
      <textarea
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} resize-y leading-relaxed`}
      />
    </Field>
  );
}

/** A money input. The currency mark sits inside the control so a figure is
 *  never ambiguous about which dollar it is — G$ and US$ differ by ~200x. */
export function MoneyField({
  label,
  value,
  onChange,
  hint,
  required,
  tag,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  required?: boolean;
  tag?: string;
}) {
  // A plain digit string travels in and out (every caller does Number(value)
  // arithmetic on it) — only the display gets thousands separators, typed as
  // free text so the browser's number-input spinner never shows on a
  // currency field.
  const display = value ? Number(value).toLocaleString('en-GY') : '';
  return (
    <Field label={label} hint={hint} required={required} tag={tag}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
          G$
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          className={`${controlClass} pl-10 text-right font-semibold tabular-nums`}
        />
      </div>
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  required,
  placeholder = 'Select…',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={controlClass}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A large, deliberate choice. Used where the answer changes what the rest of
 *  the application asks for, so it has to look like a decision rather than a
 *  radio button somebody might scroll past. */
export function ChoiceCard({
  title,
  body,
  selected,
  onSelect,
  disabled,
  note,
}: {
  title: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** The consequence of choosing this — what it commits the applicant to. */
  note?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-lg border-2 p-4 text-left transition-all ${
        selected
          ? 'border-brand bg-brand-light/40 shadow-sm shadow-brand/20'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">{title}</span>
        <span
          className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 ${
            selected ? 'border-brand bg-brand' : 'border-slate-300'
          }`}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
      </span>
      <span className="mt-1 text-xs leading-relaxed text-slate-500">{body}</span>
      {note && (
        <span className="mt-2 rounded-lg bg-slate-100/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-600">
          {note}
        </span>
      )}
    </button>
  );
}

/** A titled block within a step. Sections are lettered to match the programme
 *  specification, so an applicant on the phone to GDB and the officer reading
 *  the case are looking at the same label. */
export function Section({
  letter,
  title,
  blurb,
  children,
}: {
  letter: string;
  title: string;
  blurb?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-slate-100 pt-6 first:border-0 first:pt-0">
      <div className="mb-4 flex items-baseline gap-2.5">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-brand-light text-[11px] font-bold text-brand-text">
          {letter}
        </span>
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {blurb && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{blurb}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Advisory, never a blocker: the bank verifies, the form reports. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'good';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-sky-50/80 text-sky-800',
    warn: 'bg-amber-50/80 text-amber-800',
    good: 'bg-emerald-50/80 text-emerald-800',
  };
  return (
    <p className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${tones[tone]}`}>{children}</p>
  );
}
