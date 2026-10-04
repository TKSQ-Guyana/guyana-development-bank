import {
  ID_DOCUMENT_KINDS,
  idNumberHint,
  idNumberProblem,
  NATIONAL_ID_CARD,
  nationalIdMismatch,
} from "../components/IdentityDetails";
import { gdbLogo } from "../components/site/assets";
import { useEffect, useRef, useState } from "react";
import { IdSampleLink } from "../components/IdSamples";
import { isGuyanaPhone, PhoneInput } from "../components/PhoneInput";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FaceCheck } from "../components/FaceCheck";
import {
  completeSignup,
  lookupNationalId,
  startFaceCheck,
  type FaceCheckStart,
  requestSignupOtp,
  type KycMatch,
  type OtpChallenge,
  type TinSignupForm,
} from "../api";
import { useAuth } from "../auth";
import { OtpInput } from "../components/OtpInput";
import { RequiredMark } from "../components/ui/RequiredMark";
import { ArrowRight, goldActionClass } from "../components/site/atoms";

/**
 * ONLINE SIGN-UP, as the card the login page shows in place of sign-in at
 * /signup (pages/Login.tsx). Three screens, and nothing is created until the third:
 *
 *   1. details      National ID (the KYC register's key, and what they sign in
 *                   with), names, optional email and TIN, phone, one identity
 *                   document, a password      -> tin_auth.request_signup_otp
 *   2. code         the one-time code sent to that phone
 *                                             -> tin_auth.complete_signup
 *   3. done         the account exists and this browser is signed in to it
 *
 * Every rule here is the server's too (gdb_bank/tin_auth.py) — the checks on
 * this page only spare a round trip.
 */

// The face check before the code is PAUSED (2026-10-04): details go straight
// to the phone code. Set true again together with face_check.enabled() on the
// server to bring it back; the FaceCheck step below is kept for that.
const FACE_CHECK_ON = false;

// An ID number as the register holds it (tin_auth.NID_SHAPE).
const NID_SHAPE = /^[A-Z0-9]{6,15}$/;
// The documents the server accepts at sign-up (tin_auth.DOCUMENT_KINDS): every
// identity document but a passport.
const DOCUMENT_KINDS = ID_DOCUMENT_KINDS.filter((k) => k !== "Passport");
// tin_auth.PASSWORD_MIN, and the PDF limit of every identity document.
const PASSWORD_MIN = 8;
// What the server accepts for an identity document (evidence.ACCEPTED_BY_TYPE):
// a PDF scan, or a photo in any format a phone camera saves.
const DOCUMENT_FORMATS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
];
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
  national_id: "",
  tin: "",
  password: "",
  confirm_password: "",
  document_kind: "",
  document_number: "",
  date_of_birth: "",
};

