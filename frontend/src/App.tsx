import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { CAP } from './shared/rbac';
import { RequireCapability } from './shared/rbac/RequireCapability';
import { Layout } from './components/Layout';
import { Apply } from './pages/Apply';
import { LoanDetail } from './pages/LoanDetail';
import { Login } from './pages/Login';
import { MyLoans } from './pages/MyLoans';
import { Review } from './pages/Review';
import { Signup } from './pages/Signup';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

/**
 * Landing route.
 *
 * Where "home" is depends on the persona, and the backend decides: a Board
 * member has no permission to load the citizen application list at all, so
 * sending everyone to `/` would hand them a guaranteed 403. `portal_home`
 * comes from the persona registry via `whoami`.
 */
function PortalHome() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.portal_home !== '/') return <Navigate to={user.portal_home} replace />;
  return <MyLoans />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<PortalHome />} />
            <Route
              path="/apply"
              element={
                <RequireCapability anyOf={[CAP.APPLICATION_CREATE]}>
                  <Apply />
                </RequireCapability>
              }
            />
            <Route path="/loans/:name" element={<LoanDetail />} />
            {/* Queue route: any persona granted APPLICATION_VIEW_QUEUE reaches
                it, so a future Senior Underwriter or Credit Committee persona
                needs no change here. */}
            <Route
              path="/underwriting"
              element={
                <RequireCapability anyOf={[CAP.APPLICATION_VIEW_QUEUE]}>
                  <Review />
                </RequireCapability>
              }
            />
            {/* Pre-registry path, kept so existing links and bookmarks work. */}
            <Route path="/review" element={<Navigate to="/underwriting" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
