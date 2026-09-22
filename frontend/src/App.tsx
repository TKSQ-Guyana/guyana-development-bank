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
import { Landing } from './pages/Landing';
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

/**
 * The applicant shell — and the one place that decides what "/" is.
 *
 * "/" means two different pages to two different people: the public landing
 * page to somebody who has not signed in, and their own dashboard to somebody
 * who has. Deciding it HERE, in the layout wrapper, rather than moving the
 * dashboard to "/dashboard", is what keeps every existing `to="/"` in the
 * sidebar, the breadcrumbs and the post-action redirects pointing at the
 * right thing for the person who clicks it.
 *
 * Rendering <Landing /> in the layout's place (with no <Outlet />) is what
 * stops the child index route underneath it from rendering at all — so a
 * signed-out visitor at "/" gets the front door, and anyone reaching deeper
 * without a session still gets sent to sign in and brought back.
 */
function ApplicantShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }
  if (!user) {
    if (location.pathname === '/') return <Landing />;
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <ApplicantLayout />;
}

function RequireUnderwriter({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_underwriter) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** An underwriter has no loans of their own, so the citizen dashboard has
 *  nothing for them — land them on the queue they actually work from. */
function Index() {
  const { user } = useAuth();
  if (user?.is_underwriter) return <Navigate to="/review" replace />;
  return <Dashboard />;
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
          <Route element={<ApplicantShell />}>
            <Route index element={<Index />} />
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
