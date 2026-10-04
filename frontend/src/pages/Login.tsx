import { useState } from "react";
import { STAFF_LOGIN } from "../shared/staffRoutes";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { nationalIdLogin, verifyLoginOtp, type OtpChallenge } from "../api";
import { useAuth } from "../auth";
import { OtpInput } from "../components/OtpInput";
import { DemoCode, SignupCard } from "./Signup";
import { RequiredMark } from "../components/ui/RequiredMark";
import {
  BankMark,
  FlagRibbon,
  goldActionClass,
} from "../components/site/atoms";
import { ArrowRight } from "../components/site/atoms";
import type { Whoami } from "../types";

/**
 * KEYCLOAK AUTHENTICATES EVERYBODY — two doors:
 *
 *   citizens   National ID + password, then a one-time code
 *                                     -> gdb_bank.tin_auth.national_id_login / verify_login_otp
 *   GDB staff  work email + password  -> gdb_bank.identity.staff_login
 *
 * Both end in the same `sid` session, so nothing downstream cares which was
 * used. Which door may open which kind of account is the server's decision
 * (security/sign_in_policy.py): the staff door never opens a citizen's account,
 * whatever this page offers.
 *
 * A citizen opens an account by signing up with their National ID (/signup); a
 * staff account is made by the platform administrator, who is shown a
 * one-time password for it. That password opens no session: the staff pane
 * then asks the person to choose their own (identity.staff_set_password).
 */

// "tin" is the National ID door: the id stays, so ?method=tin links keep working.
type Method = "tin" | "staff";

// Mirrors identity.NEW_PASSWORD_MIN so the button can wait for it; the server
// decides.
const NEW_PASSWORD_MIN = 12;

// Staff have no loans of their own and nothing to resume at a stray deep link,
// so each lands on the desk they work from, even when `from` points at an
// application page (a bookmark, or an earlier unauthenticated attempt).
function landingFor(whoami: Whoami | null, from: string): string {
  if (whoami?.is_platform_admin) return "/admin/overview";
  if (whoami?.is_underwriter) return "/review";
  if (whoami?.is_field_officer) return "/field";
  return from;
}

