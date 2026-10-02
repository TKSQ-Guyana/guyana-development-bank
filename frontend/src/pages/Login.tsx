import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { EidBoxes } from '../components/EidBoxes';
import { RequiredMark } from '../components/ui/RequiredMark';
import { BankMark, FlagRibbon } from '../components/site/atoms';
import { EMPTY_EID, isCompleteEid } from '../eid';
import type { Whoami } from '../types';

/**
 * KEYCLOAK AUTHENTICATES EVERYBODY — two doors, one realm each, one page each:
 *
 *   /login        citizens   e-ID + password        -> gdb_bank.identity.password_login
 *   /staff/login  GDB staff  work email + password  -> gdb_bank.identity.staff_login
 *
 * Both end in the same `sid` session, so nothing downstream cares which was
 * used. Which door may open which kind of account is the server's decision
 * (security/sign_in_policy.py): the e-ID door never opens a staff account and
 * the staff door never opens a citizen's, whatever these pages offer.
 *
 * There is no sign-up. A citizen's account is created by their first e-ID
 * sign-in; a staff account by the platform administrator, who is shown a
 * one-time password for it. That password opens no session: the staff page
 * then asks the person to choose their own (identity.staff_set_password).
 */

// Mirrors identity.NEW_PASSWORD_MIN so the button can wait for it; the server
// decides.
const NEW_PASSWORD_MIN = 12;

// Staff have no loans of their own and nothing to resume at a stray deep link,
// so each lands on the desk they work from, even when `from` points at an
// application page (a bookmark, or an earlier unauthenticated attempt).
function landingFor(whoami: Whoami | null, from: string): string {
  if (whoami?.is_platform_admin) return '/admin/users';
  if (whoami?.is_underwriter) return '/review';
  if (whoami?.is_field_officer) return '/field';
  return from;
}

function useFrom() {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/';
}

const fieldLabel = 'block text-[14px] leading-[1.4] font-bold text-gdb-ink';
const fieldHelp = 'mt-1.5 text-[13px] leading-[1.5] text-gdb-ink/55';
const textInput =
  'mt-1.5 w-full rounded-[10px] border border-gdb-border bg-white px-3.5 py-[11px] font-body text-[15px] leading-[1.4] text-gdb-ink placeholder:text-gdb-ink/35 focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-gdb-indigo';
const errorBox = 'mb-4 rounded-[10px] bg-red-50 px-4 py-3 text-[14px] leading-[1.5] font-medium text-red-700';
const primaryButton =
  'mt-6 w-full cursor-pointer rounded-[10px] border-0 bg-gdb-ink py-3.5 font-body text-[15px] font-bold text-white hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-60';
const switchLink = 'font-bold text-gdb-indigo underline-offset-2 hover:underline';

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.14)" />
      <path d="M8 12.5l2.6 2.5L16 9.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The split frame both doors share: the dark panel says whose door this is,
 *  the card on the right is the door. */
