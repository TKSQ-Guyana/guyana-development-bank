import { useState } from "react";
import type { FormEvent } from "react";
import { FocusAlert } from "../shared/FocusAlert";
import { requestPasswordReset, resetPassword, type OtpChallenge } from "../api";
import { OtpInput } from "../components/OtpInput";
import { RequiredMark } from "../components/ui/RequiredMark";
import { ArrowRight, goldActionClass } from "../components/site/atoms";
import { DemoCode } from "./Signup";

/**
 * FORGOT PASSWORD — in the sign-in card, in place of the National ID form.
 *
 *   1. the ID number       -> gdb_bank.tin_auth.request_password_reset
 *                             (a code to the phone already on the account)
 *   2. code + new password -> gdb_bank.tin_auth.reset_password
 *
 * Nobody is signed in here: onDone() hands the ID back to the sign-in form,
 * which then asks for the new password (and a sign-in code) as usual.
 */

// Mirrors tin_auth.PASSWORD_MIN; the server decides.
const PASSWORD_MIN = 8;

const fieldLabel =
  "block text-[14px] leading-[1.4] font-extrabold text-gdb-ink";
const fieldHelp = "mt-2 text-[13px] leading-[1.5] text-gdb-ink/55";
const textInput =
  "mt-2 w-full rounded-xl border border-gdb-border bg-white px-[18px] py-[13px] font-body text-[16px] leading-[1.4] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo";
const errorBox =
  "mb-4 rounded-xl bg-red-50 px-4 py-3 text-[14px] leading-[1.5] font-medium text-red-700";
const linkButton =
  "cursor-pointer border-0 bg-transparent text-[14px] font-extrabold";

export function ForgotPassword({
  initialId = "",
  onCancel,
  onDone,
}: {
  initialId?: string;
  onCancel: () => void;
  onDone: (nationalId: string) => void;
}) {
  const [nid, setNid] = useState(initialId);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idReady = /^[A-Z0-9]{6,15}$/.test(
    nid.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  );
  const resetReady =
    otp.length === 6 && password.length >= PASSWORD_MIN && !!confirm;

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setChallenge(await requestPasswordReset(nid));
      setOtp("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The code could not be sent",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const out = await resetPassword(
        challenge.challenge,
        otp,
        password,
        confirm,
      );
      onDone(out.national_id || nid);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your password could not be changed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-[26px]"
      onSubmit={(e) => void (challenge ? save(e) : sendCode(e))}
    >
      <p className="font-display text-[20px] leading-[1.3] font-extrabold">
        Reset your password
      </p>
      {error && <FocusAlert className={`mt-4 ${errorBox}`}>{error}</FocusAlert>}

      {challenge ? (
        <>
          <p className="mt-2 text-[15px] leading-[1.55] text-gdb-ink/75">
            We sent a 6-digit code to {challenge.phone || "your phone"}. Enter
            it and choose a new password.
          </p>
          {challenge.static_code && <DemoCode code={challenge.demo_code} />}
          <div className="mt-5">
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
          {/* Lets a password manager file the new password under this ID. */}
          <input
            autoComplete="username"
            value={nid}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
          />
          <label className="mt-5 block">
            <span className={fieldLabel}>
              New password
              <RequiredMark />
            </span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Choose a new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className={textInput}
            />
          </label>
          <p className={fieldHelp}>
            At least {PASSWORD_MIN} characters, with a letter and a number. It
            cannot contain your ID number.
          </p>
          <label className="mt-4 block">
            <span className={fieldLabel}>
              Confirm new password
              <RequiredMark />
            </span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              className={textInput}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !resetReady}
            className={`mt-[22px] w-full ${goldActionClass("sm")} py-[17px] text-[17px]`}
          >
            {busy ? "Saving…" : "Save new password"}
            <ArrowRight size={19} />
          </button>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
              className={`${linkButton} text-gdb-ink/60 hover:text-gdb-ink`}
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendCode()}
              className={`${linkButton} text-black hover:underline`}
            >
              Send a new code
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-[15px] leading-[1.55] text-gdb-ink/75">
            Enter the ID number you signed up with. We will text a code to the
            phone number on your account.
          </p>
          <label className="mt-5 block">
            <span className={fieldLabel}>
              National ID/Passport/E-ID Number
              <RequiredMark />
            </span>
            <input
              autoComplete="username"
              placeholder="123456789"
              maxLength={20}
              spellCheck={false}
              value={nid}
              onChange={(e) =>
                setNid(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, ""),
                )
              }
              disabled={busy}
              autoFocus
              className={`${textInput} font-mono tracking-wider`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !idReady}
            className={`mt-[22px] w-full ${goldActionClass("sm")} py-[17px] text-[17px]`}
          >
            {busy ? "Sending…" : "Send me a code"}
            <ArrowRight size={19} />
          </button>
          <div className="mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className={`${linkButton} text-gdb-ink/60 hover:text-gdb-ink`}
            >
              ← Back to sign in
            </button>
          </div>
        </>
      )}
    </form>
  );
}