export function Login({
  audience = "citizen",
}: { audience?: "citizen" | "staff" } = {}) {
  const staffOnly = audience === "staff";
  const { loginAsStaff, setStaffPassword, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Two pages, two audiences: /login is the citizens' (National ID), /staff/login
  // the staff's — never a tab of the other.
  const [method, setMethod] = useState<Method>(staffOnly ? "staff" : "tin");

  // TIN door: TIN + password, then the code. No session exists until the code.
  const [tin, setTin] = useState("");
  const [tinPassword, setTinPassword] = useState("");
  const [tinChallenge, setTinChallenge] = useState<OtpChallenge | null>(null);
  const [tinOtp, setTinOtp] = useState("");
  const [tinError, setTinError] = useState<string | null>(null);
  const [tinBusy, setTinBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Second step of a first staff sign-in. The one-time password stays in
  // `password` — component state only — until the new one is saved.
  const [choosing, setChoosing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // /signup is this page with the sign-up card in place of sign-in, so the
  // invitation stays put and the browser's Back button moves between them.
  const signingUp = location.pathname === "/signup";
  const tinReady =
    /^[A-Z0-9]{6,15}$/.test(tin.toUpperCase().replace(/[^A-Z0-9]/g, "")) &&
    !!tinPassword;

  const onTinSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setTinError(null);
    setTinBusy(true);
    try {
      setTinChallenge(await nationalIdLogin(tin, tinPassword));
      setTinOtp("");
    } catch (err) {
      setTinError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setTinBusy(false);
    }
  };

  const onTinVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!tinChallenge) return;
    setTinError(null);
    setTinBusy(true);
    try {
      await verifyLoginOtp(tinChallenge.challenge, tinOtp);
      const whoami = await refresh();
      navigate(landingFor(whoami, from), { replace: true });
    } catch (err) {
      setTinError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setTinBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await loginAsStaff(email, password);
      if (result.passwordChangeRequired) {
        setChoosing(true);
        return;
      }
      navigate(landingFor(result.whoami, from), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const onChoose = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const whoami = await setStaffPassword(email, password, newPassword);
      navigate(landingFor(whoami, from), { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Your password could not be saved",
      );
    } finally {
      setBusy(false);
    }
  };

  const backToSignIn = () => {
    setChoosing(false);
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const fieldLabel =
    "block text-[14px] leading-[1.4] font-extrabold text-gdb-ink";
  const fieldHelp = "mt-2 text-[13px] leading-[1.5] text-gdb-ink/55";
  const textInput =
    "mt-2 w-full rounded-xl border border-gdb-border bg-white px-[18px] py-[13px] font-body text-[16px] leading-[1.4] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo";
  const errorBox =
    "mb-4 rounded-xl bg-red-50 px-4 py-3 text-[14px] leading-[1.5] font-medium text-red-700";

  return (
    <div className="gdb-public min-h-screen bg-gdb-paper font-body text-gdb-ink">
      <FlagRibbon />

      <div className="flex min-h-[calc(100vh-6px)] flex-col lg:flex-row">
        {/* ---------- the invitation ---------- */}
        <section className="flex w-full flex-none flex-col justify-center bg-[linear-gradient(135deg,#E3F2EA_0%,#EEF6F1_42%,#FCFCFA_100%)] px-7 py-14 sm:px-14 sm:py-18 lg:w-[52%] xl:w-[720px] xl:py-24 xl:pr-24 xl:pl-26">
          <div className="flex items-center gap-4">
            <i className="block h-0.5 w-12 shrink-0 bg-gdb-goldleaf" />
            <span className="font-code text-[13px] font-extrabold tracking-[0.12em] text-gdb-indigo sm:text-[14px]">
              PROPOSED SME GROWTH PROGRAMME
            </span>
          </div>

          <h1 className="mt-[34px] font-display text-[44px] leading-[1.06] font-extrabold tracking-[-0.025em] sm:text-[52px] xl:text-[64px]">
            You build.
            <br />
            <span className="text-gdb-indigo">We clear the way.</span>
          </h1>

          <p className="mt-9 max-w-[520px] text-[17px] leading-[1.74] text-gdb-ink/80 sm:text-[18px]">
            An invitation to the Guyanese who already carry this economy. The
            proposed terms remove the usual barriers:{" "}
            <strong className="font-extrabold text-gdb-indigo">
              no collateral
            </strong>
            , so property or family wealth is not a condition, and{" "}
            <strong className="font-extrabold text-gdb-indigo">
              zero interest
            </strong>
            , so you repay what you borrowed and nothing more. Up to{" "}
            <strong className="font-extrabold text-gdb-indigo">G$3M</strong> a
            loan, with no co-financing above the cap.
          </p>

          <p className="mt-[22px] max-w-[520px] text-[17px] leading-[1.74] text-gdb-ink/70 sm:text-[18px]">
            You prepare your own application and a person makes every decision.
            Applying is free. No one can move you up the queue, and nobody
            should be charging you a fee to apply.
          </p>

          <div className="mt-13 flex items-center gap-[18px] text-[15px] font-extrabold text-gdb-ink/60">
            <i className="block h-0.5 w-12 shrink-0 bg-gdb-goldleaf" />
            Guyana, built forward
          </div>
        </section>

        {/* ---------- the credentials ---------- */}
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[22px] px-5 py-14 sm:px-16">
          {signingUp ? (
            <div className="w-full max-w-[600px]">
              <SignupCard
                onSignIn={() => {
                  setMethod("tin");
                  navigate("/login");
                }}
              />
            </div>
          ) : (
            <>
              <div className="w-full max-w-[452px] rounded-[28px] bg-white px-[38px] pt-9 pb-8 shadow-[0_14px_36px_-6px_rgba(15,23,42,0.09)]">
                <BankMark className="h-11 w-11 rounded-[14px]" />

                {staffOnly ? (
                  <>
                    <p className="mt-5 text-[12px] font-black tracking-[0.14em] text-amber-600 uppercase">
                      GDB staff
                    </p>
                    <h2 className="mt-1 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
                      Staff sign-in
                    </h2>
                    <p className="mt-1.5 text-[16px] leading-[1.5] text-gdb-ink/65">
                      Sign in with your work email. Your workspace opens on the
                      roles your account holds.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
                      Welcome back.
                    </h2>
                    <p className="mt-1.5 text-[16px] leading-[1.5] text-gdb-ink/65">
                      Sign in to continue your application.
                    </p>
                  </>
                )}

                {/* TIN credential set — then the one-time code */}
                <form
                  id="pane-tin"
                  hidden={method !== "tin"}
                  onSubmit={(e) =>
                    void (tinChallenge ? onTinVerify(e) : onTinSubmit(e))
                  }
                >
                  {tinChallenge ? (
                    <div className="mt-[26px]">
                      {tinError && (
                        <p className={errorBox} role="alert">
                          {tinError}
                        </p>
                      )}
                      <p className="text-[15px] leading-[1.55] text-gdb-ink/75">
                        <strong className="font-extrabold text-gdb-ink">
                          Enter your code.
                        </strong>{" "}
                        We sent a 6-digit code to{" "}
                        {tinChallenge.phone || "your phone"}.
                      </p>
                      {tinChallenge.static_code && (
                        <DemoCode code={tinChallenge.demo_code} />
                      )}
                      <div className="mt-5">
                        <OtpInput
                          value={tinOtp}
                          onChange={(v) => {
                            setTinError(null);
                            setTinOtp(v);
                          }}
                          disabled={tinBusy}
                          invalid={!!tinError}
                          autoFocus
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={tinBusy || tinOtp.length !== 6}
                        className={`mt-[22px] w-full ${goldActionClass("sm")} py-[17px] text-[17px]`}
                      >
                        {tinBusy ? "Signing in…" : "Verify and sign in"}
                        <ArrowRight size={19} />
                      </button>
                      <div className="mt-3 flex items-center justify-between text-[14px] font-extrabold">
                        <button
                          type="button"
                          disabled={tinBusy}
                          onClick={() => {
                            setTinChallenge(null);
                            setTinError(null);
                          }}
                          className="cursor-pointer border-0 bg-transparent text-gdb-ink/60 hover:text-gdb-ink"
                        >
                          ← Back
                        </button>
                        <button
                          type="button"
                          disabled={tinBusy}
                          onClick={() => void onTinSubmit()}
                          className="cursor-pointer border-0 bg-transparent text-gdb-indigo hover:underline"
                        >
                          Send a new code
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-[26px]">
                        {tinError && (
                          <p className={errorBox} role="alert">
                            {tinError}
                          </p>
                        )}
                        <label className="block">
                          <span className={fieldLabel}>
                            National ID number
                            <RequiredMark />
                          </span>
                          <input
                            autoComplete="username"
                            placeholder="123456789"
                            maxLength={20}
                            spellCheck={false}
                            value={tin}
                            onChange={(e) =>
                              setTin(
                                e.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z0-9\s-]/g, ""),
                              )
                            }
                            disabled={tinBusy}
                            className={`${textInput} font-mono tracking-wider`}
                          />
                        </label>
                        <p className={fieldHelp}>
                          The Identity No. on your National ID card — the number
                          you signed up with.
                        </p>
                      </div>
                      <label className="mt-4 block">
                        <span className={fieldLabel}>
                          Password
                          <RequiredMark />
                        </span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          value={tinPassword}
                          onChange={(e) => setTinPassword(e.target.value)}
                          disabled={tinBusy}
                          className={textInput}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={tinBusy || !tinReady}
                        className={`mt-[22px] w-full ${goldActionClass("sm")} py-[17px] text-[17px]`}
                      >
                        {tinBusy ? "Checking…" : "Continue"}
                        <ArrowRight size={19} />
                      </button>
                    </>
                  )}
                </form>

                {/* staff credential set — sign in, or (after a one-time password)
                choose your own */}
                <form
                  id="pane-staff"
                  hidden={method !== "staff"}
                  onSubmit={(e) => void (choosing ? onChoose(e) : onSubmit(e))}
                >
                  {choosing ? (
                    <>
                      <div className="mt-[26px]">
                        {error && (
                          <p className={errorBox} role="alert">
                            {error}
                          </p>
                        )}
                        <p className="text-[15px] leading-[1.55] text-gdb-ink/75">
                          <strong className="font-extrabold text-gdb-ink">
                            Choose your own password.
                          </strong>{" "}
                          The password GDB gave you works once. Choose one only
                          you know to finish signing in as{" "}
                          <span className="normal-case">{email}</span>.
                        </p>
                        {/* Lets a password manager file the new password under this email. */}
                        <input
                          type="email"
                          autoComplete="username"
                          value={email}
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                          className="sr-only"
                        />
                      </div>

                      <label className="mt-4 block">
                        <span className={fieldLabel}>
                          New password
                          <RequiredMark />
                        </span>
                        <input
                          type="password"
                          required
                          autoComplete="new-password"
                          minLength={NEW_PASSWORD_MIN}
                          placeholder="Choose a password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          disabled={busy}
                          aria-describedby="new-password-help"
                          className={textInput}
                        />
                      </label>
                      <p id="new-password-help" className={fieldHelp}>
                        At least {NEW_PASSWORD_MIN} characters. Not the one-time
                        password, and not your email.
                        {/* Live, so a greyed-out button is never a mystery. */}
                        {newPassword &&
                          newPassword.length < NEW_PASSWORD_MIN && (
                            <span className="mt-1 block font-semibold text-rose-600">
                              {newPassword.length} of {NEW_PASSWORD_MIN}{" "}
                              characters
                            </span>
                          )}
                      </p>

                      <label className="mt-4 block">
                        <span className={fieldLabel}>
                          Confirm new password
                          <RequiredMark />
                        </span>
                        <input
                          type="password"
                          required
                          autoComplete="new-password"
                          placeholder="Type it again"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={busy}
                          className={textInput}
                        />
                      </label>

                      <button
                        type="submit"
                        disabled={
                          busy ||
                          newPassword.length < NEW_PASSWORD_MIN ||
                          !confirmPassword
                        }
                        className={`mt-[22px] w-full ${goldActionClass("sm")} py-[17px] text-[17px]`}
                      >
                        {busy ? "Saving…" : "Save password and sign in"}
                        <ArrowRight size={19} />
                      </button>
                      <button
                        type="button"
                        onClick={backToSignIn}
                        disabled={busy}
                        className="mt-3 w-full cursor-pointer border-0 bg-transparent py-2 text-[14px] font-extrabold text-gdb-ink/60 hover:text-gdb-ink"
                      >
                        Back to sign in
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="mt-[26px]">
                        {error && (
                          <p className={errorBox} role="alert">
                            {error}
                          </p>
                        )}
                        <label className="block">
                          <span className={fieldLabel}>
                            Work email
                            <RequiredMark />
                          </span>
                          <input
                            type="email"
                            required
                            autoComplete="username"
                            placeholder="name@gdb.gov.gy"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={busy}
                            className={textInput}
                          />
                        </label>
                        <p className={fieldHelp}>
                          Your GDB work email. New to GDB? Sign in with the
                          one-time password GDB gave you — you will choose your
                          own next.
                        </p>
                      </div>

                      <label className="mt-4 block">
                        <span className={fieldLabel}>
                          Password
                          <RequiredMark />
                        </span>
                        <input
                          type="password"
                          required
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={busy}
                          className={textInput}
                        />
                      </label>

                      <button
                        type="submit"
                        disabled={busy}
                        className={`mt-[22px] w-full ${goldActionClass("sm")} py-[17px] text-[17px]`}
                      >
                        {busy ? "Signing in…" : "Sign in as GDB staff"}
                        <ArrowRight size={19} />
                      </button>
                    </>
                  )}
                </form>

                <footer className="mt-[22px]">
                  <hr className="h-px border-0 bg-gdb-line" />
                  <p className="mt-4 text-[16px] leading-[1.5] text-gdb-ink/70">
                    New applicant?{" "}
                    <Link
                      to="/signup"
                      className="font-extrabold text-gdb-indigo hover:underline"
                    >
                      Create an account with your National ID
                    </Link>
                    .
                  </p>
                </footer>
              </div>

              {/* One card, two doors: the roles that open the review queue, the
              disbursement desk, the ledger and the administration console are
              a grant on the staff account, made by the platform administrator. */}
              <p className="max-w-[452px] text-[15px] leading-[1.5] text-gdb-ink/55">
                {staffOnly ? (
                  <>
                    Applying for a loan?{" "}
                    <Link
                      to="/login"
                      className="font-extrabold text-gdb-indigo hover:underline"
                    >
                      Citizen sign-in
                    </Link>
                  </>
                ) : (
                  <>
                    GDB team member?{" "}
                    <Link
                      to={STAFF_LOGIN}
                      className="font-extrabold text-gdb-indigo hover:underline"
                    >
                      Staff sign-in
                    </Link>
                  </>
                )}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
