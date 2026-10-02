/** A Guyana phone number: "+592" is shown, never typed. The person types the
 *  seven local digits; the value handed back is "+592" and those digits (or ""
 *  while incomplete digits are still being typed — see `localDigits`).
 *
 *  The server reads the same shape: _normalised_phone / _guyana_local_phone
 *  both take seven digits and add 592 themselves. */

export const GY_CODE = "+592";

/** The seven local digits of a value however it was typed or stored —
 *  "6001234", "600 1234", "+592 600 1234", "5926001234". */
export function localDigits(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  let d = raw.replace(/\D/g, "");
  // "+592…" is always the code — including while the digits after it are
  // still being typed. Without the plus, 592 is the code only on a full number.
  if (raw.startsWith("+592")) d = d.slice(3);
  else if (d.length === 10 && d.startsWith("592")) d = d.slice(3);
  // Never truncated here: a number with too many digits must fail the
  // seven-digit rule, not quietly become a different number.
  return d;
}

/** Seven digits — the one rule every phone field in the portal applies. */
export function isGuyanaPhone(value: string | null | undefined): boolean {
  return localDigits(value).length === 7;
}

/** "600 1234" — how a number is shown anywhere in the portal. */
export function formatPhone(value: string | null | undefined): string {
  const d = localDigits(value);
  if (!d) return value ?? "";
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

export function PhoneInput({
  value,
  onChange,
  className = "",
  disabled,
  invalid,
  placeholder = "600 1234",
  ariaLabel,
  autoComplete = "tel-national",
}: {
  value: string;
  onChange: (next: string) => void;
  /** The input's own classes — the surrounding form's text-input style. */
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  autoComplete?: string;
}) {
  const digits = localDigits(value).slice(0, 7);
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute top-1/2 left-3 z-[1] -translate-y-1/2 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600"
        aria-hidden
      >
        {GY_CODE}
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        disabled={disabled}
        value={formatPhone(digits)}
        onChange={(e) => {
          // Typing stops at seven — the only place digits are dropped.
          const next = localDigits(e.target.value).slice(0, 7);
          onChange(next ? `${GY_CODE}${next}` : "");
        }}
        className={`${className} pl-[60px]! tracking-wide`}
      />
    </div>
  );
}
