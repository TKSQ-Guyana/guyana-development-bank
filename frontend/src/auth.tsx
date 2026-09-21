import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, call, login as apiLogin } from './api';
import type { Identity } from './shared/rbac';
import { endKeycloakSession, fetchSignInConfig } from './shared/identity/oidc';
import type { SignInConfig } from './shared/identity/oidc';

interface AuthState {
  user: Identity | null;
  loading: boolean;
  /** Null until `sign_in_config` answers; `configured: false` on a site with no
   *  identity service, so the login page can explain itself rather than
   *  redirecting into a host that does not exist. */
  signIn: SignInConfig | null;
  /** The pre-registry email/password path. Kept for the seeded demo accounts
   *  and every verification step that still uses them. */
  login: (email: string, password: string) => Promise<void>;
  signup: (fullName: string, email: string, password: string) => Promise<void>;
  /** Adopt an identity the PKCE callback has already established server-side. */
  adopt: (identity: Identity) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [signIn, setSignIn] = useState<SignInConfig | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUser(await call<Identity>('gdb_bank.api.v1_identity.whoami'));
    } catch (err) {
      // 401/403 is the ordinary "not signed in" answer, not a fault. Anything
      // else is worth a console line for a developer — silently treating a 500
      // as "logged out" is how a backend outage presents as a login loop.
      if (!(err instanceof ApiError && (err.status === 401 || err.status === 403))) {
        console.error('[gdb] whoami failed', err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Independent of the session: the login page needs this *before* anyone is
    // signed in, and a failure here must not block the portal for someone who
    // already is.
    fetchSignInConfig()
      .then(setSignIn)
      .catch((err: unknown) => {
        console.error('[gdb] sign-in config unavailable', err);
        setSignIn(null);
      });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await apiLogin(email, password);
      await refresh();
    },
    [refresh],
  );

  const signup = useCallback(
    async (fullName: string, email: string, password: string) => {
      await call('gdb_bank.api.signup', { full_name: fullName, email, password });
      await apiLogin(email, password);
      await refresh();
    },
    [refresh],
  );

  const adopt = useCallback((identity: Identity) => {
    // `exchange_token` already returned the same payload `whoami` would, so
    // re-fetching it would be a second round trip for an answer we hold.
    setUser(identity);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    let endSessionUrl: string | null = null;
    let clientId = signIn?.client_id ?? '';
    // Held by the backend for the life of the session, never by this SPA — it
    // carries PII. Passed straight to `endKeycloakSession` and not retained.
    let idTokenHint: string | null = null;
    try {
      const result = await call<{
        end_session_url: string | null;
        client_id: string;
        id_token_hint: string | null;
      }>('gdb_bank.api.v1_identity.sign_out');
      endSessionUrl = result.end_session_url;
      clientId = result.client_id || clientId;
      idTokenHint = result.id_token_hint;
    } catch (err) {
      // The Frappe session may or may not have ended. Clearing local state and
      // continuing to Keycloak is still the right move: leaving the citizen on
      // a page that looks signed-in is the worse failure.
      console.error('[gdb] sign-out call failed', err);
    } finally {
      setUser(null);
    }
    // Leaves the page. Keycloak returns the browser to /login — without a
    // confirmation step, as long as the hint survived the call above.
    endKeycloakSession(endSessionUrl, clientId, idTokenHint);
  }, [signIn]);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, login, signup, adopt, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
