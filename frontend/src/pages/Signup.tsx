import { useEffect, useRef, useState } from "react";
import { isGuyanaPhone, PhoneInput } from "../components/PhoneInput";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  completeSignup,
  lookupTin,
  requestSignupOtp,
  type KycMatch,
  type OtpChallenge,
  type TinSignupForm,
} from "../api";
import { useAuth } from "../auth";
import { OtpInput } from "../components/OtpInput";
import { RequiredMark } from "../components/ui/RequiredMark";
import {
  ArrowRight,
  BankMark,
  goldActionClass,
} from "../components/site/atoms";

/**
 * TIN SIGN-UP, as the card the login page shows in place of sign-in at
 * /signup (pages/Login.tsx). Three screens, and nothing is created until the third:
 *
 *   1. details      names, optional email, phone, TIN, one identity document,
 *                   a password                -> tin_auth.request_signup_otp
 *   2. code         the one-time code sent to that phone
 *                                             -> tin_auth.complete_signup
 *   3. done         the account exists and this browser is signed in to it
 *
 * Every rule here is the server's too (gdb_bank/tin_auth.py) — the checks on
 * this page only spare a round trip.
 */

// The four documents the server accepts (tin_auth.DOCUMENT_KINDS).
const DOCUMENT_KINDS = [
  "National ID Card",
  "Passport",
  "Driver's Licence",
  "e-ID",
];
// tin_auth.PASSWORD_MIN, and the PDF limit of every identity document.
const PASSWORD_MIN = 8;
const MAX_BYTES = 10 * 1024 * 1024;
// The latest date of birth the form offers: 18 years ago today.
const ADULT_BY = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
})();

const EMPTY: TinSignupForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  tin: "",
  password: "",
  confirm_password: "",
  document_kind: "",
  date_of_birth: "",
};

type Stage = "details" | "code" | "done";

const fieldLabel =
  "block text-[14px] leading-[1.4] font-extrabold text-gdb-ink";
const fieldHelp = "mt-1.5 text-[13px] leading-[1.5] text-gdb-ink/55";
const textInput =
  "mt-2 w-full rounded-xl border border-gdb-border bg-white px-4 py-3 font-body text-[15px] leading-[1.4] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo disabled:opacity-60";
const errorBox =
  "rounded-xl bg-red-50 px-4 py-3 text-[14px] leading-[1.5] font-medium text-red-700";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("The document could not be read. Attach it again."));
    reader.readAsDataURL(file);
  });
}

