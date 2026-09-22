import { useEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { EID_PART_LENGTHS, EID_TOTAL_DIGITS } from '../eid';

/**
 * The three-box e-ID control: ___ − ____ − ____
 *
 * Owns the boxes, the digit filtering, and the focus behaviour that makes
 * three inputs feel like one field. It owns NO label, hint or error text —
 * the caller pairs those with it, because the sign-in page and any future
 * provisioning form want different words around the same control.
 */
interface EidBoxesProps {
  /** The combined value, `'123-4567-8901'`. */
  value: string;
  /** Called with the combined value. */
  onChange: (next: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  /**
   * Which palette to wear. `app` is the signed-in application's; `public` is
   * the sign-in page's, which is typeset as a government front door and would
   * show the app's brand blue as a foreign colour on a cream card.
   *
   * ONLY the skin changes. The digit filtering, the auto-advance, the paste
   * handling and the shape itself are the contract with Keycloak and are the
   * same control either way — a variant that could alter those would be a
   * second e-ID field, not a second look.
   */
  variant?: 'app' | 'public';
}

/** Per-variant skins. Keyed identically so a missing state in one is obvious. */
const SKINS = {
  app: {
    box: 'rounded-md px-2 py-2 text-[15px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100 disabled:text-slate-400',
    border: 'border-slate-300',
    dash: 'text-slate-400',
  },
  public: {
    box: 'rounded-xl bg-white px-2 py-[13px] text-[16px] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo disabled:bg-gdb-rail disabled:text-gdb-ink/40',
    border: 'border-gdb-border',
    dash: 'text-gdb-ink/35',
  },
} as const;

export function EidBoxes({
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  autoFocus = false,
  variant = 'app',
}: EidBoxesProps) {
  const skin = SKINS[variant];
  // Three parts out of the combined value. Anything that is not exactly three
  // dash-separated segments reads as empty rather than as a partial guess — a
  // value the control cannot render is better shown blank than as two boxes of
  // somebody's data.
  const segments = value.split('-');
  const parts = segments.length === 3 ? segments.map((p) => p || '') : ['', '', ''];

  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);
  const refs = [ref1, ref2, ref3];

  useEffect(() => {
    if (autoFocus) ref1.current?.focus();
  }, [autoFocus]);

  const handleChange = (index: number, raw: string) => {
    const sanitized = raw.replace(/\D/g, '');
    if (sanitized.length > EID_PART_LENGTHS[index]) return;

    const next = [...parts];
    next[index] = sanitized;

    // Auto-advance when a box fills, so eleven digits can be typed straight
    // through without reaching for Tab.
    if (sanitized.length === EID_PART_LENGTHS[index]) refs[index + 1]?.current?.focus();

    onChange(next.join('-'));
  };

  // Backspace out of an empty box steps back rather than doing nothing —
  // the difference between three inputs and one field made of three.
  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && event.currentTarget.value === '') {
      event.preventDefault();
      refs[index - 1]?.current?.focus();
    }
  };

  // A pasted "123-4567-8901" (or eleven bare digits) fills all three boxes
  // instead of dropping eleven characters into one that holds three.
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '');
    if (digits.length !== EID_TOTAL_DIGITS) return;
    event.preventDefault();
    onChange(`${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`);
    ref3.current?.focus();
  };

  const box = (index: number, grow: string, placeholder: string) => (
    <input
      ref={refs[index]}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      required
      pattern={`\\d{${EID_PART_LENGTHS[index]}}`}
      title={`${EID_PART_LENGTHS[index]} digits`}
      maxLength={EID_PART_LENGTHS[index]}
      value={parts[index]}
      onChange={(e) => handleChange(index, e.target.value)}
      onKeyDown={(e) => handleKeyDown(index, e)}
      onPaste={handlePaste}
      // Focusing a box SELECTS what it holds, so typing replaces rather than
      // appends. Without this, clicking back into a full box puts the caret at
      // the end and maxLength silently eats the keystrokes — retyping an e-ID
      // would mean hand-clearing three boxes.
      onFocus={(e) => e.target.select()}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-label={`e-ID digits, group ${index + 1} of 3`}
      placeholder={placeholder}
      className={`${grow} min-w-0 border text-center tabular-nums tracking-[0.04em] ${skin.box} ${
        invalid ? 'border-red-400' : skin.border
      }`}
    />
  );

  return (
    <div className="flex w-full items-center gap-2" role="group" aria-label="e-ID Number">
      {/* Proportioned to each box's own digit count (3/4/4) rather than split
          evenly: three equal boxes for a 3-then-4-then-4 value reads oddly
          once you notice the later boxes have more room per digit. */}
      {box(0, 'flex-[3]', 'XXX')}
      <span className={`text-lg font-light ${skin.dash}`} aria-hidden="true">
        −
      </span>
      {box(1, 'flex-[4]', 'XXXX')}
      <span className={`text-lg font-light ${skin.dash}`} aria-hidden="true">
        −
      </span>
      {box(2, 'flex-[4]', 'XXXX')}
    </div>
  );
}
