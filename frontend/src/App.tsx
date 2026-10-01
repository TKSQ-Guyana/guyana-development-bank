import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Fragment, Suspense, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { deskFor, isStaff } from './shared/personas';
import { ApplicantLayout } from './components/ApplicantLayout';
import { FinanceLayout } from './components/FinanceLayout';
import { AdminLayout } from './features/platform-admin/AdminLayout';

const LOADING = <p className="p-8 text-center text-slate-500">Loading…</p>;

/** A page in its own chunk, fetched the first time its route is opened — a
 *  citizen never downloads the finance ledger, and nobody downloads the
 *  2,400-line application wizard to read a dashboard. The Suspense boundary is
 *  the page's own, so the layout around it stays put while the chunk arrives. */
function page(load: () => Promise<{ default: ComponentType }>) {
  const Lazy = lazy(load);
  return function Page() {
    return (
      <Suspense fallback={LOADING}>
        <Lazy />
      </Suspense>
    );
  };
}

const Landing = page(() => import('./pages/Landing').then((m) => ({ default: m.Landing })));
const Login = page(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Dashboard = page(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Applications = page(() => import('./pages/Applications').then((m) => ({ default: m.Applications })));
const Apply = page(() => import('./pages/Apply').then((m) => ({ default: m.Apply })));
const ChooseLoan = page(() => import('./pages/ChooseLoan').then((m) => ({ default: m.ChooseLoan })));
const QuickApplyPage = page(() =>
  import('./features/quick-loan/QuickApplyPage').then((m) => ({ default: m.QuickApplyPage })),
);
const LoanDetail = page(() => import('./pages/LoanDetail').then((m) => ({ default: m.LoanDetail })));
const MyFinancialsPage = page(() =>
  import('./features/personal-financials/MyFinancialsPage').then((m) => ({ default: m.MyFinancialsPage })),
);
const Payments = page(() => import('./pages/Payments').then((m) => ({ default: m.Payments })));
const PaymentHistoryPage = page(() =>
  import('./features/payment-history/PaymentHistoryPage').then((m) => ({ default: m.PaymentHistoryPage })),
);
const Statements = page(() => import('./pages/Statements').then((m) => ({ default: m.Statements })));
const Training = page(() => import('./pages/Training').then((m) => ({ default: m.Training })));
const Cluster = page(() => import('./pages/Cluster').then((m) => ({ default: m.Cluster })));
const Profile = page(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Review = page(() => import('./pages/Review').then((m) => ({ default: m.Review })));
const GroupsPage = page(() => import('./features/facilitator/GroupsPage').then((m) => ({ default: m.GroupsPage })));
const GroupWizard = page(() => import('./features/facilitator/GroupWizard').then((m) => ({ default: m.GroupWizard })));
const FieldDesk = page(() => import('./features/field-officer/FieldDesk').then((m) => ({ default: m.FieldDesk })));
const AssistRequestPage = page(() =>
  import('./features/field-officer/AssistRequestPage').then((m) => ({ default: m.AssistRequestPage })),
);
const FindApplicant = page(() =>
  import('./features/field-officer/FindApplicant').then((m) => ({ default: m.FindApplicant })),
);
const AssistConsentPage = page(() =>
  import('./features/field-officer/AssistConsentPage').then((m) => ({ default: m.AssistConsentPage })),
);
const AssistedApply = page(() =>
  import('./features/field-officer/AssistedApply').then((m) => ({ default: m.AssistedApply })),
);
const FieldTaskPage = page(() =>
  import('./features/field-officer/FieldTaskPage').then((m) => ({ default: m.FieldTaskPage })),
);
const FieldCaseView = page(() =>
  import('./features/field-officer/FieldCaseView').then((m) => ({ default: m.FieldCaseView })),
);
const Disbursements = page(() => import('./pages/Disbursements').then((m) => ({ default: m.Disbursements })));
const Reconciliation = page(() =>
  import('./pages/Finance/Reconciliation').then((m) => ({ default: m.Reconciliation })),
);
const Portfolio = page(() => import('./pages/Finance/Portfolio').then((m) => ({ default: m.Portfolio })));
const Ledger = page(() => import('./pages/Finance/Ledger').then((m) => ({ default: m.Ledger })));
const RuleProposals = page(() =>
  import('./pages/Finance/RuleProposals').then((m) => ({ default: m.RuleProposals })),
);
const UsersPage = page(() => import('./features/platform-admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const HealthPage = page(() => import('./features/platform-admin/HealthPage').then((m) => ({ default: m.HealthPage })));
const IntegrationsPage = page(() =>
  import('./features/platform-admin/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
const AccessHistoryPage = page(() =>
  import('./features/platform-admin/AccessHistoryPage').then((m) => ({ default: m.AccessHistoryPage })),
);

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return LOADING;
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  // Keyed on who is signed in: if the session changes under an open tab, every
  // page below remounts and re-reads its data as the person it now is.
  return <Fragment key={user.user}>{children}</Fragment>;
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
  if (loading) return LOADING;
  if (!user) {
    if (location.pathname === '/') return <Landing />;
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  // Keyed on who is signed in, for the same reason as RequireAuth.
  return <ApplicantLayout key={user.user} />;
}

function RequireUnderwriter({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_underwriter) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Staff have no loans of their own, so the citizen dashboard has nothing for
 *  them — land each on the desk they actually work from. Finance and the
 *  disbursement officer used to fall through to the borrower's dashboard here,
 *  which is the citizen portal, not theirs. */
function Index() {
  const { user } = useAuth();
  const desk = deskFor(user);
  if (desk) return <Navigate to={desk} replace />;
  return <Dashboard />;
}

/** The citizen half of the portal: applying, paying, statements, the cluster,
 *  your own details.
 *
 *  A GDB staff account is refused all of it and sent back to its own desk. Not
 *  because the data would leak — every one of these screens reads the signed-in
 *  account's own records, and an underwriter's staff account has none — but
 *  because a staff login sitting on "Apply for a loan" invites exactly the act
 *  the separation of duties exists to prevent, and the human's citizen account
 *  is where those pages actually belong.
 *
 *  `/loans/:name` is deliberately NOT in here: it is the shared case URL, and
 *  the staff workspace is the whole point of it. */
function CitizenOnly() {
  const { user } = useAuth();
  const desk = deskFor(user);
  if (isStaff(user) && desk) return <Navigate to={desk} replace />;
  return <Outlet />;
}

/** Accounts, roles, health and integration settings are the platform
 *  administrator's. Mirrored server-side in _require_platform_admin — this
 *  only decides what to render. */
function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_platform_admin) return <Navigate to="/" replace />;
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

/** Groups — forming them and filing their applications — are the
 *  facilitator's. Mirrored server-side in api._require_facilitator and
 *  cluster._require_facilitator_of. */
function RequireFacilitator({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_facilitator) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** The Field Officer's desk: assist requests, assisted applications and
 *  field tasks. Mirrored server-side in _require_field_officer, and per record
 *  (region, assignment, the applicant's consent) in services/field_operations. */
function RequireFieldOfficer({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_field_officer) return <Navigate to="/" replace />;
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
          <Route element={<ApplicantShell />}>
            <Route index element={<Index />} />
            {/* The applications hub and the form behind it. `/apply` is the
                list because that is what the sidebar points at; starting a new
                one is a deliberate step from there.

                `new` and `:name` are two different acts and now have two
                different URLs. `new` always opens an empty form; `:name`
                resumes THAT draft, read back from GDB. They used to be one
                route that silently rehydrated whatever the browser happened to
                be holding, which meant "start an application" continued an
                abandoned one and the server draft it belonged to was
                orphaned. */}
            <Route element={<CitizenOnly />}>
              <Route path="/apply" element={<Applications />} />
              {/* Not keyed: the first save moves this same form to
                  /apply/draft/:pid and must not remount it. /apply/new is only
                  reached from outside the form (the list, the dashboard), so
                  it always mounts empty. */}
              {/* Every application starts by choosing the loan; the SME
                  form itself lives one step on. */}
              <Route path="/apply/new" element={<ChooseLoan />} />
              <Route path="/apply/new/sme" element={<Apply />} />
              {/* The Quick Loan is a different product on its own form. A
                  static segment outranks `:name`, so /apply/quick is never
                  read as a draft called "quick". */}
              <Route path="/apply/quick" element={<QuickApplyPage />} />
              <Route path="/apply/quick/:name" element={<QuickApplyPage />} />
              <Route path="/apply/draft/:pid" element={<Apply />} />
              <Route path="/apply/:name" element={<Apply />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/payments/history" element={<PaymentHistoryPage />} />
              <Route path="/statements" element={<Statements />} />
              <Route path="/training" element={<Training />} />
              <Route path="/cluster" element={<Cluster />} />
              <Route path="/profile" element={<Profile />} />
              {/* Declaring your own financials is the member's own act — staff
                  read the same figures from the case workspace instead. */}
              <Route path="/loans/:name/my-financials" element={<MyFinancialsPage />} />
            </Route>
            {/* The shared case URL. Staff get the workspace, the applicant gets
                their own case — LoanDetail decides which. */}
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
            <Route
              path="/facilitator"
              element={
                <RequireFacilitator>
                  <GroupsPage />
                </RequireFacilitator>
              }
            />
            <Route
              path="/facilitator/groups/new"
              element={
                <RequireFacilitator>
                  <GroupWizard />
                </RequireFacilitator>
              }
            />
            <Route
              path="/facilitator/groups/:cluster"
              element={
                <RequireFacilitator>
                  <GroupWizard />
                </RequireFacilitator>
              }
            />
            {/* The Field Officer's screens. The assisted application is the
                applicant's own form (pages/Apply) under the applicant's
                consent, so it lives here rather than behind CitizenOnly. */}
            <Route
              path="/field"
              element={
                <RequireFieldOfficer>
                  <FieldDesk />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/find"
              element={
                <RequireFieldOfficer>
                  <FindApplicant />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/requests/:name"
              element={
                <RequireFieldOfficer>
                  <AssistRequestPage />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/assist/:consent"
              element={
                <RequireFieldOfficer>
                  <AssistConsentPage />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/assist/:consent/apply/new"
              element={
                <RequireFieldOfficer>
                  <AssistedApply />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/assist/:consent/apply/draft/:pid"
              element={
                <RequireFieldOfficer>
                  <AssistedApply />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/assist/:consent/apply/:name"
              element={
                <RequireFieldOfficer>
                  <AssistedApply />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/tasks/:name"
              element={
                <RequireFieldOfficer>
                  <FieldTaskPage />
                </RequireFieldOfficer>
              }
            />
            <Route
              path="/field/cases/:name"
              element={
                <RequireFieldOfficer>
                  <FieldCaseView />
                </RequireFieldOfficer>
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
          <Route
            element={
              <RequireAuth>
                <RequirePlatformAdmin>
                  <AdminLayout />
                </RequirePlatformAdmin>
              </RequireAuth>
            }
          >
            <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/health" element={<HealthPage />} />
            <Route path="/admin/integrations" element={<IntegrationsPage />} />
            <Route path="/admin/history" element={<AccessHistoryPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