export function SignupCard({ onSignIn }: { onSignIn: () => void }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("details");
  const [form, setForm] = useState<TinSignupForm>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof TinSignupForm) => (value: string) => {
    setError(null);
    if (key === "first_name" || key === "last_name" || key === "date_of_birth")
      edited.current.add(key);
    setForm((f) => ({ ...f, [key]: value }));
  };

  // The KYC register, asked as soon as a whole TIN is typed. What it knows
  // fills the form (still editable); the phone on record is shown masked and
  // used only once the person confirms it is theirs.
  const [match, setMatch] = useState<KycMatch | null>(null);
  const [looking, setLooking] = useState(false);
  const [useRecordPhone, setUseRecordPhone] = useState(true);
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const edited = useRef(new Set<string>());
  const tinNow = form.tin.replace(/\D/g, "");
  useEffect(() => {
    if (tinNow.length !== 9) {
      setMatch(null);
      return;
    }
    let live = true;
    setLooking(true);
    const t = window.setTimeout(() => {
      lookupTin(tinNow)
        .then((m) => {
          if (!live) return;
          setMatch(m);
          setUseRecordPhone(Boolean(m.found && m.has_phone));
          setPhoneConfirmed(false);
          if (m.found)
            setForm((f) => ({
              ...f,
              first_name:
                edited.current.has("first_name") && f.first_name
                  ? f.first_name
                  : m.first_name || f.first_name,
              last_name:
                edited.current.has("last_name") && f.last_name
                  ? f.last_name
                  : m.last_name || f.last_name,
              date_of_birth:
                edited.current.has("date_of_birth") && f.date_of_birth
                  ? f.date_of_birth
                  : m.date_of_birth || f.date_of_birth,
            }));
        })
        .catch(() => live && setMatch(null))
        .finally(() => live && setLooking(false));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [tinNow]);
  const recordPhone = Boolean(
    match?.found && match.has_phone && useRecordPhone,
  );
  const payload: TinSignupForm = recordPhone
    ? { ...form, phone: "", use_registry_phone: 1 }
    : { ...form, use_registry_phone: 0 };

  const pwShort =
    form.password.length > 0 && form.password.length < PASSWORD_MIN;
  const pwMix =
    form.password.length > 0 &&
    !(/[A-Za-z]/.test(form.password) && /\d/.test(form.password));
  const mismatch =
    form.confirm_password.length > 0 && form.confirm_password !== form.password;
  const tinDigits = form.tin.replace(/\D/g, "");

  const ready =
    form.first_name.trim() &&
    form.last_name.trim() &&
    (recordPhone ? phoneConfirmed : isGuyanaPhone(form.phone)) &&
    !match?.has_account &&
    form.date_of_birth &&
    tinDigits.length === 9 &&
    form.document_kind &&
    file &&
    form.password.length >= PASSWORD_MIN &&
    !pwMix &&
    form.confirm_password === form.password;

  const pickFile = (picked: File | null) => {
    setError(null);
    if (!picked) return setFile(null);
    if (!picked.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      return setError(`${picked.name}: attach a PDF.`);
    }
    if (picked.size > MAX_BYTES) {
      setFile(null);
      return setError(`${picked.name} is larger than 10 MB.`);
    }
    setFile(picked);
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setChallenge(await requestSignupOtp(payload));
      setOtp("");
      setStage("code");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge || !file) return;
    setError(null);
    setBusy(true);
    try {
      const data = await readAsDataUrl(file);
      await completeSignup(payload, challenge.challenge, otp, {
        name: file.name,
        data,
      });
      await refresh();
      setStage("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your account could not be created. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full rounded-[28px] bg-white px-6 pt-9 pb-8 shadow-[0_14px_36px_-6px_rgba(15,23,42,0.09)] sm:px-9">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BankMark className="h-11 w-11 rounded-[14px]" />
        <Steps stage={stage} />
      </div>

      {stage === "details" && (
        <form onSubmit={(e) => void sendCode(e)} noValidate>
          <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
            Create your account
          </h2>
          <p className="mt-1 text-[15px] text-gdb-ink/65">
            Start with your TIN — we fill in what is already on record, and send
            a code to your phone to confirm it is you.
          </p>
          {error && (
            <p className={`mt-5 ${errorBox}`} role="alert">
              {error}
            </p>
          )}

          <div className="mt-6">
            <Field
              label="TIN"
              required
              hint="The 9-digit Taxpayer Identification Number from the GRA. You sign in with it."
            >
              <input
                inputMode="numeric"
                autoComplete="username"
                placeholder="123456789"
                maxLength={11}
                value={form.tin}
                onChange={(e) =>
                  set("tin")(e.target.value.replace(/[^\d\s-]/g, ""))
                }
                disabled={busy}
                className={`${textInput} font-mono tracking-wider`}
              />
            </Field>
            {looking && (
              <p className="mt-2 text-[13px] font-semibold text-gdb-ink/55">
                Looking up your record…
              </p>
            )}
            {!looking && match?.found && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-brand text-[12px] font-black text-white">
                  ✓
                </span>
                <p className="text-[14px] leading-[1.5] text-emerald-900">
                  <b className="font-extrabold">
                    We found your record — {match.first_name} {match.last_name}.
                  </b>{" "}
                  Your details are filled in below. Check them, and change
                  anything that is wrong.
                </p>
              </div>
            )}
            {!looking && match?.has_account && (
              <p className={`mt-3 ${errorBox}`}>
                This TIN already has an account.{" "}
                <button
                  type="button"
                  onClick={onSignIn}
                  className="cursor-pointer border-0 bg-transparent p-0 font-extrabold underline"
                >
                  Sign in instead
                </button>
                .
              </p>
            )}
          </div>

          <div className="mt-6 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="First name" required>
              <input
                autoComplete="given-name"
                value={form.first_name}
                onChange={(e) => set("first_name")(e.target.value)}
                disabled={busy}
                className={textInput}
              />
            </Field>
            <Field label="Last name" required>
              <input
                autoComplete="family-name"
                value={form.last_name}
                onChange={(e) => set("last_name")(e.target.value)}
                disabled={busy}
                className={textInput}
              />
            </Field>
            <Field
              label="Date of birth"
              required
              hint="You must be 18 or older."
            >
              <input
                type="date"
                autoComplete="bday"
                max={ADULT_BY}
                value={form.date_of_birth}
                onChange={(e) => set("date_of_birth")(e.target.value)}
                disabled={busy}
                className={textInput}
              />
            </Field>
            {recordPhone ? (
              <div>
                <span className={fieldLabel}>
                  Phone number
                  <RequiredMark />
                </span>
                <div className="mt-2 rounded-xl border border-gdb-border bg-gdb-paper px-4 py-3">
                  <p className="font-mono text-[16px] font-extrabold tracking-wider text-gdb-ink">
                    +592 {match?.phone_masked}
                  </p>
                  <p className="text-[12px] text-gdb-ink/55">
                    The number on record for this TIN.
                  </p>
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-[14px] font-semibold text-gdb-ink">
                    <input
                      type="checkbox"
                      checked={phoneConfirmed}
                      onChange={(e) => setPhoneConfirmed(e.target.checked)}
                      disabled={busy}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                    />
                    This is my number — send my code to it.
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUseRecordPhone(false);
                    setPhoneConfirmed(false);
                  }}
                  disabled={busy}
                  className={`${fieldHelp} cursor-pointer border-0 bg-transparent p-0 font-bold text-gdb-indigo hover:underline`}
                >
                  Not your number? Use a different one
                </button>
              </div>
            ) : (
              <Field
                label="Phone number"
                required
                hint={
                  match?.found && match.has_phone ? (
                    <button
                      type="button"
                      onClick={() => setUseRecordPhone(true)}
                      className="cursor-pointer border-0 bg-transparent p-0 font-bold text-gdb-indigo hover:underline"
                    >
                      Use the number on record ({match.phone_masked}) instead
                    </button>
                  ) : (
                    "Your sign-in code is sent here."
                  )
                }
              >
                <PhoneInput
                  value={form.phone}
                  onChange={set("phone")}
                  disabled={busy}
                  className={textInput}
                />
              </Field>
            )}
            <Field label="Email" hint="Optional.">
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
                disabled={busy}
                className={textInput}
              />
            </Field>
            <Field label="Identity document" required>
              <select
                value={form.document_kind}
                onChange={(e) => set("document_kind")(e.target.value)}
                disabled={busy}
                className={`${textInput} pr-9`}
              >
                <option value="">Choose one</option>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <span className={fieldLabel}>
                Attach{" "}
                {form.document_kind
                  ? `your ${form.document_kind.toLowerCase()}`
                  : "the document"}
                <RequiredMark />
              </span>
              <label
                className={`mt-2 flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors ${
                  file
                    ? "border-brand bg-emerald-50/60"
                    : "border-gdb-border bg-gdb-paper hover:border-brand"
                }`}
              >
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    pickFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <span className="min-w-0 truncate text-[14px] font-semibold text-gdb-ink/80">
                  {file ? `✓ ${file.name}` : "Choose a PDF"}
                </span>
                <span className="rounded-lg bg-brand-dark px-3 py-1.5 text-[12px] font-extrabold text-white">
                  {file ? "Replace" : "Browse"}
                </span>
              </label>
              <p className={fieldHelp}>PDF, up to 10 MB.</p>
            </div>
            <Field
              label="Password"
              required
              hint={
                <span
                  className={
                    pwShort || pwMix ? "font-semibold text-rose-600" : ""
                  }
                >
                  At least {PASSWORD_MIN} characters, with a letter and a
                  number.
                </span>
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password")(e.target.value)}
                disabled={busy}
                className={textInput}
              />
            </Field>
            <Field
              label="Confirm password"
              required
              hint={
                mismatch ? (
                  <span className="font-semibold text-rose-600">
                    The passwords do not match.
                  </span>
                ) : undefined
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={form.confirm_password}
                onChange={(e) => set("confirm_password")(e.target.value)}
                disabled={busy}
                className={textInput}
              />
            </Field>
          </div>

          <button
            type="submit"
            disabled={busy || !ready}
            className={`mt-7 w-full ${goldActionClass("sm")} py-4 text-[16px]`}
          >
            {busy ? "Checking…" : "Continue — send my code"}
            <ArrowRight size={18} />
          </button>
          <p className="mt-4 text-center text-[14px] text-gdb-ink/65">
            Already have an account?{" "}
            <button
              type="button"
              onClick={onSignIn}
              className="cursor-pointer border-0 bg-transparent p-0 font-extrabold text-gdb-indigo hover:underline"
            >
              Sign in
            </button>
          </p>
        </form>
      )}

      {stage === "code" && challenge && (
        <form
          onSubmit={(e) => void verify(e)}
          className="mx-auto max-w-[420px]"
        >
          <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
            Enter your code
          </h2>
          <p className="mt-1 text-[15px] text-gdb-ink/65">
            We sent a 6-digit code to {challenge.phone || "your phone"}.
          </p>
          {challenge.static_code && <DemoCode code={challenge.demo_code} />}
          {error && (
            <p className={`mt-4 ${errorBox}`} role="alert">
              {error}
            </p>
          )}
          <div className="mt-6">
            <OtpInput
              value={otp}
              onChange={(v) => {
                setError(null);
                setOtp(v);
              }}
              disabled={busy}
              invalid={!!error}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className={`mt-6 w-full ${goldActionClass("sm")} py-4 text-[16px]`}
          >
            {busy ? "Creating your account…" : "Verify and create account"}
            <ArrowRight size={18} />
          </button>
          <div className="mt-3 flex items-center justify-between text-[14px] font-extrabold">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStage("details");
              }}
              className="cursor-pointer text-gdb-ink/60 hover:text-gdb-ink"
            >
              ← Edit my details
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendCode()}
              className="cursor-pointer text-gdb-indigo hover:underline"
            >
              Send a new code
            </button>
          </div>
        </form>
      )}

      {stage === "done" && (
        <div className="mx-auto max-w-[420px] py-4 text-center">
          <span className="mx-auto mt-4 grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-3xl font-black text-emerald-700 ring-8 ring-emerald-50">
            ✓
          </span>
          <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
            You're signed in
          </h2>
          <p className="mt-2 text-[15px] text-gdb-ink/65">
            Your account is ready, {form.first_name}. Next time, sign in with
            your TIN, your password and a code.
          </p>
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className={`mt-7 w-full ${goldActionClass("sm")} py-4 text-[16px]`}
          >
            Go to my dashboard
            <ArrowRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A labelled control. The label holds only the field's name, so that is all
 *  a screen reader announces as it; `hint` sits beneath, outside it. */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block">
        <span className={fieldLabel}>
          {label}
          {required && <RequiredMark />}
        </span>
        {children}
      </label>
      {hint && <div className={fieldHelp}>{hint}</div>}
    </div>
  );
}

function Steps({ stage }: { stage: Stage }) {
  const steps: [Stage, string][] = [
    ["details", "Your details"],
    ["code", "Verify phone"],
    ["done", "Signed in"],
  ];
  const at = steps.findIndex(([s]) => s === stage);
  return (
    <ol
      className="flex items-center gap-2 text-[12px] font-extrabold"
      aria-label="Sign-up steps"
    >
      {steps.map(([s, label], i) => (
        <li
          key={s}
          className={`flex items-center gap-1.5 ${i <= at ? "text-brand-dark" : "text-gdb-ink/35"}`}
        >
          <span
            className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
              i < at
                ? "bg-brand text-white"
                : i === at
                  ? "bg-brand-dark text-amber-300"
                  : "border border-gdb-border"
            }`}
            aria-current={i === at ? "step" : undefined}
          >
            {i < at ? "✓" : i + 1}
          </span>
          <span className="hidden sm:inline">{label}</span>
          {i < steps.length - 1 && (
            <i className="block h-px w-4 bg-gdb-border" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}

/** While codes are fixed (tin_auth._static_otp), say so plainly. */
export function DemoCode({ code }: { code?: string }) {
  return (
    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
      <strong className="font-extrabold">Demo:</strong> codes are not sent yet —
      use{" "}
      <span className="font-mono font-extrabold">
        {code ?? "the demo code"}
      </span>
      .
    </p>
  );
}
