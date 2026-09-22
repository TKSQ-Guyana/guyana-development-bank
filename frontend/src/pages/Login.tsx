import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { EidBoxes } from '../components/EidBoxes';
import { BankMark, FlagRibbon, goldActionClass, NotOpenIcon } from '../components/site/atoms';
import { ArrowRight } from '../components/site/atoms';
import { EMPTY_EID, isCompleteEid } from '../eid';

/**
 * TWO WAYS IN, deliberately, while e-ID sign-in is being proven:
 *
 *   e-ID + password   -> Keycloak (gdb_bank.identity.password_login)
 *   email + password  -> Frappe's own login, untouched
 *
 * Both end in the same `sid` session, so nothing downstream cares which was
 * used. The email form stays because the stack's seeded demo accounts and
 * every existing verification step still go through it; retiring it is a
 * later, separate decision (System Settings.disable_user_pass_login).
 *
 * The two are now a segmented CHOICE rather than two stacked forms. That is a
 * presentation change only — both submit handlers are untouched. What it buys
 * is that a citizen sees one credential at a time and reaches for their e-ID
 * card first, which is the path this programme is meant to run on; the email
 * form is still one click away for everyone it is still the path for.
 */

type Method = 'eid' | 'email';

export function Login() {
  const { login, loginWithEid } = useAuth();
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

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onEidSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEidError(null);
    setEidBusy(true);
    try {
      await loginWithEid(eid, eidPassword);
      navigate(from, { replace: true });
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
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
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
              {tab('email', 'Email')}
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
                <span className={fieldLabel}>e-ID number</span>
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
                <span className={fieldLabel}>Password</span>
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

            {/* email credential set */}
            <form
              id="pane-email"
              role="tabpanel"
              aria-labelledby="tab-email"
              hidden={method !== 'email'}
              onSubmit={(e) => void onSubmit(e)}
            >
              <div className="mt-[26px]">
                {error && (
                  <p className={errorBox} role="alert">
                    {error}
                  </p>
                )}
                <label className="block">
                  <span className={fieldLabel}>Email</span>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                    className={textInput}
                  />
                </label>
                <p className={fieldHelp}>The email address registered against your e-ID.</p>
              </div>

              <label className="mt-4 block">
                <span className={fieldLabel}>Password</span>
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
                {busy ? 'Signing in…' : 'Sign in with email'}
                <ArrowRight size={19} />
              </button>
            </form>

            <footer className="mt-[22px]">
              <hr className="h-px border-0 bg-gdb-line" />
              <p className="mt-4 text-[16px] leading-[1.5] text-gdb-ink/70">
                New applicant?{' '}
                <Link to="/signup" className="font-extrabold text-gdb-indigo">
                  Create an account
                </Link>
              </p>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-gdb-ink/50">
                You will need a verified e-ID from My Guyana to open one.
              </p>
            </footer>
          </div>

          {/* GDB staff sign in through this same form — the roles that open the
              review queue, the disbursement desk and the ledger are a Frappe
              grant against the account, not a separate door. Saying so beats
              the mockup's "staff workspace" link, which would have to lead
              back to this very card. */}
          <p className="max-w-[452px] text-[15px] leading-[1.5] text-gdb-ink/55">
            GDB team member? Sign in here with your GDB credentials — your workspace opens on the
            roles held by your account.
          </p>
        </section>
      </div>
    </div>
  );
}
