import { useState, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon } from '../ui/icons';

/** The Quick Loan flow's own building blocks, drawn to the approved prototype
 *  (gdb-quick-loan-flow). Presentation only — every rule stays in
 *  model/quickLoan.ts and on the server. Colours are the `ql-*` tokens, read
 *  inside `.theme-citizen`. */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Panel({ narrow, children }: { narrow?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-6 rounded-2xl bg-white px-4 py-[18px] sm:px-7 sm:py-6', narrow && 'max-w-[760px]')}>
      {children}
    </div>
  );
}

export function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="text-[23px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">{title}</h1>
      {children && <p className="mt-1.5 text-ql-ink2">{children}</p>}
    </div>
  );
}

/** A section's heading: its name, where the draft stands, and one line on what it asks. */
export function SecHead({ title, meta, intro }: { title: string; meta?: string; intro?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[23px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
      {meta && <div className="text-[13px] text-ql-muted">{meta}</div>}
      {intro && <p className="text-ql-ink2">{intro}</p>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[19px] font-semibold leading-tight">{children}</h3>;
}

export function Card({
  tone,
  className,
  children,
}: {
  tone?: 'tint' | 'soft';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-[14px] border px-4 py-4 sm:px-[22px] sm:py-5',
        tone === 'tint' ? 'border-ql-tintline bg-ql-tint' : tone === 'soft' ? 'border-ql-line bg-ql-soft' : 'border-ql-line bg-white',
        className,
      )}
    >
      {children}
    </div>
  );
}

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'grey';
const PILL: Record<Tone, string> = {
  blue: 'bg-ql-blue/12 text-ql-brand',
  green: 'bg-ql-green/12 text-ql-green',
  amber: 'bg-ql-amber-pill text-ql-amber',
  red: 'bg-ql-red-bg text-ql-red',
  grey: 'bg-ql-grey-pill text-ql-ink2',
};

export function Pill({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-semibold', PILL[tone])}>
      {children}
    </span>
  );
}

type BannerKind = 'info' | 'warn' | 'error' | 'success';
const BANNER: Record<BannerKind, [string, string, string]> = {
  info: ['border-[#d3e0f6] bg-ql-tint', 'bg-ql-blue', 'i'],
  warn: ['border-ql-amber-line bg-ql-amber-bg', 'bg-ql-amber-strong', '!'],
  error: ['border-ql-red-line bg-ql-red-bg', 'bg-ql-red', '!'],
  success: ['border-ql-green-line bg-ql-green-bg', 'bg-ql-green', ''],
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
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border px-4 py-3.5', box)} role={kind === 'error' ? 'alert' : 'status'}>
      <span className={cx('grid h-6 w-6 flex-none place-items-center rounded-full text-[13px] font-bold text-white', dot)}>
        {kind === 'success' ? <CheckIcon className="h-3.5 w-3.5" /> : glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-snug">{title}</div>
        {children && <div className="mt-0.5 text-[13px] text-ql-ink2">{children}</div>}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
    </div>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
const BUTTON: Record<ButtonKind, string> = {
  primary: 'border-transparent bg-ql-navy text-white hover:bg-ql-navy-dark',
  secondary: 'border-[#232e42] bg-white text-ql-ink hover:bg-ql-soft',
  ghost: 'border-transparent px-2 text-ql-brand hover:bg-ql-tint',
  danger: 'border-transparent bg-ql-red text-white hover:bg-[#a82f26]',
};

export function QButton({
  kind = 'primary',
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
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        sm ? 'h-8 px-3.5 text-[13px]' : 'h-[38px] px-[18px] text-sm',
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

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-medium text-ql-brand hover:underline">
      {children}
    </button>
  );
}

/* ---------- Fields ---------- */

export const inputClass = (bad?: boolean) =>
  cx(
    'h-[42px] w-full rounded-[10px] border bg-white px-3 text-sm text-ql-ink transition placeholder:text-ql-muted/70 focus:outline-none',
    bad
      ? 'border-ql-red ring-[3px] ring-ql-red/10'
      : 'border-ql-input focus:border-ql-blue focus:ring-[3px] focus:ring-ql-blue/12',
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
  const hint = help && <div className="text-[12.5px] leading-snug text-ql-muted">{help}</div>;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {label}
          {required && ' *'}
        </span>
        {tag}
      </div>
      {helpFirst && hint}
      {children}
      {!helpFirst && hint}
      {error && <div className="text-[12.5px] font-medium text-ql-red">{error}</div>}
    </div>
  );
}

export function QReadOnly({ label, value, source }: { label: string; value: ReactNode; source: string }) {
  return (
    <QField label={label} tag={<Pill tone="blue">{source}</Pill>}>
      <div className="flex h-[42px] items-center rounded-[10px] border border-ql-input bg-ql-soft px-3 text-sm text-ql-ink2">
        {value || <span className="text-ql-muted">Not held</span>}
      </div>
    </QField>
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
        rows={3}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass(bad), 'h-auto min-h-[92px] resize-y py-2.5 leading-relaxed')}
      />
      <div className="text-right text-xs text-ql-muted">
        {value.length.toLocaleString('en-US')} / {max.toLocaleString('en-US')}
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
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass(bad), 'pr-9')}>
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
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cx(
            'inline-flex h-9 items-center rounded-full border px-3.5 text-[13.5px] font-medium transition-colors',
            value === o ? 'border-ql-navy bg-ql-navy text-white' : 'border-ql-input bg-white hover:bg-ql-soft',
          )}
        >
          {o}
        </button>
      ))}
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
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-[18px] w-[18px] flex-none accent-ql-navy"
      />
      <span>{children}</span>
    </label>
  );
}

