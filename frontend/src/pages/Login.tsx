import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { beginSignIn } from '../shared/identity/oidc';

/**
 * The door.
 *
 * ONE PRIMARY WAY IN: e-ID. The button leaves this page — under Authorization
 * Code + PKCE the credential itself is typed on Keycloak's page, never here,
 * which is the point: this SPA never sees a password and has no opportunity to
 * mishandle one. The three-box e-ID control lives in the Keycloak login theme
 * (keycloak-local/themes/gdb), branded to match this page so the hand-off does
 * not read as leaving the Bank.
 *
 * THE EMAIL FORM IS DEMOTED, NOT DELETED. Every seeded demo account and every
 * verification step in the docs still signs in this way, and Frappe's own desk
 * uses it. Retiring it is a deliberate later decision (System Settings
 * `disable_user_pass_login`), not something to do quietly in a redesign.
 */
export function Login() {
  const { login, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [eidBusy, setEidBusy] = useState(false);
  const [eidError, setEidError] = useState<string | null>(null);

  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onEidSignIn = async () => {
    if (!signIn) return;
    setEidError(null);
    setEidBusy(true);
    try {
      // Leaves the page on success, so there is no "finally setEidBusy(false)":
      // the button should stay in its busy state while the browser navigates.
      await beginSignIn(signIn, from);
    } catch (err) {
      setEidError(err instanceof Error ? err.message : 'Sign-in could not be started.');
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

  // `signIn === null` while the config is still loading AND when it could not
  // be reached. Both render the button disabled rather than absent: a control
  // that vanishes tells the citizen nothing, and a site with the identity
  // service down should say so out loud.
  const canUseEid = signIn?.configured === true;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-black text-gdb-gold">
            G
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Guyana Development Bank</h1>
          <p className="text-sm text-slate-500">
            Citizen portal — sign in to apply for and manage your financing
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_24px_60px_-28px_rgba(30,58,138,0.45)]">
          {eidError && (
            <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {eidError}
            </p>
          )}

          <button
            type="button"
            onClick={() => void onEidSignIn()}
            disabled={!canUseEid || eidBusy}
            className="w-full rounded-full bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {eidBusy ? 'Taking you to sign in…' : 'Sign in with e-ID'}
          </button>

          <p className="mt-2 text-center text-xs text-slate-500">
            {canUseEid
              ? 'You will be asked for your 11-digit e-ID number and password.'
              : signIn === null
                ? 'Checking whether e-ID sign-in is available…'
                : 'e-ID sign-in is not configured on this site.'}
          </p>

          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {!showEmail ? (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="w-full rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Staff and demo sign-in
            </button>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
              {error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {error}
                </p>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full border border-brand px-4 py-2 font-semibold text-brand hover:bg-brand-light disabled:opacity-60"
              >
                {busy ? 'Signing in…' : 'Sign in with email'}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-sm text-slate-500">
            New here?{' '}
            <Link to="/signup" className="font-medium text-brand hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
