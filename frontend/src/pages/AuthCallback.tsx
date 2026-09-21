import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { completeSignIn } from '../shared/identity/oidc';

/**
 * Where Keycloak sends the citizen back to.
 *
 * THIS SCREEN'S REAL JOB IS THE FAILURE CASE. The happy path is invisible — a
 * spinner for as long as one token exchange takes. But a callback can fail for
 * half a dozen reasons that are not the citizen's fault (a spent verifier, a
 * stale tab, a clock skew, an identity service that went away mid-flow), and
 * every one of them arrives here. Rendering nothing on failure leaves a blank
 * page at the end of a sign-in, which is indistinguishable from the portal
 * being broken.
 */
export function AuthCallback() {
  const { signIn, adopt } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  // React 18 StrictMode mounts effects twice in development. An authorization
  // code is single-use, so the second run would redeem a spent code and report
  // a failure for a sign-in that actually succeeded.
  const started = useRef(false);

  useEffect(() => {
    if (!signIn || started.current) return;
    started.current = true;

    completeSignIn(signIn, params)
      .then(({ identity, returnTo }) => {
        adopt(identity);
        // `replace`, so Back does not return to a callback URL whose code has
        // already been redeemed.
        navigate(returnTo === '/login' ? identity.portal_home : returnTo, { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Sign-in could not be completed.');
      });
  }, [signIn, params, adopt, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/70 bg-white p-8 text-center shadow-[0_24px_60px_-28px_rgba(30,58,138,0.45)]">
        {error ? (
          <>
            <h1 className="text-lg font-bold text-slate-900">Sign-in did not complete</h1>
            <p className="mt-2 text-sm text-slate-600" role="alert">
              {error}
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block rounded-full bg-brand px-5 py-2 font-semibold text-white hover:bg-brand-dark"
            >
              Try again
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-slate-900">Signing you in…</h1>
            <p className="mt-2 text-sm text-slate-500">Confirming your e-ID with the Bank.</p>
          </>
        )}
      </div>
    </div>
  );
}