/** A large either/or choice — a radio drawn as a card. */
export function RadioCard({
  title,
  body,
  meta,
  badge,
  selected,
  onSelect,
}: {
  title: string;
  body?: string;
  /** A line of terms above the body, in the darker ink. */
  meta?: string;
  badge?: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-[14px] border px-4 py-4 sm:px-[22px] sm:py-5',
        selected ? 'border-ql-tintline bg-ql-tint' : 'border-ql-line bg-white',
      )}
    >
      <input type="radio" checked={selected} onChange={onSelect} className="mt-[3px] h-[18px] w-[18px] flex-none accent-ql-navy" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <b className="font-semibold">{title}</b>
          {badge}
        </span>
        {meta && <span className="mt-1 block text-[13px] text-ql-ink2">{meta}</span>}
        {body && <span className={cx('block text-[13px] text-ql-muted', meta && 'mt-0.5')}>{body}</span>}
      </span>
    </label>
  );
}

/* ---------- Progress ---------- */

export type StepState = 'done' | 'cur' | 'attn' | '';

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
  const at = Math.max(0, steps.findIndex((s) => s.id === current));
  const done = steps.filter((s) => stateOf(s.id) === 'done').length;
  return (
    <>
      <div className="hidden items-start rounded-2xl bg-white px-[22px] pb-3.5 pt-[18px] md:flex" aria-label="Application sections">
        {steps.map((s, i) => {
          const st = stateOf(s.id);
          return (
            <button
              key={s.id}
              type="button"
              disabled={!canOpen(s.id)}
              onClick={() => onOpen(s.id)}
              aria-current={st === 'cur' ? 'step' : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 disabled:cursor-default"
            >
              {i < steps.length - 1 && (
                <span
                  className={cx(
                    'absolute left-[calc(50%+24px)] right-[calc(-50%+24px)] top-[14px] h-0.5',
                    st === 'done' ? 'bg-ql-brand' : 'bg-ql-step/50',
                  )}
                />
              )}
              <span
                className={cx(
                  'relative z-[1] grid h-7 w-7 place-items-center rounded-full border-[1.5px] text-[12.5px]',
                  st === 'done'
                    ? 'border-ql-brand bg-ql-brand text-white'
                    : st === 'cur'
                      ? 'border-ql-brand bg-white font-semibold text-ql-brand ring-[3px] ring-ql-blue/12'
                      : st === 'attn'
                        ? 'border-ql-amber-strong bg-ql-amber-strong font-bold text-white'
                        : 'border-ql-step bg-[#f3f6fb] font-medium text-ql-ink2',
                )}
              >
                {st === 'done' ? <CheckIcon className="h-3.5 w-3.5" /> : st === 'attn' ? '!' : i + 1}
              </span>
              <span
                className={cx(
                  'max-w-24 text-center text-[12.5px] leading-tight',
                  st === 'cur' ? 'font-semibold text-ql-ink' : 'text-ql-ink2',
                )}
              >
                {s.title}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-[14px] bg-white px-3.5 py-3 md:hidden">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
          <span>
            <span className="text-xs text-ql-muted">
              Step {at + 1} of {steps.length}
            </span>
            <br />
            <b className="font-semibold">{steps[at]?.title}</b>
          </span>
          <span className="flex items-center gap-1 text-[13px] font-medium text-ql-brand">
            {open ? 'Hide steps' : 'All steps'}
            <ChevronDownIcon className={cx('h-4 w-4', open && 'rotate-180')} />
          </span>
        </button>
        <Bar pct={(done / Math.max(1, steps.length - 1)) * 100} />
        {open && (
          <div className="mt-3 flex flex-col gap-2">
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
                  className="flex items-center justify-between py-1.5 text-left disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    <Pill tone={st === 'cur' ? 'blue' : 'grey'}>{i + 1}</Pill>
                    <span className={st === 'cur' ? 'font-semibold' : ''}>{s.title}</span>
                  </span>
                  {st === 'done' ? <Pill tone="green">Complete</Pill> : st === 'attn' ? <Pill tone="amber">Needs attention</Pill> : null}
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
    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#e3e8f0]">
      <i className="block h-full rounded-full bg-ql-blue transition-[width]" style={{ width: `${Math.min(100, pct)}%` }} />
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
    <div className="flex gap-1 border-b border-ql-line" role="tablist">
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cx(
            '-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium',
            value === k ? 'border-ql-ink text-ql-ink' : 'border-transparent text-ql-ink2',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* ---------- Outcomes ---------- */

const HERO: Record<'ok' | 'warn' | 'err' | 'info', [string, ReactNode]> = {
  ok: ['bg-ql-green/12 text-ql-green', <CheckIcon key="ok" className="h-6 w-6" />],
  warn: ['bg-ql-amber-pill text-ql-amber', '!'],
  err: ['bg-ql-red-bg text-ql-red', '×'],
  info: ['bg-ql-blue/12 text-ql-brand', 'i'],
};

export function Hero({ kind = 'ok', title, children }: { kind?: keyof typeof HERO; title: string; children?: ReactNode }) {
  const [tone, glyph] = HERO[kind];
  return (
    <div className="flex flex-col items-start gap-2.5 py-2">
      <div className={cx('grid h-11 w-11 place-items-center rounded-full text-xl font-bold', tone)}>{glyph}</div>
      <h2 className="text-[23px] font-semibold leading-tight">{title}</h2>
      {children && <p className="text-ql-ink2">{children}</p>}
    </div>
  );
}

export function Spinner() {
  return <div className="h-11 w-11 flex-none animate-spin rounded-full border-4 border-ql-blue/12 border-t-ql-blue" />;
}

export function Modal({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ql-ink/45 p-5">
      <div role="dialog" aria-modal="true" className="flex w-full max-w-[520px] flex-col gap-3.5 rounded-[18px] bg-white px-7 py-6 shadow-xl">
        <h2 className="text-[21px] font-semibold leading-tight">{title}</h2>
        {children}
        <div className="flex justify-end gap-3">{actions}</div>
      </div>
    </div>
  );
}

/** The bottom of a page: Back on the left, the way on at the right. */
export function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>;
}
