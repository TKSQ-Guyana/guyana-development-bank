import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, type SidebarGroup, type SidebarItem } from './ui/Sidebar';
import {
  ApplicationsIcon,
  DashboardIcon,
  LedgerIcon,
  LogoutIcon,
  MapPinIcon,
  PaymentsIcon,
  PlusIcon,
  PortfolioIcon,
  ProfileIcon,
  ClusterIcon,
  ReviewIcon,
  StatementsIcon,
  TrainingIcon,
  UsersIcon,
} from './ui/icons';
import { useAuth } from '../auth';
import { isStaff } from '../shared/personas';
import { NotificationBell } from '../features/notifications/NotificationBell';

const NAV_ITEMS: SidebarItem[] = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/apply', label: 'My applications', icon: <ApplicationsIcon /> },
  { to: '/payments', label: 'Payments', icon: <PaymentsIcon /> },
  { to: '/statements', label: 'Statements', icon: <StatementsIcon /> },
  { to: '/training', label: 'Training', icon: <TrainingIcon />, disabled: true },
  { to: '/profile', label: 'My details', icon: <ProfileIcon /> },
];

/** Which module the header names. Longest prefix wins, so /apply/new still
 *  reads as the application module. */
const MODULE_TITLES: [string, string][] = [
  ['/apply/new', 'New application'],
  ['/apply/draft', 'Draft application'],
  ['/apply/quick', 'Quick Loan'],
  ['/apply', 'My applications'],
  ['/payments/history', 'Payment history'],
  ['/payments', 'Payments'],
  ['/statements', 'Statements'],
  ['/training', 'Training'],
  ['/profile', 'My details'],
  ['/cluster', 'My groups'],
  ['/facilitator/groups/new', 'New group'],
  ['/facilitator', 'Groups'],
  ['/field/assist', 'Assisted application'],
  ['/field/requests', 'Assist request'],
  ['/field/tasks', 'Field task'],
  ['/field/cases', 'Case'],
  ['/field/find', 'New assisted application'],
  ['/field', 'Work queue'],
  ['/loans/', 'Application'],
  ['/review', 'Review queue'],
  ['/disbursements', 'Disbursements'],
  ['/', 'Dashboard'],
];

function moduleTitle(pathname: string): string {
  const hit = MODULE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix));
  return hit ? hit[1] : 'Dashboard';
}

/** Chrome for the citizen portal: the same sidebar-and-card system the Finance
 *  section uses, in its labelled variant. Staff destinations hang off the same
 *  rail under their own heading — a person holding a staff role is still a
 *  citizen here, and bouncing them between two navigation systems to reach the
 *  review queue was the old top-nav's worst habit. */
export function ApplicantLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onLogout = async () => {
    await logout();
    navigate(isStaff(user) ? '/staff/login' : '/login');
  };

  // Staff aren't applying for anything themselves, and the routes behind the
  // citizen rail now refuse a staff account outright (App.CitizenOnly) — so
  // drawing them here would be offering doors that answer with a redirect.
  // Their destinations are the "Bank" group below.
  const staff = isStaff(user);
  const items = staff ? [] : NAV_ITEMS;

  const staffItems: SidebarItem[] = [];
  if (user?.is_underwriter) {
    staffItems.push({ to: '/review', label: 'Review queue', icon: <ReviewIcon /> });
  }
  if (user?.is_disbursement) {
    staffItems.push({ to: '/disbursements', label: 'Disbursements', icon: <LedgerIcon /> });
  }
  if (user?.is_finance) {
    staffItems.push({ to: '/finance/reconciliation', label: 'Finance', icon: <PortfolioIcon /> });
  }
  if (user?.is_facilitator) {
    staffItems.push({ to: '/facilitator', label: 'Groups', icon: <ClusterIcon /> });
  }
  if (user?.is_field_officer) {
    // `end`: /field/find is under /field, and only one item should be lit.
    staffItems.push({ to: '/field', label: 'Work queue', icon: <MapPinIcon />, end: true });
    staffItems.push({ to: '/field/find', label: 'New application', icon: <PlusIcon /> });
  }
  if (user?.is_platform_admin) {
    staffItems.push({ to: '/admin/users', label: 'Administration', icon: <UsersIcon /> });
  }
  const groups: SidebarGroup[] = staffItems.length ? [{ label: 'Bank', items: staffItems }] : [];

  return (
    // The citizen portal wears the applicant prototype's palette and type
    // (.theme-citizen); staff keep the bank's own.
    <div className={`flex min-h-screen ${staff ? '' : 'theme-citizen'}`}>
      <Sidebar
        variant="wide"
        brand={{ title: 'Guyana Development Bank', subtitle: staff ? 'Staff portal' : 'Citizen portal' }}
        items={items}
        groups={groups}
        account={
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-text">
              {(user?.full_name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-800">{user?.full_name}</span>
              <span className="block truncate font-mono text-[11px] text-slate-400">
                {user?.eid ?? user?.user}
              </span>
            </span>
          </div>
        }
        footer={{ label: 'Log out', icon: <LogoutIcon />, onClick: () => void onLogout() }}
      />

      <div className={`flex min-w-0 flex-1 flex-col ${staff ? 'bg-slate-50' : 'bg-ql-bg'}`}>
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-white/70 px-5 py-3 backdrop-blur lg:px-8">
          <div className="leading-tight">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              SME loan programme
            </p>
            <h1 className="text-lg font-bold text-slate-900">{moduleTitle(pathname)}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <NotificationBell />
            {user?.eid && (
              /* Gold, and only here: the specification reserves it for a
                 verified agency stamp. A purple dot inside it was the theme
                 migration bleeding into a mark that is not ours to restyle. */
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gdb-gold/25 px-3 py-1 text-xs font-semibold text-amber-900">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                e-ID verified
                <span className="font-mono font-normal text-amber-900/70">{user.eid}</span>
              </span>
            )}
            {user?.is_underwriter && (
              <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-text">
                Underwriter
              </span>
            )}
            {user?.is_finance && (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
                Finance
              </span>
            )}
            {user?.is_disbursement && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Disbursement Officer
              </span>
            )}
            {user?.is_facilitator && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                Facilitator
              </span>
            )}
            {user?.is_field_officer && (
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">
                Field Officer
              </span>
            )}
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-5 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