type Stage = "details" | "face" | "code" | "done";

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
  // The number is checked once the person leaves the box, not while typing.
  const [numberTouched, setNumberTouched] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The face check, where the KYC register has a photo to compare with.
  const [faceStart, setFaceStart] = useState<FaceCheckStart | null>(null);
  const [faceToken, setFaceToken] = useState("");

  const set = (key: keyof TinSignupForm) => (value: string) => {
    setError(null);
    if (key === "first_name" || key === "last_name" || key === "date_of_birth")
      edited.current.add(key);
    setForm((f) => ({ ...f, [key]: value }));
  };

  // The KYC register, asked as soon as a whole TIN is typed. What it knows
  // fills the form (still editable); the phone on record is shown masked, is
  // the only number the code can go to, and is used once the person confirms
  // it is theirs. Changing it is done in person, with a Field Officer.
  const [match, setMatch] = useState<KycMatch | null>(null);
  const [looking, setLooking] = useState(false);
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  // "Not your number?" — opens the note on changing it in person.
  const [notMine, setNotMine] = useState(false);
  // "Don't have a National ID?" — opens the note on getting one in person.
  const [noNationalId, setNoNationalId] = useState(false);
  const edited = useRef(new Set<string>());
  // As the register holds it: letters kept (a passport-style "R1234567").
  const nidNow = form.national_id.toUpperCase().replace(/[^A-Z0-9]/g, "");
  useEffect(() => {
    if (!NID_SHAPE.test(nidNow)) {
      setMatch(null);
      return;
    }
    let live = true;
    setLooking(true);
    const t = window.setTimeout(() => {
      lookupNationalId(nidNow)
        .then((m) => {
          if (!live) return;
          setMatch(m);
          setPhoneConfirmed(false);
          setNotMine(false);
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
    }, 600);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [nidNow]);
  // A phone on record is the only one the code may go to.
  const recordPhone = Boolean(match?.found && match.has_phone);
  const payload: TinSignupForm = {
    ...(recordPhone
      ? { ...form, phone: "", use_registry_phone: 1 as const }
      : { ...form, use_registry_phone: 0 as const }),
    face_token: faceToken,
  };

  /** Details done: the face check first, when one applies — then the code. */
  const proceed = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!FACE_CHECK_ON || faceToken) return sendCode();
    setError(null);
    setBusy(true);
    try {
      const started = await startFaceCheck(form.national_id);
      if (started.required) {
        setFaceStart(started);
        setStage("face");
        return;
      }
    } catch (err) {
      setBusy(false);
      return setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
    await sendCode();
  };

  const pwShort =
    form.password.length > 0 && form.password.length < PASSWORD_MIN;
  const pwMix =
    form.password.length > 0 &&
    !(/[A-Za-z]/.test(form.password) && /\d/.test(form.password));
  const mismatch =
    form.confirm_password.length > 0 && form.confirm_password !== form.password;
  const tinDigits = form.tin.replace(/\D/g, "");
  // The TIN is optional: blank, or the nine GRA digits.
  const tinOk = tinDigits.length === 0 || tinDigits.length === 9;
  const numberProblem =
    numberTouched && form.document_kind
      ? idNumberProblem(form.document_kind, form.document_number) ||
        nationalIdMismatch(
          form.document_kind,
          form.document_number,
          form.national_id,
        )
      : null;
  // A National ID card's number is the National ID typed above.
  const cardMatches =
    form.document_kind === NATIONAL_ID_CARD &&
    !!form.document_number &&
    !nationalIdMismatch(
      form.document_kind,
      form.document_number,
      form.national_id,
    );

  const ready =
    form.first_name.trim() &&
    form.last_name.trim() &&
    (recordPhone ? phoneConfirmed : isGuyanaPhone(form.phone)) &&
    !match?.has_account &&
    match?.online_signup !== false &&
    form.date_of_birth &&
    NID_SHAPE.test(nidNow) &&
    tinOk &&
    form.document_kind &&
    !idNumberProblem(form.document_kind, form.document_number) &&
    !nationalIdMismatch(
      form.document_kind,
      form.document_number,
      form.national_id,
    ) &&
    file &&
    form.password.length >= PASSWORD_MIN &&
    !pwMix &&
    form.confirm_password === form.password;

  const pickFile = (picked: File | null) => {
    setError(null);
    if (!picked) return setFile(null);
    const ext = picked.name.slice(picked.name.lastIndexOf(".")).toLowerCase();
    if (!DOCUMENT_FORMATS.includes(ext)) {
      setFile(null);
      return setError(
        `${picked.name}: attach a PDF or a photo (JPG, PNG, WEBP or HEIC).`,
      );
    }
    if (picked.size > MAX_BYTES) {
      setFile(null);
      return setError(`${picked.name} is larger than 10 MB.`);
    }
    setFile(picked);
  };

  const sendCode = async (e?: FormEvent, token?: string) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setChallenge(
        await requestSignupOtp({ ...payload, face_token: token ?? faceToken }),
      );
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
        <img
          src={gdbLogo}
          alt="Guyana Development Bank"
          className="block h-11 w-auto"
        />
        <Steps stage={stage} />
      </div>

      {stage === "details" && (
        <form onSubmit={(e) => void proceed(e)} noValidate>
          <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
            Create your account
          </h2>
          <p className="mt-1 text-[15px] text-gdb-ink/65">
            Start with your National ID — we fill in what is already on record,
            and send a code to your phone to confirm it is you.
          </p>
          {error && (
            <p className={`mt-5 ${errorBox}`} role="alert">
              {error}
            </p>
          )}

          <div className="mt-6">
            <Field
              label="National ID number"
              required
              hint="The Identity No. on your National ID card. You sign in with it."
            >
              <input
                autoComplete="username"
                placeholder="123456789"
                maxLength={20}
                spellCheck={false}
                value={form.national_id}
                onChange={(e) => {
                  const next = e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9\s-]/g, "");
                  set("national_id")(next);
                  // A National ID card already chosen below follows it.
                  if (
                    form.document_kind === NATIONAL_ID_CARD &&
                    (!form.document_number ||
                      form.document_number === form.national_id)
                  )
                    set("document_number")(next);
                }}
                disabled={busy}
                className={`${textInput} font-mono tracking-wider`}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <IdSampleLink kind="National ID Card" />
                <button
                  type="button"
                  onClick={() => setNoNationalId((v) => !v)}
                  aria-expanded={noNationalId}
                  className="cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-gdb-indigo hover:underline"
                >
                  Don&apos;t have a National ID?
                </button>
              </div>
              {noNationalId && (
                <div
                  role="note"
                  className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-950"
                >
                  <p className="font-bold">
                    You need a National ID to open an account.
                  </p>
                  <p className="mt-1">
                    Visit a <strong>GDB loan officer</strong> at any GDB branch.
                    They will help you get your National ID and register for a
                    loan account.
                  </p>
                </div>
              )}
            </Field>
            {looking && (
              <p className="mt-2 text-[13px] font-semibold text-gdb-ink/55">
                Looking up your record…
              </p>
            )}
            {!looking && match?.found && match.online_signup === false && (
              <div
                className="mt-3 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
                role="alert"
              >
                <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-amber-500 text-[13px] font-black text-white">
                  !
                </span>
                <p className="text-[14px] leading-[1.5] text-amber-900">
                  <b className="font-extrabold">
                    We found your record — {match.first_name} {match.last_name}.
                  </b>{" "}
                  {match.message}
                </p>
              </div>
            )}
            {!looking && match?.found && match.online_signup !== false && (
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
            {/* Not in GDB's records is fine: they type their details in. */}
            {!looking &&
              match &&
              !match.found &&
              !match.has_account &&
              NID_SHAPE.test(nidNow) && (
                <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] leading-[1.5] text-gdb-ink/75">
                  We couldn&apos;t find this National ID in GDB&apos;s records.
                  That&apos;s fine — enter your details below.
                </p>
              )}
            {!looking && match?.has_account && (
              <p className={`mt-3 ${errorBox}`}>
                This National ID already has an account.{" "}
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
                    The number on record for this National ID.
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
                {/* The number on record cannot be changed online — the server
                    refuses any other (tin_auth.PHONE_CHANGE_MESSAGE). */}
                <button
                  type="button"
                  onClick={() => setNotMine((v) => !v)}
                  aria-expanded={notMine}
                  disabled={busy}
                  className={`${fieldHelp} cursor-pointer border-0 bg-transparent p-0 font-bold text-gdb-indigo hover:underline`}
                >
                  Not your number?
                </button>
                {notMine && (
                  <div
                    role="note"
                    className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-950"
                  >
                    <p className="font-bold">
                      The number can&apos;t be changed online.
                    </p>
                    <p className="mt-1">
                      For your security, your sign-up code can only go to the
                      phone on record for this National ID. To change it, visit
                      a <strong>GDB Field Officer</strong> or any GDB branch
                      with your ID. Once it is updated, come back and sign up.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <Field
                label="Phone number"
                required
                hint="Your sign-in code is sent here."
              >
                <PhoneInput
                  value={form.phone}
                  onChange={set("phone")}
                  disabled={busy}
                  className={textInput}
                />
              </Field>
            )}
            <Field
              label="TIN"
              hint={
                tinOk ? (
                  "Optional. Your 9-digit GRA Taxpayer Identification Number, if you have one."
                ) : (
                  <span className="text-rose-600">
                    A TIN is 9 digits — check it, or leave it blank.
                  </span>
                )
              }
            >
              <input
                inputMode="numeric"
                placeholder="Optional"
                maxLength={11}
                value={form.tin}
                onChange={(e) =>
                  set("tin")(e.target.value.replace(/[^\d\s-]/g, ""))
                }
                disabled={busy}
                aria-invalid={!tinOk}
                className={`${textInput} font-mono tracking-wider`}
              />
            </Field>
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
                onChange={(e) => {
                  const kind = e.target.value;
                  set("document_kind")(kind);
                  // The National ID card's number is the one typed above.
                  if (kind === NATIONAL_ID_CARD)
                    set("document_number")(form.national_id);
                  else if (
                    form.document_kind === NATIONAL_ID_CARD &&
                    form.document_number === form.national_id
                  )
                    set("document_number")("");
                }}
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
              {form.document_kind && (
                <IdSampleLink kind={form.document_kind} className="mt-1.5" />
              )}
            </Field>
            <Field
              label={
                form.document_kind
                  ? `${form.document_kind} number`
                  : "Document number"
              }
              required
              hint={
                numberProblem ? (
                  <span className="text-rose-600">{numberProblem}</span>
                ) : cardMatches ? (
                  <span className="text-emerald-700">
                    ✓ Matches your National ID number
                  </span>
                ) : (
                  idNumberHint(form.document_kind)
                )
              }
            >
              <input
                value={form.document_number}
                onChange={(e) => set("document_number")(e.target.value)}
                onBlur={() => setNumberTouched(true)}
                disabled={busy || !form.document_kind}
                autoComplete="off"
                spellCheck={false}
                maxLength={30}
                placeholder={
                  form.document_kind
                    ? "As printed on it"
                    : "Choose the document first"
                }
                aria-invalid={!!numberProblem}
                className={`${textInput} font-mono tracking-wider`}
              />
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
                  accept={`${DOCUMENT_FORMATS.join(",")},application/pdf,image/*`}
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    pickFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <span className="min-w-0 truncate text-[14px] font-semibold text-gdb-ink/80">
                  {file ? `✓ ${file.name}` : "Choose a PDF or photo"}
                </span>
                <span className="rounded-lg bg-brand-dark px-3 py-1.5 text-[12px] font-extrabold text-white">
                  {file ? "Replace" : "Browse"}
                </span>
              </label>
              <p className={fieldHelp}>
                A PDF, or a clear photo of the document (JPG, PNG, WEBP, HEIC) —
                up to 10 MB.
              </p>
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
            {busy
              ? "Checking…"
              : // On the register, the face check comes next; off it, the code.
                FACE_CHECK_ON && match?.found
                ? "Proceed to face check"
                : "Continue — send my code"}
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

      {stage === "face" && faceStart && (
        <>
          {error && (
            <p className={`mt-5 ${errorBox}`} role="alert">
              {error}
            </p>
          )}
          <FaceCheck
            nationalId={form.national_id}
            start={faceStart}
            onBack={() => setStage("details")}
            onPassed={(token) => {
              setFaceToken(token);
              void sendCode(undefined, token);
            }}
          />
        </>
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
            your National ID, your password and a code.
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
    // ["face", "Face check"],  — paused, see FACE_CHECK_ON
    ...(FACE_CHECK_ON ? [["face", "Face check"] as [Stage, string]] : []),
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
