import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The public site's vocabulary — the marks, rules and actions that the
 * landing page and the sign-in page are both built out of.
 *
 * These are deliberately NOT the `components/ui/*` primitives. Those dress
 * the signed-in application; these dress the two pages a citizen sees before
 * they have an account, which were designed as a government programme front
 * door rather than as banking software. A Button in the public site's
 * ceremonial gold would look wrong on the underwriter's queue, and one in the
 * app's brand blue would look wrong under the flag.
 */

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

/** The forward arrow on every call to action. */
export function ArrowRight({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

/** The out-and-up arrow on a link that goes somewhere else. */
export function ArrowOut({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

/** A struck-through circle: the mark against "not yet open". */
export function NotOpenIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

/** A shield with a check: the mark against a safeguard. */
export function ShieldCheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M12 3l7.2 3v5.6c0 4.2-3 7.7-7.2 8.6C7.8 19.3 4.8 15.8 4.8 11.6V6L12 3z" />
      <path d="M9.2 12.1l2 2 3.7-3.9" />
    </svg>
  );
}

/** A question mark in a circle: the mark against "this is not an offer". */
export function QueryIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.3 2.4c-.6.25-.9.8-.9 1.45v.45" />
      <path d="M12 16.6h.01" />
    </svg>
  );
}

/** A person with a check: the mark against "a person decides". */
export function PersonCheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="10" cy="8" r="3.6" />
      <path d="M3.8 19.6c0-3.4 2.8-5.6 6.2-5.6 1.4 0 2.6.3 3.6.9" />
      <path d="M16.2 16.4l1.9 1.9 3.9-4.2" />
    </svg>
  );
}

/** A megaphone: the mark against "announced nationally, not offered here". */
export function AnnouncementIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size + 2}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-px shrink-0"
      aria-hidden="true"
    >
      <path d="M4.5 9.5H8l8-4.5v14L8 14.5H4.5A1.5 1.5 0 0 1 3 13v-2a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M8 14.8l1 4.7h2.4l-1-4.7" />
      <path d="M19 9.6a3 3 0 0 1 0 4.8" />
    </svg>
  );
}

/** The bank's own mark: a colonnade, in white on ink. */
export function BankMark({ className = 'h-14 w-14 rounded-[18px]' }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center bg-gdb-ink ${className}`}>
      <svg
        width="26"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 9.5L12 4l9 5.5" />
        <path d="M5 10v8" />
        <path d="M9.5 10v8" />
        <path d="M14.5 10v8" />
        <path d="M19 10v8" />
        <path d="M3.2 20.5h17.6" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Marks and rules
 * ------------------------------------------------------------------ */

/** The Golden Arrowhead across the top of every public page. Its five bands
 *  are flexed to the flag's own proportions, not to equal fifths. */
export function FlagRibbon() {
  return (
    <div className="flex h-1.5" aria-hidden="true">
      <i className="block flex-[554] bg-flag-green" />
      <i className="block flex-[111] bg-white" />
      <i className="block flex-[332] bg-flag-gold" />
      <i className="block flex-[111] bg-flag-black" />
      <i className="block flex-[332] bg-flag-red" />
    </div>
  );
}

/** A gold rule with a stamped label after it — what opens every section. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <i className="block h-0.5 w-12 shrink-0 bg-gdb-goldleaf" />
      <span className="font-code text-[13px] font-extrabold tracking-[0.12em] text-gdb-indigo sm:text-[15px]">
        {children}
      </span>
    </div>
  );
}

/** The dateline under a section: what this page is, and when it was stated. */
export function Meta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`font-code text-[13px] leading-[1.4] font-medium tracking-[0.02em] text-gdb-ink/50 sm:text-[14px] ${className}`}
    >
      {children}
    </div>
  );
}

/** The hairline between blocks inside a card. */
export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`h-px border-0 bg-gdb-line ${className}`} />;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const GOLD_SIZES = {
  lg: 'gap-3.5 rounded-xl py-5 pr-[26px] pl-[30px] text-[17px]',
  md: 'gap-3.5 rounded-xl py-[19px] pr-6 pl-7 text-[16px]',
  sm: 'gap-3 rounded-[11px] py-4 pr-[22px] pl-6 text-[16px]',
} as const;

type GoldSize = keyof typeof GOLD_SIZES;

/** The gold call to action, as classes alone — for a `<button>` that submits
 *  a form rather than navigating. */
export function goldActionClass(size: GoldSize = 'lg') {
  return `inline-flex cursor-pointer items-center justify-center border-0 bg-gdb-goldleaf font-body leading-[1.2] font-extrabold text-gdb-ink disabled:cursor-not-allowed disabled:opacity-60 ${GOLD_SIZES[size]}`;
}

/** The gold call to action as a link. */
export function GoldLink({
  to,
  children,
  size = 'lg',
  className = '',
}: {
  to: string;
  children: ReactNode;
  size?: GoldSize;
  className?: string;
}) {
  return (
    <Link to={to} className={`${goldActionClass(size)} ${className}`}>
      {children}
      <ArrowRight size={size === 'lg' ? 20 : 18} />
    </Link>
  );
}

/**
 * The quieter indigo link that sits beside a gold button.
 *
 * `to` navigates inside the SPA. Everything else on these pages points at a
 * page of the public site that has not been built — those render as plain
 * text with the arrow, NOT as an anchor, because a link that goes nowhere is
 * worse on a government front page than a line that never offered to.
 */
export function IndigoLink({
  to,
  children,
  className = 'text-[17px]',
}: {
  to?: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = `inline-flex items-center gap-2 font-extrabold text-gdb-indigo ${className}`;
  if (!to) {
    return (
      <span className={`${cls} opacity-45`} title="This page is not published yet.">
        {children}
        <ArrowOut />
      </span>
    );
  }
  return (
    <Link to={to} className={cls}>
      {children}
      <ArrowOut />
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Imagery
 * ------------------------------------------------------------------ */

/**
 * A cover-fit photograph on a tinted plate.
 *
 * The plate is not decoration: it is what shows if the image fails to load,
 * with `label` stamped across it — so a missing asset degrades to a labelled
 * space rather than to a torn-image glyph on a national programme's front
 * page.
 */
export function Photo({
  src,
  alt,
  label,
  className = '',
}: {
  src: string;
  alt: string;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`relative overflow-hidden bg-[linear-gradient(135deg,#E9E7F2_0%,#DEDCEA_55%,#E6E3EF_100%)] ${className}`}
    >
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center p-3 text-center font-code text-[11px] tracking-[0.1em] text-gdb-ink/30">
          {label}
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 z-[1] block h-full w-full object-cover"
        />
      )}
    </div>
  );
}

/**
 * A contain-fit crest or logo.
 *
 * `blend` multiplies a white-backed crest into a tinted panel so its box
 * disappears; `chip` gives it a white plate instead, for where it sits on ink
 * and multiplying would erase it.
 */
export function Crest({
  src,
  alt,
  className = '',
  blend = false,
  chip = false,
}: {
  src: string;
  alt: string;
  className?: string;
  blend?: boolean;
  chip?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`block shrink-0 ${className}`} aria-hidden="true" />;
  return (
    <span className={`block shrink-0 ${chip ? 'rounded-lg bg-white p-[3px]' : ''} ${className}`}>
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        className={`block h-full w-full object-contain ${blend ? 'mix-blend-multiply' : ''}`}
      />
    </span>
  );
}
