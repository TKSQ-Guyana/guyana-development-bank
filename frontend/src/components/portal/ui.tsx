import { useState, type ReactNode } from "react";
import { useFocusOnError } from "../../shared/FocusAlert";
import { CheckIcon, ChevronDownIcon } from "../ui/icons";

/** The Quick Loan flow's own building blocks, in the portal's forest-and-gold
 *  design. Presentation only — every rule stays in model/quickLoan.ts and on
 *  the server. Colours are the `ql-*` and brand tokens, read inside
 *  `.theme-citizen`. */

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

/** A screen's card. Always the full width of the page: the layout's own
 *  max width is the only cap, so no Quick Loan screen sits in a column. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-xs sm:px-6 sm:py-5">
      {children}
    </div>
  );
}

export function PageIntro({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <h1 className="text-xl font-black leading-tight tracking-tight text-slate-900 sm:text-2xl">
        {title}
      </h1>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
    </div>
  );
}

/** A section's heading: its number, its name, where the draft stands, and one
 *  line on what it asks. */
export function SecHead({
  title,
  meta,
  intro,
  index,
}: {
  title: string;
  meta?: ReactNode;
  intro?: string;
  /** The step's number on the rail, drawn as a badge. */
  index?: number;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 pb-3.5">
      {index != null && (
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-dark text-sm font-black text-amber-300 ring-4 ring-emerald-50">
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-black leading-tight tracking-tight text-slate-900">
          {title}
        </h2>
        {intro && <p className="mt-0.5 text-[13px] text-slate-500">{intro}</p>}
        {meta && <div className="mt-2 text-xs text-slate-400">{meta}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-base font-extrabold leading-tight text-slate-900">
      {children}
    </h3>
  );
}

export function Card({
  tone,
  className,
  children,
}: {
  tone?: "tint" | "soft";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3",
        tone === "tint"
          ? "border-emerald-200 bg-emerald-50/70"
          : tone === "soft"
            ? "border-slate-200 bg-slate-50"
            : "border-slate-200 bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

type Tone = "blue" | "green" | "amber" | "red" | "grey";
const PILL: Record<Tone, string> = {
  // "blue" is the verified-source tone (e-ID, Profile) — green in this theme.
  blue: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  green: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function Pill({
  tone = "grey",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold ring-1",
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

type BannerKind = "info" | "warn" | "error" | "success";
const BANNER: Record<BannerKind, [string, string, string]> = {
  info: ["border-sky-200 border-l-sky-500 bg-sky-50", "bg-sky-600", "i"],
  warn: [
    "border-amber-200 border-l-amber-500 bg-amber-50",
    "bg-amber-500",
    "!",
  ],
  error: ["border-rose-200 border-l-rose-500 bg-rose-50", "bg-rose-600", "!"],
  success: [
    "border-emerald-200 border-l-emerald-600 bg-emerald-50",
    "bg-emerald-600",
    "",
  ],
};

export function Banner({
  kind,
  title,
  children,
  action,
}: {
  kind: BannerKind;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const [box, dot, glyph] = BANNER[kind];
  // An error takes the focus as it appears (shared/FocusAlert).
  const errorRef = useFocusOnError<HTMLDivElement>(
    kind === "error" ? title : null,
  );
  return (
    <div
      ref={errorRef}
      tabIndex={kind === "error" ? -1 : undefined}
      className={cx(
        "flex items-start gap-2.5 rounded-xl border border-l-4 px-3.5 py-2.5 outline-none",
        box,
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      <span
        className={cx(
          "grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold text-white",
          dot,
        )}
      >
        {kind === "success" ? <CheckIcon className="h-3.5 w-3.5" /> : glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold leading-snug text-slate-900">
          {title}
        </div>
        {children && (
          <div className="mt-0.5 text-[13px] text-slate-600">{children}</div>
        )}
      </div>
      {action && (
        <div className="flex flex-none items-center gap-2">{action}</div>
      )}
    </div>
  );
}

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";
const BUTTON: Record<ButtonKind, string> = {
  // Gold is the way on — the one action each screen exists for.
  primary:
    "border-transparent bg-gradient-to-r from-amber-400 to-amber-500 font-extrabold text-emerald-950 shadow-md shadow-amber-900/10 hover:-translate-y-0.5 hover:from-amber-300 hover:to-amber-400 disabled:translate-y-0 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none",
  secondary:
    "border-slate-200 bg-white font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  ghost: "border-transparent px-2 font-semibold text-brand hover:bg-emerald-50",
  danger:
    "border-transparent bg-rose-600 font-bold text-white hover:bg-rose-700",
};

export function QButton({
  kind = "primary",
  sm,
  back,
  next,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: ButtonKind;
  sm?: boolean;
  /** A leading chevron, for Back. */
  back?: boolean;
  next?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border transition-all disabled:cursor-not-allowed",
        kind !== "primary" && "disabled:opacity-45",
        sm ? "h-8 px-3.5 text-[13px]" : "h-10 px-4 text-sm sm:px-5",
        BUTTON[kind],
        className,
      )}
      {...rest}
    >
      {back && <ChevronDownIcon className="h-4 w-4 rotate-90" />}
      {children}
      {next && <ChevronDownIcon className="h-4 w-4 -rotate-90" />}
    </button>
  );
}

export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-2 py-1 text-[13px] font-bold text-brand hover:bg-emerald-50 hover:text-brand-dark"
    >
      {children}
    </button>
  );
}

/* ---------- Fields ---------- */

export const inputClass = (bad?: boolean) =>
  cx(
    "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:outline-none",
    bad
      ? "border-rose-400 ring-4 ring-rose-100"
      : "border-slate-300 hover:border-slate-400 focus:border-brand focus:ring-4 focus:ring-emerald-100",
  );

export function QField({
  label,
  required,
  help,
  helpFirst,
  error,
  tag,
  children,
}: {
  label: string;
  required?: boolean;
  help?: ReactNode;
  /** Long answers read their help before the box, as the prototype does. */
  helpFirst?: boolean;
  error?: string | null;
  tag?: ReactNode;
  children: ReactNode;
}) {
  const hint = help && (
    <div className="text-xs leading-snug text-slate-500">{help}</div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-slate-800">
          {label}
          {required && <span className="ml-0.5 text-rose-500"> *</span>}
        </span>
        {tag}
      </div>
      {helpFirst && hint}
      {children}
      {!helpFirst && hint}
      {error && (
        <div className="text-[12.5px] font-semibold text-rose-600">{error}</div>
      )}
    </div>
  );
}

export function QReadOnly({
  label,
  value,
  source,
}: {
  label: string;
  value: ReactNode;
  source: string;
}) {
  return (
    <QField label={label} tag={<Pill tone="blue">✓ {source}</Pill>}>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
        <LockGlyph />
        {value || <span className="text-slate-400">Not held</span>}
      </div>
    </QField>
  );
}

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5 flex-none text-slate-400"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
      />
    </svg>
  );
}

export function QTextArea({
  value,
  onChange,
  max = 1000,
  bad,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: number;
  bad?: boolean;
  placeholder?: string;
}) {
  return (
    <>
      <textarea
        rows={2}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          inputClass(bad),
          "h-auto min-h-[72px] resize-y py-2 leading-relaxed",
        )}
      />
      <div className="-mt-0.5 text-right text-[10.5px] text-slate-400">
        {value.length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
      </div>
    </>
  );
}

export function QSelect({
  value,
  onChange,
  options,
  placeholder,
  bad,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | [string, string])[];
  placeholder: string;
  bad?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(inputClass(bad), "pr-9")}
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
  );
}

/** One answer from a short closed list, as tappable chips. */
export function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o)}
            className={cx(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-all",
              on
                ? "border-brand-dark bg-brand-dark text-white shadow-sm shadow-emerald-950/20"
                : "border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50",
            )}
          >
            {on && <CheckIcon className="h-3.5 w-3.5 text-amber-300" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] transition-colors",
        checked
          ? "border-emerald-300 bg-emerald-50/70"
          : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 transition-all peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-100",
          checked
            ? "border-brand-dark bg-brand-dark text-amber-300"
            : "border-slate-300 bg-white",
        )}
      >
        {checked && <CheckIcon className="h-3.5 w-3.5" />}
      </span>
      <span className="leading-relaxed text-slate-700">{children}</span>
    </label>
  );
}

