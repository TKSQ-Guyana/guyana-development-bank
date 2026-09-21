import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { CAP } from './shared/rbac';
import { RequireCapability } from './shared/rbac/RequireCapability';
import { ApplicantLayout } from './widgets/layout/ApplicantLayout';
import { Dashboard } from './pages/Dashboard';
import { Apply } from './pages/Apply';
import { AuthCallback } from './pages/AuthCallback';
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
 */
function PortalHome() {
  const { user } = useAuth();
  if (!user) return null;
  // If the persona demands a different home (like a staff member going to /underwriting),
  // they are routed there. Otherwise they land on the new citizen dashboard.
  if (user.portal_home !== '/' && user.portal_home !== '/dashboard') {
    return <Navigate to={user.portal_home} replace />;
  }
  return <Dashboard />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            element={
              <RequireAuth>
                <ApplicantLayout />
              </RequireAuth>
            }
          >
            <Route index element={<PortalHome />} />
            <Route path="/dashboard" element={<PortalHome />} />
            <Route path="/loans" element={<MyLoans />} />
            <Route
              path="/apply"
              element={
                <RequireCapability anyOf={[CAP.APPLICATION_CREATE]}>
                  <Apply />
                </RequireCapability>
              }
            />
            <Route path="/loans/:name" element={<LoanDetail />} />
            <Route
              path="/underwriting"
              element={
                <RequireCapability anyOf={[CAP.APPLICATION_VIEW_QUEUE]}>
                  <Review />
                </RequireCapability>
              }
            />
            <Route path="/review" element={<Navigate to="/underwriting" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
