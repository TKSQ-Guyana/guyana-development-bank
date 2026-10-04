import type { ReactNode } from "react";
import { PhoneInput } from "../PhoneInput";
import { RequiredMark } from "../ui/RequiredMark";

/** Form primitives for the application wizard.
 *
 *  One place for the input styling, so the whole application reads as one
 *  instrument rather than as a screen that grew. Everything here is presentation
 *  only — no validation lives in this file, because what a bank will accept is
 *  the server's answer, not the form's. */

const controlClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 " +
  "placeholder:text-slate-400 transition-colors hover:border-slate-400 focus:border-brand focus:outline-none " +
  "focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-500";

/** A value GDB fetched rather than asked for.
 *
 *  Grey ground and no white input box, because a white box with a border is
 *  the portal's promise that you may type in it — and these are the State's
 *  record, not the applicant's answer. The specification is explicit that
 *  registry values appear "as confirmed read-only values with the confirming
 *  agency and last-checked time", and that an applicant who thinks a line is
 *  wrong reports it rather than overwriting the source.
 */
const readOnlyClass =
  "w-full rounded-lg border border-transparent bg-slate-100 px-3.5 py-2.5 text-sm " +
  "font-medium text-slate-600";

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
        <span className="text-[13px] font-bold text-slate-800">
          {label}
          {required && <RequiredMark />}
        </span>
        {tag && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {tag}
          </span>
        )}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">
          {hint}
        </span>
      )}
    </label>
  );
}

/** One value GDB got from somewhere else, shown as read-only and attributed.
 *
 *  `source` names the authority — "Confirmed by DCRA", "From your e-ID" — so
 *  the applicant can see WHY a line cannot be edited, and `checked` carries
 *  when it was last looked up. A value with no attribution should not use this
 *  component: "you cannot change this" without "and here is who says so" is
 *  the thing the specification warns against.
 */
export function ReadOnlyField({
  label,
  value,
  source,
  checked,
  hint,
}: {
  label: string;
  value: ReactNode;
  source: string;
  checked?: string | null;
  hint?: ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {source}
        </span>
      </span>
      <p className={readOnlyClass}>
        {value || <span className="text-slate-400">Not held</span>}
      </p>
      {(hint || checked) && (
        <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">
          {hint}
          {hint && checked ? " · " : ""}
          {checked ? `Checked ${checked}` : ""}
        </span>
      )}
    </div>
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
  inputMode?: "numeric" | "text" | "tel";
  /** Bounds for a date or number, e.g. no date after today. */
  min?: string;
  max?: string;
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
  type = "text",
  inputMode,
  min,
  max,
}: TextFieldProps) {
  return (
    <Field label={label} hint={hint} required={required} tag={tag}>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={controlClass}
      />
    </Field>
  );
}

/** A Guyana phone number in this form's style: "+592" shown, seven digits typed. */
export function PhoneField({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      <PhoneInput value={value} onChange={onChange} className={controlClass} />
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
  /** Character limit, shown as a running count under the box. */
  max?: number;
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
  max,
}: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} required={required}>
      <textarea
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} resize-y leading-relaxed`}
      />
      {max && (
        <span className="mt-0.5 block text-right text-[11px] tabular-nums text-slate-400">
          {value.length.toLocaleString("en-GY")} / {max.toLocaleString("en-GY")}
        </span>
      )}
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
  const display = value ? Number(value).toLocaleString("en-GY") : "";
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
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
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
  placeholder = "Select…",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Plain values, or [value, label] where what is shown differs. */
  options: (string | [string, string])[];
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={controlClass}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
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
  body?: string;
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
      aria-pressed={selected}
      className={`flex w-full flex-col rounded-xl border-2 px-4 py-3 text-left transition-all ${
        selected
          ? "border-brand bg-emerald-50/70 shadow-[0_6px_20px_-12px_rgba(4,120,87,0.6)]"
          : "border-slate-200 bg-white hover:-translate-y-px hover:border-emerald-300 hover:shadow-sm"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">{title}</span>
        <span
          className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition-colors ${
            selected ? "border-brand bg-brand" : "border-slate-300 bg-white"
          }`}
        >
          {selected && (
            <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" aria-hidden>
              <path
                d="M2.5 6.2 5 8.5l4.5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>
      {body && (
        <span className="mt-1 text-xs leading-relaxed text-slate-500">
          {body}
        </span>
      )}
      {note && (
        <span className="mt-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
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
    <section className="border-t border-dashed border-slate-200 pt-5 first-of-type:border-0 first-of-type:pt-0">
      <div className="mb-3.5 flex items-start gap-2.5">
        <span className="flex h-6 min-w-6 flex-none items-center justify-center rounded-md bg-emerald-100 px-1.5 text-[11px] font-black text-brand-dark">
          {letter}
        </span>
        <div>
          <h3 className="text-[15px] font-extrabold leading-6 text-slate-900">
            {title}
          </h3>
          {blurb && (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {blurb}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Advisory, never a blocker: the bank verifies, the form reports. */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "good";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-sky-50/80 text-sky-800",
    warn: "bg-amber-50/80 text-amber-800",
    good: "bg-emerald-50/80 text-emerald-800",
  };
  return (
    <p
      className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${tones[tone]}`}
    >
      {children}
    </p>
  );
}
