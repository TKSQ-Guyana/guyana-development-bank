import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { ApplicantLayout } from './components/ApplicantLayout';
import { FinanceLayout } from './components/FinanceLayout';
import { Applications } from './pages/Applications';
import { Apply } from './pages/Apply';
import { Cluster } from './pages/Cluster';
import { Disbursements } from './pages/Disbursements';
import { Reconciliation } from './pages/Finance/Reconciliation';
import { Portfolio } from './pages/Finance/Portfolio';
import { Ledger } from './pages/Finance/Ledger';
import { RuleProposals } from './pages/Finance/RuleProposals';
import { Dashboard } from './pages/Dashboard';
import { LoanDetail } from './pages/LoanDetail';
import { Login } from './pages/Login';
import { Payments } from './pages/Payments';
import { Profile } from './pages/Profile';
import { Statements } from './pages/Statements';
import { Training } from './pages/Training';
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

/** The books are Finance's, not the underwriter's and not the disbursement
 *  officer's. Mirrored server-side in api._require_finance — this only
 *  decides what to render. */
function RequireFinance({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_finance) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Money movement is the disbursement officer's, not Finance's and not the
 *  underwriter's. Mirrored server-side in api._require_disbursement. */
function RequireDisbursement({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_disbursement) return <Navigate to="/" replace />;
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
                <ApplicantLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            {/* The applications hub and the form behind it. `/apply` is the
                list because that is what the sidebar points at; starting a new
                one is a deliberate step from there. */}
            <Route path="/apply" element={<Applications />} />
            <Route path="/apply/new" element={<Apply />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/statements" element={<Statements />} />
            <Route path="/training" element={<Training />} />
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
              path="/disbursements"
              element={
                <RequireDisbursement>
                  <Disbursements />
                </RequireDisbursement>
              }
            />
          </Route>
          <Route
            element={
              <RequireAuth>
                <RequireFinance>
                  <FinanceLayout />
                </RequireFinance>
              </RequireAuth>
            }
          >
            <Route path="/finance/reconciliation" element={<Reconciliation />} />
            <Route path="/finance/portfolio" element={<Portfolio />} />
            <Route path="/finance/ledger" element={<Ledger />} />
            <Route path="/finance/rules" element={<RuleProposals />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
