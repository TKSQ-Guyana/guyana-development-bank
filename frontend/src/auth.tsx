import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
  SESSION_CHECK,
  WHOAMI,
  call,
  eidLogin as apiEidLogin,
  logout as apiLogout,
  staffLogin as apiStaffLogin,
  staffSetPassword as apiStaffSetPassword,
} from './api';
import type { Whoami } from './types';

/** Who is signed in and what they may open — the part of `whoami` that
 *  decides what a page draws. Two answers with the same key are the same
 *  session as far as the screen is concerned. */
const identity = (u: Whoami | null) =>
  u ? [u.user, u.is_underwriter, u.is_finance, u.is_disbursement, u.is_platform_admin, u.is_facilitator, u.is_field_officer, u.is_representative].join('|') : '';

/** A staff sign-in either opens a session, or — for the one-time password an
 *  administrator issued — asks for the person's own password first. */
export type StaffSignIn =
  | { passwordChangeRequired: true }
  | { passwordChangeRequired: false; whoami: Whoami | null };

interface AuthState {
  user: Whoami | null;
  loading: boolean;
  // Both sign-ins resolve to who just signed in, so the caller can route by
  // role (an underwriter has nowhere useful to land but the review queue)
  // without waiting a render cycle for context state to catch up.
  /** Citizens: national e-ID (`123-4567-8901`) via the Keycloak citizen realm. */
  loginWithEid: (eid: string, password: string) => Promise<Whoami | null>;
  /** GDB staff: work email via the Keycloak staff realm. */
  loginAsStaff: (email: string, password: string) => Promise<StaffSignIn>;
  /** GDB staff, first sign-in: replace the one-time password, then sign in. */
  setStaffPassword: (email: string, oneTimePassword: string, newPassword: string) => Promise<Whoami | null>;
  /** Re-read who is signed in — after a door that sets the session itself
   *  (TIN sign-up and TIN sign-in, which finish with a one-time code). */
  refresh: () => Promise<Whoami | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Whoami | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const whoami = await call<Whoami>(WHOAMI);
      setUser(whoami);
      return whoami;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The session cookie belongs to the browser, not to this tab. Signing in as
  // somebody else in another tab — or the session simply ending — changes who
  // the SERVER thinks this is while the page goes on drawing the old person's
  // screens, and every click then answers "you may only view your own…".
  // So the session is re-read whenever the tab comes back into view and
  // whenever the server refuses a call, and the page re-renders only if the
  // answer actually changed.
  const current = useRef<Whoami | null>(null);
  current.current = user;
  useEffect(() => {
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        let now: Whoami | null;
        try {
          now = await call<Whoami>(WHOAMI);
        } catch (err) {
          // Only a refusal means "signed out". A dropped connection says
          // nothing about the session and must not sign anybody out.
          if (!(err instanceof ApiError && (err.status === 401 || err.status === 403))) return;
          now = null;
        }
        if (identity(now) !== identity(current.current)) setUser(now);
      } finally {
        checking = false;
      }
    };
    const onCheck = () => void check();
    window.addEventListener(SESSION_CHECK, onCheck);
    window.addEventListener('focus', onCheck);
    document.addEventListener('visibilitychange', onCheck);
    return () => {
      window.removeEventListener(SESSION_CHECK, onCheck);
      window.removeEventListener('focus', onCheck);
      document.removeEventListener('visibilitychange', onCheck);
    };
  }, []);

  // The backend has already set the session cookie by the time either sign-in
  // resolves, so refresh() reads it the same way whichever door was used.
  const loginWithEid = useCallback(
    async (eid: string, password: string) => {
      await apiEidLogin(eid, password);
      return refresh();
    },
    [refresh],
  );

  const loginAsStaff = useCallback(
    async (email: string, password: string): Promise<StaffSignIn> => {
      const result = await apiStaffLogin(email, password);
      if (result?.password_change_required) return { passwordChangeRequired: true };
      return { passwordChangeRequired: false, whoami: await refresh() };
    },
    [refresh],
  );

  const setStaffPassword = useCallback(
    async (email: string, oneTimePassword: string, newPassword: string) => {
      await apiStaffSetPassword(email, oneTimePassword, newPassword);
      return refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      // Every half-finished application this browser was holding, whoever it
      // belonged to. The wizard keeps a recovery copy on the device for the
      // window before GDB has the draft, and that copy is somebody's address,
      // phone and income — it must not outlive their session. A shared or
      // family device is the ordinary case in this programme, not the edge
      // one, and nothing else ever cleared these keys.
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('gdb.apply.'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* private window, blocked storage — never a reason to fail a logout */
      }
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loginWithEid, loginAsStaff, setStaffPassword, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
