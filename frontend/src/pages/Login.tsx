import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { EidBoxes } from '../components/EidBoxes';
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
 */
export function Login() {
  const { login, loginWithEid } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gdb-green text-2xl font-black text-gdb-gold">
            G
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Guyana Development Bank</h1>
          <p className="text-sm text-slate-500">Citizen Portal — sign in to manage your loans</p>
        </div>

        <div className="rounded-xl bg-white p-6 shadow">
          <form onSubmit={(e) => void onEidSubmit(e)} className="space-y-4">
            {eidError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {eidError}
              </p>
            )}
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">e-ID Number</span>
              <EidBoxes
                value={eid}
                onChange={setEid}
                disabled={eidBusy}
                invalid={!!eidError}
                describedBy="eid-hint"
                autoFocus
              />
              <p id="eid-hint" className="mt-1 text-xs text-slate-500">
                The 11-digit number on your national e-ID card.
              </p>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={eidPassword}
                onChange={(e) => setEidPassword(e.target.value)}
                disabled={eidBusy}
                className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
              />
            </label>
            <button
              type="submit"
              disabled={eidBusy || !isCompleteEid(eid) || !eidPassword}
              className="w-full rounded-md bg-gdb-green px-4 py-2 font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
            >
              {eidBusy ? 'Signing in…' : 'Sign in with e-ID'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
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
                className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md border border-gdb-green px-4 py-2 font-semibold text-gdb-green hover:bg-green-50 disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in with email'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            New here?{' '}
            <Link to="/signup" className="font-medium text-gdb-green hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
