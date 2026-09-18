import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Apply } from './pages/Apply';
import { Cluster } from './pages/Cluster';
import { Disbursements } from './pages/Disbursements';
import { Finance } from './pages/Finance';
import { LoanDetail } from './pages/LoanDetail';
import { Login } from './pages/Login';
import { MyLoans } from './pages/MyLoans';
import { Profile } from './pages/Profile';
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

function RequireUnderwriter({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_underwriter) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Money movement is the finance officer's, not the underwriter's. Mirrored
 *  server-side in api._require_finance — this only decides what to render. */
function RequireFinance({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_finance) return <Navigate to="/" replace />;
  return <>{children}</>;
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
            <Route index element={<MyLoans />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/cluster" element={<Cluster />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/loans/:name" element={<LoanDetail />} />
            <Route
              path="/review"
              element={
                <RequireUnderwriter>
                  <Review />
                </RequireUnderwriter>
              }
            />
            <Route
              path="/finance"
              element={
                <RequireFinance>
                  <Finance />
                </RequireFinance>
              }
            />
            <Route
              path="/disbursements"
              element={
                <RequireFinance>
                  <Disbursements />
                </RequireFinance>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
