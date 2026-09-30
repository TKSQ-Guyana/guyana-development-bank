import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { EidBoxes } from '../components/EidBoxes';
import { RequiredMark } from '../components/ui/RequiredMark';
import { BankMark, FlagRibbon, goldActionClass, NotOpenIcon } from '../components/site/atoms';
import { ArrowRight } from '../components/site/atoms';
import { EMPTY_EID, isCompleteEid } from '../eid';
import type { Whoami } from '../types';

/**
 * KEYCLOAK AUTHENTICATES EVERYBODY — two doors, one realm each:
 *
 *   citizens   e-ID + password        -> gdb_bank.identity.password_login
 *   GDB staff  work email + password  -> gdb_bank.identity.staff_login
 *
 * Both end in the same `sid` session, so nothing downstream cares which was
 * used. Which door may open which kind of account is the server's decision
 * (security/sign_in_policy.py): the e-ID door never opens a staff account and
 * the staff door never opens a citizen's, whatever this page offers.
 *
 * There is no sign-up. A citizen's account is created by their first e-ID
 * sign-in; a staff account by the platform administrator, who is shown a
 * one-time password for it. That password opens no session: the staff pane
 * then asks the person to choose their own (identity.staff_set_password).
 */

type Method = 'eid' | 'staff';

// Mirrors identity.NEW_PASSWORD_MIN so the button can wait for it; the server
// decides.
const NEW_PASSWORD_MIN = 12;

// Staff have no loans of their own and nothing to resume at a stray deep link,
// so each lands on the desk they work from, even when `from` points at an
// application page (a bookmark, or an earlier unauthenticated attempt).
function landingFor(whoami: Whoami | null, from: string): string {
  if (whoami?.is_platform_admin) return '/admin/users';
  if (whoami?.is_underwriter) return '/review';
  return from;
}

