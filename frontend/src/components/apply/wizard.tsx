import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ApplicationsIcon, CheckIcon, ChevronDownIcon } from '../ui/icons';

/** The wizard's shared chrome: the step rail, the review's attention list and
 *  its expandable sections. Used by the citizen's application (pages/Apply) and
 *  the facilitator's group wizard (features/facilitator), so both read as one
 *  instrument. Presentation only — what is missing is decided by the caller. */

export interface RailStep {
  id: string;
  title: string;
}

/** Circles over labels. Done = filled check; reached but short of something
 *  = amber "!"; current = outlined. Only steps already reached are clickable. */
export function StepRail({
  steps,
  index,
  reached,
  active = true,
  attention,
  onJump,
  locked,
}: {
  steps: RailStep[];
  index: number;
  reached: number;
  /** False while another tab is on screen, so no step reads as current. */
  active?: boolean;
  attention: (id: string) => boolean;
  onJump: (i: number) => void;
  /** Extra lock on top of "not reached yet" — e.g. steps frozen after submission. */
  locked?: (i: number) => boolean;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // The rail hides its scrollbar; keep the current step in view on a phone.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [index]);

  return (
    <nav className="overflow-x-auto rounded-lg border border-slate-200 bg-white px-3 py-4 scrollbar-none">
      <ol className="flex min-w-max items-start sm:min-w-0">
        {steps.map((s, i) => {
          const current = i === index && active;
          const done = !current && i <= reached;
          const flagged = done && attention(s.id);
          return (
            <li key={s.id} className="flex min-w-[76px] flex-1 items-start">
              <button
                ref={i === index ? activeRef : undefined}
                type="button"
                onClick={() => onJump(i)}
                disabled={i > reached || Boolean(locked?.(i))}
                aria-current={current ? 'step' : undefined}
                className="flex w-full flex-col items-center disabled:cursor-default"
              >
                <span className="flex w-full items-center">
                  <span className={`h-0.5 flex-1 rounded-full ${i === 0 ? 'bg-transparent' : i <= reached ? 'bg-brand' : 'bg-slate-300'}`} />
                  <span
                    className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold ${
                      flagged
                        ? 'border-2 border-amber-400 bg-amber-50 text-amber-600'
                        : done
                          ? 'bg-brand text-white'
                          : current
                            ? 'border-2 border-brand bg-white text-brand ring-4 ring-brand/10'
                            : 'border-2 border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    {flagged ? '!' : done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span
                    className={`h-0.5 flex-1 rounded-full ${i === steps.length - 1 ? 'bg-transparent' : i < reached ? 'bg-brand' : 'bg-slate-300'}`}
                  />
                </span>
                <span
                  className={`mt-2 px-1 text-center text-[11px] leading-tight ${
                    current ? 'font-bold text-slate-900' : done ? 'font-medium text-slate-600' : 'text-slate-400'
                  }`}
                >
                  {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Title, save state and one-line blurb at the top of a step's card. */
export function StepHeader({ title, status, blurb }: { title: string; status?: string; blurb?: string }) {
  return (
    <header>
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      {status && <p className="mt-0.5 text-xs text-slate-400">{status}</p>}
      {blurb && <p className="mt-1 text-sm text-slate-500">{blurb}</p>}
    </header>
  );
}

export interface Issue {
  section: string;
  title: string;
  where: string;
  kind: string;
  action: string;
  go: () => void;
}

/** The amber "N items need your attention" panel and one row per item. */
export function AttentionList({ issues, blocking }: { issues: Issue[]; blocking: boolean }) {
  if (issues.length === 0) return null;
  // Only documents outstanding: advisory, so blue and worded as expected —
  // never as something blocking the applicant.
  const advisory = !blocking;
  return (
    <div className="space-y-2">
      <div
        className={`rounded-lg border px-4 py-3 ${advisory ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50'}`}
      >
        <p className={`flex items-center gap-2 text-sm font-bold ${advisory ? 'text-sky-900' : 'text-amber-900'}`}>
          <span
            className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 text-[11px] ${
              advisory ? 'border-sky-500 text-sky-600' : 'border-amber-500 text-amber-600'
            }`}
          >
            {advisory ? 'i' : '!'}
          </span>
          {advisory
            ? `${issues.length} document${issues.length === 1 ? '' : 's'} expected`
            : `${issues.length} item${issues.length === 1 ? ' needs' : 's need'} your attention`}
        </p>
        <p className={`mt-0.5 pl-7 text-xs ${advisory ? 'text-sky-800' : 'text-amber-800'}`}>
          {advisory ? 'Optional at submission. GDB may request them later.' : 'Resolve the required items before submitting.'}
        </p>
      </div>
      {issues.map((it) => (
        <div
          key={`${it.section}-${it.title}`}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
        >
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-slate-100 text-slate-500">
            <ApplicationsIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">{it.title}</p>
            <p className="text-xs text-slate-500">
              {it.where} · {it.kind}
            </p>
          </div>
          <button
            type="button"
            onClick={it.go}
            className="rounded-full border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {it.action}
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ReviewSection {
  id: string;
  title: string;
  summary: string;
  /** Required answers still blank. */
  issues: number;
  /** Expected documents not yet attached — advisory, shown in grey. */
  docs?: number;
  answers: [string, ReactNode][];
}

/** One expandable row per section: summary, Complete / N missing, answers, Edit. */
export function ReviewSections({
  sections,
  onEdit,
  readOnly,
}: {
  sections: ReviewSection[];
  onEdit: (id: string) => void;
  /** Hide Edit — e.g. once the application is with GDB. */
  readOnly?: boolean;
}) {
  // One open at a time keeps the page short on a phone.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-slate-900">Your application</h3>
      <div className="space-y-2">
        {sections.map((s) => {
          const isOpen = open === s.id;
          return (
            <div
              key={s.id}
              className={`rounded-lg border bg-white ${s.issues ? 'border-amber-200' : 'border-slate-200'}`}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : s.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{s.title}</span>
                  <span className="block truncate text-xs text-slate-500">{s.summary || '—'}</span>
                </span>
                <span
                  className={`flex-none rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    s.issues
                      ? 'bg-amber-50 text-amber-700'
                      : s.docs
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {s.issues
                    ? `${s.issues} item${s.issues === 1 ? '' : 's'} missing`
                    : s.docs
                      ? `${s.docs} document${s.docs === 1 ? '' : 's'} expected`
                      : 'Complete'}
                </span>
                {/* Right when closed, down when open — as the question groups. */}
                <ChevronDownIcon
                  className={`h-4 w-4 flex-none text-brand transition-transform ${isOpen ? '' : '-rotate-90'}`}
                />
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <dl className="divide-y divide-slate-100 text-sm">
                    {s.answers.map(([label, value], i) => (
                      <div key={`${label}-${i}`} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="whitespace-pre-line break-words font-medium text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onEdit(s.id)}
                      className="mt-2 text-xs font-semibold text-brand underline"
                    >
                      Edit {s.title.toLowerCase()}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">Open a section to view or edit your answers.</p>
    </div>
  );
}

/** How far a group has been answered: all of it, none of it, or a count. */
export function groupStatus(answered: number, total: number): { label: string; tone: string } {
  if (answered >= total) return { label: 'Complete', tone: 'bg-emerald-50 text-emerald-700' };
  if (answered === 0) return { label: 'Not started', tone: 'bg-slate-100 text-slate-500' };
  return { label: `${answered} of ${total} answered`, tone: 'bg-amber-50 text-amber-700' };
}

/** One collapsible group of questions within a step. Open one at a time. */
export function QuestionGroup({
  n,
  title,
  hint,
  answered,
  total,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  answered: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const status = groupStatus(answered, total);
  const ref = useRef<HTMLDivElement | null>(null);
  // Where the clicked header sat on screen. Opening this group closes the one
  // above it, which would pull this header up the page; after the change the
  // page is scrolled back so the header stays put and the group opens DOWN.
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (anchor.current === null || !ref.current) return;
    const moved = ref.current.getBoundingClientRect().top - anchor.current;
    anchor.current = null;
    if (moved) window.scrollBy({ top: moved });
  }, [open]);
  return (
    <div ref={ref} className="bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          anchor.current = ref.current?.getBoundingClientRect().top ?? null;
          onToggle();
        }}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800">
            {n} · {title}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
        </span>
        <span className={`mt-0.5 flex-none rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.tone}`}>
          {status.label}
        </span>
        {/* Right when closed, down when open. */}
        <ChevronDownIcon
          className={`mt-0.5 h-4 w-4 flex-none text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

/** The primary and secondary buttons used across the wizard. */
export const primaryButton =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50';
export const secondaryButton =
  'rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