/** A large either/or choice — a radio drawn as a card. */
export function RadioCard({
  title,
  body,
  meta,
  badge,
  icon,
  selected,
  onSelect,
}: {
  title: string;
  body?: string;
  /** A line of terms above the body, in the darker ink. */
  meta?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cx(
        "group relative flex cursor-pointer items-start gap-3 rounded-xl border bg-white px-4 py-3.5 transition-all",
        selected
          ? "border-brand-dark shadow-[0_14px_36px_-20px_rgba(2,44,25,0.45)] ring-2 ring-brand-dark"
          : "border-slate-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_12px_30px_-20px_rgba(2,44,25,0.35)]",
      )}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />
      {icon && (
        <span
          className={cx(
            "flex h-10 w-10 flex-none items-center justify-center rounded-lg border transition-colors",
            selected
              ? "border-brand-dark bg-brand-dark text-amber-300"
              : "border-emerald-200 bg-emerald-50 text-brand-dark",
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm font-extrabold text-slate-900">{title}</b>
          {badge}
        </span>
        {meta && (
          <span className="mt-1 block text-[13px] font-semibold text-slate-700">
            {meta}
          </span>
        )}
        {body && (
          <span
            className={cx(
              "block text-[13px] leading-relaxed text-slate-500",
              meta ? "mt-0.5" : "mt-1",
            )}
          >
            {body}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cx(
          "flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 transition-all peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-100",
          selected
            ? "scale-110 border-amber-400 bg-amber-400 text-emerald-950"
            : "border-slate-300 bg-white",
        )}
      >
        {selected && <CheckIcon className="h-3.5 w-3.5" />}
      </span>
    </label>
  );
}

/* ---------- Progress ---------- */

export type StepState = "done" | "cur" | "attn" | "";

export function StepRail({
  steps,
  current,
  stateOf,
  canOpen,
  onOpen,
}: {
  steps: { id: string; title: string }[];
  current: string;
  stateOf: (id: string) => StepState;
  canOpen: (id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const at = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  );
  const done = steps.filter((s) => stateOf(s.id) === "done").length;
  return (
    <>
      <div
        className="hidden items-start md:flex"
        aria-label="Application sections"
      >
        {steps.map((s, i) => {
          const st = stateOf(s.id);
          const reached = st === "done" || st === "cur" || st === "attn";
          return (
            <button
              key={s.id}
              type="button"
              disabled={!canOpen(s.id)}
              onClick={() => onOpen(s.id)}
              aria-current={st === "cur" ? "step" : undefined}
              className="group relative flex min-w-0 flex-1 flex-col items-center gap-1 disabled:cursor-default"
            >
              {i < steps.length - 1 && (
                <span
                  className={cx(
                    "absolute left-[calc(50%+16px)] right-[calc(-50%+16px)] top-[12px] h-[3px] rounded-full",
                    st === "done" ? "bg-brand" : "bg-slate-200",
                  )}
                />
              )}
              <span
                className={cx(
                  "relative z-[1] grid h-6 w-6 place-items-center rounded-full border-2 text-[11px] font-bold transition-all",
                  st === "done"
                    ? "border-brand bg-brand text-white group-enabled:group-hover:scale-110"
                    : st === "cur"
                      ? "border-brand-dark bg-brand-dark text-amber-300 ring-4 ring-emerald-100"
                      : st === "attn"
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-slate-200 bg-white text-slate-400",
                )}
              >
                {st === "done" ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : st === "attn" ? (
                  "!"
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cx(
                  "max-w-28 text-center text-[11px] leading-tight",
                  st === "cur"
                    ? "font-extrabold text-slate-900"
                    : reached
                      ? "font-semibold text-slate-600"
                      : "text-slate-400",
                )}
              >
                {s.title}
              </span>
            </button>
          );
        })}
      </div>

      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
        >
          <span>
            <span className="text-xs font-semibold text-slate-400">
              Step {at + 1} of {steps.length}
            </span>
            <br />
            <b className="font-extrabold text-slate-900">{steps[at]?.title}</b>
          </span>
          <span className="flex items-center gap-1 text-[13px] font-bold text-brand">
            {open ? "Hide steps" : "All steps"}
            <ChevronDownIcon
              className={cx(
                "h-4 w-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
        </button>
        <Bar pct={(done / Math.max(1, steps.length - 1)) * 100} />
        {open && (
          <div className="mt-3 flex flex-col gap-1">
            {steps.map((s, i) => {
              const st = stateOf(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!canOpen(s.id)}
                  onClick={() => {
                    setOpen(false);
                    onOpen(s.id);
                  }}
                  className="flex items-center justify-between rounded-lg px-1 py-1.5 text-left disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    <Pill tone={st === "cur" ? "blue" : "grey"}>{i + 1}</Pill>
                    <span className={st === "cur" ? "font-bold" : ""}>
                      {s.title}
                    </span>
                  </span>
                  {st === "done" ? (
                    <Pill tone="green">Complete</Pill>
                  ) : st === "attn" ? (
                    <Pill tone="amber">Needs attention</Pill>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function Bar({ pct }: { pct: number }) {
  return (
    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
      <i
        className="block h-full rounded-full bg-gradient-to-r from-brand to-amber-400 transition-[width] duration-500"
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
    >
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cx(
            "rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors",
            value === k
              ? "bg-white text-brand-dark shadow-xs"
              : "text-slate-500 hover:text-slate-900",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* ---------- Outcomes ---------- */

const HERO: Record<"ok" | "warn" | "err" | "info", [string, ReactNode]> = {
  ok: [
    "bg-emerald-100 text-emerald-700 ring-emerald-50",
    <CheckIcon key="ok" className="h-7 w-7" />,
  ],
  warn: ["bg-amber-100 text-amber-700 ring-amber-50", "!"],
  err: ["bg-rose-100 text-rose-700 ring-rose-50", "×"],
  info: ["bg-sky-100 text-sky-700 ring-sky-50", "i"],
};

export function Hero({
  kind = "ok",
  title,
  children,
}: {
  kind?: keyof typeof HERO;
  title: string;
  children?: ReactNode;
}) {
  const [tone, glyph] = HERO[kind];
  return (
    <div className="flex flex-col items-start gap-3 py-1">
      <div
        className={cx(
          "grid h-14 w-14 place-items-center rounded-2xl text-2xl font-black ring-8",
          tone,
        )}
      >
        {glyph}
      </div>
      <h2 className="text-2xl font-black leading-tight tracking-tight text-slate-900">
        {title}
      </h2>
      {children && <p className="text-slate-500">{children}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="h-12 w-12 flex-none animate-spin rounded-full border-4 border-emerald-100 border-t-brand" />
  );
}

export function Modal({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-5 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-[520px] flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white px-7 py-6 shadow-2xl"
      >
        <h2 className="text-xl font-black leading-tight text-slate-900">
          {title}
        </h2>
        {children}
        <div className="flex justify-end gap-3">{actions}</div>
      </div>
    </div>
  );
}

/** The bottom of a page: Back on the left, the way on at the right. Sticks to
 *  the bottom of the screen as a glass bar, so the next action is always in
 *  reach on a long step. */
export function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-3 z-20 -mx-2 flex items-center justify-between gap-2 rounded-xl sm:gap-3 border border-white/60 bg-white/75 px-3 py-2 shadow-[0_12px_40px_-14px_rgba(2,44,25,0.35)] backdrop-blur-xl backdrop-saturate-150 sm:-mx-4 sm:px-4">
      {children}
    </div>
  );
}
