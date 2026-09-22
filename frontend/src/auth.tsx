import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
  call,
  eidLogin as apiEidLogin,
  login as apiLogin,
  logout as apiLogout,
} from './api';
import type { Whoami } from './types';

interface AuthState {
  user: Whoami | null;
  loading: boolean;
  /** Resolves to who just signed in, so the caller can route by role (an
   *  underwriter has nowhere useful to land but the review queue) without
   *  waiting a render cycle for context state to catch up. */
  login: (email: string, password: string) => Promise<Whoami | null>;
  /** Sign in with a national e-ID (`123-4567-8901`) via Keycloak. */
  loginWithEid: (eid: string, password: string) => Promise<Whoami | null>;
  signup: (fullName: string, email: string, password: string) => Promise<Whoami | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Whoami | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const whoami = await call<Whoami>('gdb_bank.api.whoami');
      setUser(whoami);
      return whoami;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUser(null);
      } else {
        setUser(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await apiLogin(email, password);
      return refresh();
    },
    [refresh],
  );

  // Same shape as `login`: the backend has already set the session cookie by
  // the time this resolves, so refresh() reads it the same way either way.
  const loginWithEid = useCallback(
    async (eid: string, password: string) => {
      await apiEidLogin(eid, password);
      return refresh();
    },
    [refresh],
  );

  const signup = useCallback(
    async (fullName: string, email: string, password: string) => {
      await call('gdb_bank.api.signup', { full_name: fullName, email, password });
      await apiLogin(email, password);
      return refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithEid, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