function AuthFrame({
  workspace,
  eyebrow,
  headline,
  points,
  title,
  subtitle,
  children,
  below,
}: {
  workspace: string;
  eyebrow: string;
  headline: string;
  points: string[];
  title: string;
  subtitle: string;
  children: ReactNode;
  below: ReactNode;
}) {
  return (
    <div className="gdb-public flex min-h-screen flex-col bg-[#eef1f7] font-body text-gdb-ink">
      <FlagRibbon />
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="flex flex-col justify-between gap-12 bg-[linear-gradient(160deg,#0f172a_0%,#1e1b4b_55%,#2e2a7a_100%)] px-6 py-8 text-white sm:px-12 lg:w-[44%] lg:max-w-[640px] lg:py-10">
          <div className="flex items-center gap-3">
            <BankMark className="h-11 w-11 rounded-[12px] ring-1 ring-white/20" />
            <div>
              <div className="text-[15px] font-bold leading-tight">Guyana Development Bank</div>
              <div className="text-[13px] text-white/60">{workspace}</div>
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="font-code text-[12px] font-extrabold tracking-[0.12em] text-white/60">{eyebrow}</div>
            <h1 className="mt-4 max-w-[460px] font-display text-[40px] leading-[1.12] font-extrabold tracking-[-0.02em]">
              {headline}
            </h1>
            <ul className="mt-8 flex list-none flex-col gap-3.5">
              {points.map((point) => (
                <li key={point} className="flex gap-3 text-[15px] leading-[1.5] text-white/80">
                  <CheckIcon />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden text-[13px] text-white/50 lg:block">
            Government of Guyana &middot; Ministry of Finance
          </div>
        </aside>

        <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 sm:px-10">
          <div className="w-full max-w-[420px] rounded-2xl bg-white px-7 pt-8 pb-7 shadow-[0_14px_36px_-6px_rgba(15,23,42,0.12)] sm:px-9">
            <h2 className="font-display text-[24px] leading-[1.2] font-extrabold tracking-[-0.01em]">{title}</h2>
            <p className="mt-1 text-[14px] leading-[1.5] text-gdb-ink/60">{subtitle}</p>
            {children}
          </div>
          <p className="text-center text-[14px] text-gdb-ink/60">{below}</p>
        </main>
      </div>
    </div>
  );
}

/** Citizens: e-ID + password. The first sign-in opens the account. */
export function Login() {
  const { loginWithEid } = useAuth();
  const navigate = useNavigate();
  const from = useFrom();

  const [eid, setEid] = useState(EMPTY_EID);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const whoami = await loginWithEid(eid, password);
      navigate(landingFor(whoami, from), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      workspace="Applicant portal"
      eyebrow="GDB APPLICANT PORTAL"
      headline="Welcome to Guyana Development Bank."
      points={[]}
      title="Applicant sign-in"
      subtitle="New here? Your first sign-in opens your account."
      below={
        <>
          GDB staff?{' '}
          <Link to="/staff/login" state={{ from }} className={switchLink}>
            Go to the staff sign-in
          </Link>
        </>
      }
    >
      <form className="mt-6" onSubmit={(e) => void onSubmit(e)}>
        {error && (
          <p className={errorBox} role="alert">
            {error}
          </p>
        )}
        <span className={fieldLabel}>
          e-ID number
          <RequiredMark />
        </span>
        <div className="mt-1.5">
          <EidBoxes
            value={eid}
            onChange={setEid}
            disabled={busy}
            invalid={!!error}
            describedBy="eid-hint"
            variant="public"
          />
        </div>
        <p id="eid-hint" className={fieldHelp}>
          The 11-digit number on your national e-ID card.
        </p>

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

        <button type="submit" disabled={busy || !isCompleteEid(eid) || !password} className={primaryButton}>
          {busy ? 'Signing in…' : 'Sign in with e-ID'}
        </button>

        <hr className="mt-6 h-px border-0 bg-gdb-line" />
        <p className="mt-4 text-[13px] leading-[1.5] text-gdb-ink/55">
          You need a verified e-ID from My Guyana.
        </p>
      </form>
    </AuthFrame>
  );
}

/** GDB staff: work email + password. A first sign-in with the one-time
 *  password goes on to choosing their own. */
export function StaffLogin() {
  const { loginAsStaff, setStaffPassword } = useAuth();
  const navigate = useNavigate();
  const from = useFrom();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Second step of a first staff sign-in. The one-time password stays in
  // `password` — component state only — until the new one is saved.
  const [choosing, setChoosing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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

  return (
    <AuthFrame
      workspace="Staff workspace"
      eyebrow="GDB STAFF WORKSPACE"
      headline="Assess, disburse and service loans."
      points={[
        'Your role decides what you see and what you can approve.',
        'Every action is recorded against your name.',
        'Separation of duties is enforced at release.',
      ]}
      title={choosing ? 'Choose your password' : 'Staff sign-in'}
      subtitle={
        choosing
          ? `The one-time password works once. Choose your own to finish signing in as ${email}.`
          : 'For authorised Guyana Development Bank personnel.'
      }
      below={
        <>
          Applying for a loan?{' '}
          <Link to="/login" className={switchLink}>
            Go to the applicant sign-in
          </Link>
        </>
      }
    >
      <form className="mt-6" onSubmit={(e) => void (choosing ? onChoose(e) : onSubmit(e))}>
        {error && (
          <p className={errorBox} role="alert">
            {error}
          </p>
        )}
        {choosing ? (
          <>
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
            <label className="block">
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
              At least {NEW_PASSWORD_MIN} characters. Not the one-time password or your email.
              {/* Live, so a greyed-out button is never a mystery. */}
              {newPassword && newPassword.length < NEW_PASSWORD_MIN && (
                <span className="mt-1 block font-semibold text-rose-600">
                  {newPassword.length} of {NEW_PASSWORD_MIN} characters
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
              disabled={busy || newPassword.length < NEW_PASSWORD_MIN || !confirmPassword}
              className={primaryButton}
            >
              {busy ? 'Saving…' : 'Save password and sign in'}
            </button>
            <button
              type="button"
              onClick={backToSignIn}
              disabled={busy}
              className="mt-3 w-full cursor-pointer border-0 bg-transparent py-2 text-[14px] font-bold text-gdb-ink/60 hover:text-gdb-ink"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
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

            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="mt-3 text-center text-[13px] text-gdb-ink/55">
              New to GDB? Use the one-time password you were given.
            </p>

            <hr className="mt-6 h-px border-0 bg-gdb-line" />
            <p className="mt-4 text-[13px] leading-[1.5] text-gdb-ink/55">
              Locked out? <strong className="font-bold text-gdb-ink">Contact the platform administrator.</strong>
            </p>
          </>
        )}
      </form>
    </AuthFrame>
  );
}
