import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "../api";
import { isGuyanaPhone, PhoneInput } from "./PhoneInput";

export type AppointmentReason = "No National ID" | "Change phone number";

const INPUT =
  "mt-1.5 w-full rounded-xl border border-gdb-border bg-white px-4 py-3 text-[15px] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo";

const INTRO: Record<AppointmentReason, string> = {
  "No National ID":
    "A GDB loan officer will call you to book an appointment, help you get your National ID and register for a loan account.",
  "Change phone number":
    "A GDB loan officer will call you to book an appointment and update the phone number on record for your National ID.",
};

/** "Schedule an appointment" from sign-up — for someone with no National ID,
 *  or whose phone on record is not theirs. Sends first name, last name and a
 *  phone number to gdb_bank.tin_auth.request_appointment; GDB calls back. */
export function AppointmentRequest({
  reason,
  nationalId,
  initial,
  onClose,
}: {
  reason: AppointmentReason;
  nationalId?: string;
  initial?: { firstName?: string; lastName?: string };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [first, setFirst] = useState(initial?.firstName ?? "");
  const [last, setLast] = useState(initial?.lastName ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // An error is read first: it takes the focus.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const submit = async () => {
    if (!first.trim() || !last.trim())
      return setError("Enter your first and last name.");
    if (!isGuyanaPhone(phone))
      return setError("Enter a valid phone number, e.g. 600 1234.");
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ name: string }>(
        "gdb_bank.tin_auth.request_appointment",
        {
          first_name: first.trim(),
          last_name: last.trim(),
          phone,
          reason,
          national_id: nationalId || undefined,
        },
      );
      setSent(res.name);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your request could not be sent. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="appointment-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[24px] bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
              GDB appointment
            </p>
            <h2
              id="appointment-title"
              className="mt-1 text-xl font-extrabold tracking-tight text-gdb-ink"
            >
              {sent ? "Request sent" : "Schedule an appointment"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <>
            <p className="text-[15px] leading-relaxed text-gdb-ink/75">
              Thank you, {first.trim()}. A GDB loan officer will call you on{" "}
              <b>+592 {phone.replace(/^\+592/, "")}</b> to book your
              appointment.
            </p>
            <p className="text-[13px] text-gdb-ink/55">
              Your reference is{" "}
              <span className="font-mono font-bold text-gdb-ink">{sent}</span>.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-black py-3 text-[15px] font-extrabold text-white hover:bg-[#262626]"
            >
              Done
            </button>
          </>
        ) : (
          <div
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.target as HTMLElement).tagName === "INPUT"
              ) {
                e.preventDefault();
                void submit();
              }
            }}
            className="space-y-4"
          >
            <p className="text-[14px] leading-relaxed text-gdb-ink/65">
              {INTRO[reason]}
            </p>
            {error && (
              <p
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="rounded-xl bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700 outline-none"
              >
                {error}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[14px] font-extrabold text-gdb-ink">
                First name
                <input
                  value={first}
                  onChange={(e) => setFirst(e.target.value)}
                  autoComplete="given-name"
                  className={INPUT}
                />
              </label>
              <label className="block text-[14px] font-extrabold text-gdb-ink">
                Last name
                <input
                  value={last}
                  onChange={(e) => setLast(e.target.value)}
                  autoComplete="family-name"
                  className={INPUT}
                />
              </label>
            </div>
            <label className="block text-[14px] font-extrabold text-gdb-ink">
              Phone number
              <PhoneInput value={phone} onChange={setPhone} className={INPUT} />
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="w-full rounded-xl bg-black py-3 text-[15px] font-extrabold text-white hover:bg-[#262626] disabled:opacity-60"
            >
              {busy ? "Sending…" : "Request an appointment"}
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
