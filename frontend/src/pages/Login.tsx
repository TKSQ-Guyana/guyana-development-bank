import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gdb-green text-2xl font-black text-gdb-gold">
            G
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Guyana Development Bank</h1>
          <p className="text-sm text-slate-500">Citizen Portal — sign in to manage your loans</p>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 rounded-xl bg-white p-6 shadow">
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gdb-green px-4 py-2 font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-sm text-slate-500">
            New here?{' '}
            <Link to="/signup" className="font-medium text-gdb-green hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