export function Login() {
  const { loginAsStaff, loginWithEid, setStaffPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [method, setMethod] = useState<Method>('eid');

  const [eid, setEid] = useState(EMPTY_EID);
  const [eidPassword, setEidPassword] = useState('');
  const [eidError, setEidError] = useState<string | null>(null);
  const [eidBusy, setEidBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Second step of a first staff sign-in. The one-time password stays in
  // `password` — component state only — until the new one is saved.
  const [choosing, setChoosing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onEidSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEidError(null);
    setEidBusy(true);
    try {
      const whoami = await loginWithEid(eid, eidPassword);
      navigate(landingFor(whoami, from), { replace: true });
    } catch (err) {
      setEidError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setEidBusy(false);
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
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const onChoose = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const whoami = await setStaffPassword(email, password, newPassword);
      navigate(landingFor(whoami, from), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your password could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const backToSignIn = () => {
    setChoosing(false);
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const tab = (value: Method, label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${value}`}
      aria-selected={method === value}
      aria-controls={`pane-${value}`}
      onClick={() => setMethod(value)}
      className={`flex-1 cursor-pointer rounded-[10px] border-0 py-[11px] font-body text-[15px] leading-[1.2] font-extrabold ${
        method === value
          ? 'bg-gdb-ink text-white shadow-[0_2px_6px_-1px_rgba(22,0,66,0.16)]'
          : 'bg-transparent text-gdb-ink/55'
      }`}
    >
      {label}
    </button>
  );

  const fieldLabel = 'block text-[14px] leading-[1.4] font-extrabold text-gdb-ink';
  const fieldHelp = 'mt-2 text-[13px] leading-[1.5] text-gdb-ink/55';
  const textInput =
    'mt-2 w-full rounded-xl border border-gdb-border bg-white px-[18px] py-[13px] font-body text-[16px] leading-[1.4] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo';
  const errorBox =
    'mb-4 rounded-xl bg-red-50 px-4 py-3 text-[14px] leading-[1.5] font-medium text-red-700';

  return (
    <div className="gdb-public min-h-screen bg-gdb-paper font-body text-gdb-ink">
      <FlagRibbon />

      <div className="flex min-h-[calc(100vh-6px)] flex-col lg:flex-row">
        {/* ---------- the invitation ---------- */}
        <section className="flex w-full flex-none flex-col justify-center bg-[linear-gradient(135deg,#E7ECFA_0%,#EFF1FB_42%,#FCFCFA_100%)] px-7 py-14 sm:px-14 sm:py-18 lg:w-[52%] xl:w-[720px] xl:py-24 xl:pr-24 xl:pl-26">
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
            An invitation to the Guyanese who already carry this economy. The proposed terms remove
            the usual barriers: <strong className="font-extrabold text-gdb-indigo">no collateral</strong>,
            so property or family wealth is not a condition, and{' '}
            <strong className="font-extrabold text-gdb-indigo">zero interest</strong>, so you repay
            what you borrowed and nothing more. Up to{' '}
            <strong className="font-extrabold text-gdb-indigo">G$3M</strong> a loan, with no
            co-financing above the cap.
          </p>

          <p className="mt-[22px] max-w-[520px] text-[17px] leading-[1.74] text-gdb-ink/70 sm:text-[18px]">
            You prepare your own application and a person makes every decision. Applying is free. No
            one can move you up the queue, and nobody should be charging you a fee to apply.
          </p>

          <div className="mt-[34px] flex items-center gap-[11px] text-[16px] font-extrabold text-gdb-ink/85">
            <NotOpenIcon />
            The programme is not yet open.
          </div>

          <div className="mt-13 flex items-center gap-[18px] text-[15px] font-extrabold text-gdb-ink/60">
            <i className="block h-0.5 w-12 shrink-0 bg-gdb-goldleaf" />
            Guyana, built forward
          </div>
        </section>

        {/* ---------- the credentials ---------- */}
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[22px] px-5 py-14 sm:px-16">
          <div className="w-full max-w-[452px] rounded-[28px] bg-white px-[38px] pt-9 pb-8 shadow-[0_14px_36px_-6px_rgba(22,0,66,0.09)]">
            <BankMark className="h-11 w-11 rounded-[14px]" />

            <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
              Welcome back.
            </h2>
            <p className="mt-1.5 text-[16px] leading-[1.5] text-gdb-ink/65">
              Sign in to continue your application.
            </p>

            <div
              role="tablist"
              aria-label="Choose how to sign in"
              className="mt-[26px] flex gap-1 rounded-[13px] bg-gdb-rail p-1"
            >
              {tab('eid', 'e-ID number')}
              {tab('staff', 'GDB staff')}
            </div>

            {/* e-ID credential set */}
            <form
              id="pane-eid"
              role="tabpanel"
              aria-labelledby="tab-eid"
              hidden={method !== 'eid'}
              onSubmit={(e) => void onEidSubmit(e)}
            >
              <div className="mt-[26px]">
                {eidError && (
                  <p className={errorBox} role="alert">
                    {eidError}
                  </p>
                )}
                <span className={fieldLabel}>e-ID number<RequiredMark /></span>
                <div className="mt-2">
                  <EidBoxes
                    value={eid}
                    onChange={setEid}
                    disabled={eidBusy}
                    invalid={!!eidError}
                    describedBy="eid-hint"
                    variant="public"
                  />
                </div>
                <p id="eid-hint" className={fieldHelp}>
                  The 11-digit number on your national e-ID card.
                </p>
              </div>

              <label className="mt-4 block">
                <span className={fieldLabel}>Password<RequiredMark /></span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={eidPassword}
                  onChange={(e) => setEidPassword(e.target.value)}
                  disabled={eidBusy}
                  className={textInput}
                />
              </label>

              <button
                type="submit"
                disabled={eidBusy || !isCompleteEid(eid) || !eidPassword}
                className={`mt-[22px] w-full ${goldActionClass('sm')} py-[17px] text-[17px]`}
              >
                {eidBusy ? 'Signing in…' : 'Sign in with e-ID'}
                <ArrowRight size={19} />
              </button>
            </form>

            {/* staff credential set — sign in, or (after a one-time password)
                choose your own */}
            <form
              id="pane-staff"
              role="tabpanel"
              aria-labelledby="tab-staff"
              hidden={method !== 'staff'}
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
                      <strong className="font-extrabold text-gdb-ink">Choose your own password.</strong>{' '}
                      The password GDB gave you works once. Choose one only you know to finish signing in
                      as {email}.
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
                    <span className={fieldLabel}>New password<RequiredMark /></span>
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
                    At least {NEW_PASSWORD_MIN} characters. Not the one-time password, and not your
                    email.
                  </p>

                  <label className="mt-4 block">
                    <span className={fieldLabel}>Confirm new password<RequiredMark /></span>
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
                    disabled={busy || newPassword.length < NEW_PASSWORD_MIN || !confirmPassword}
                    className={`mt-[22px] w-full ${goldActionClass('sm')} py-[17px] text-[17px]`}
                  >
                    {busy ? 'Saving…' : 'Save password and sign in'}
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
                      <span className={fieldLabel}>Work email<RequiredMark /></span>
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
                      Your GDB work email. New to GDB? Sign in with the one-time password GDB gave you —
                      you will choose your own next.
                    </p>
                  </div>

                  <label className="mt-4 block">
                    <span className={fieldLabel}>Password<RequiredMark /></span>
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
                    className={`mt-[22px] w-full ${goldActionClass('sm')} py-[17px] text-[17px]`}
                  >
                    {busy ? 'Signing in…' : 'Sign in as GDB staff'}
                    <ArrowRight size={19} />
                  </button>
                </>
              )}
            </form>

            <footer className="mt-[22px]">
              <hr className="h-px border-0 bg-gdb-line" />
              <p className="mt-4 text-[16px] leading-[1.5] text-gdb-ink/70">
                New applicant? Sign in with your e-ID — your account is opened the first time you
                do.
              </p>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-gdb-ink/50">
                You will need a verified e-ID from My Guyana.
              </p>
            </footer>
          </div>

          {/* One card, two doors: the roles that open the review queue, the
              disbursement desk, the ledger and the administration console are
              a grant on the staff account, made by the platform administrator. */}
          <p className="max-w-[452px] text-[15px] leading-[1.5] text-gdb-ink/55">
            GDB team member? Choose <strong className="font-extrabold">GDB staff</strong> and sign in
            with your work email — your workspace opens on the roles your account holds.
          </p>
        </section>
      </div>
    </div>
  );
}
