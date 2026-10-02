import { useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

/** A one-time code as six boxes: typing moves on, Backspace moves back, and a
 *  pasted code fills every box at once. The value is the digits typed so far. */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const focus = (i: number) => boxes.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const put = (i: number, typed: string) => {
    const clean = typed.replace(/\D/g, '');
    if (!clean) return;
    const next = (value.slice(0, i) + clean).slice(0, length);
    onChange(next);
    focus(next.length);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) onChange(value.slice(0, i));
      else if (i > 0) {
        onChange(value.slice(0, i - 1));
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const clean = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (clean) {
      onChange(clean);
      focus(clean.length);
    }
  };

  return (
    <div className="flex gap-2 sm:gap-2.5" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          value={d}
          onChange={(e) => put(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          className={`h-14 w-full min-w-0 rounded-xl border bg-white text-center font-display text-2xl font-extrabold text-gdb-ink transition focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo disabled:opacity-50 ${
            invalid ? 'border-red-400' : d ? 'border-brand' : 'border-gdb-border'
          }`}
        />
      ))}
    </div>
  );
}
