import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, type SidebarGroup, type SidebarItem } from './ui/Sidebar';
import {
  LedgerIcon,
  LogoutIcon,
  PortfolioIcon,
  ReconcileIcon,
  ReviewIcon,
  RulesIcon,
} from './ui/icons';
import { useAuth } from '../auth';

const NAV_ITEMS: SidebarItem[] = [
  { to: '/finance/reconciliation', label: 'Reconciliation', icon: <ReconcileIcon /> },
  { to: '/finance/portfolio', label: 'Portfolio', icon: <PortfolioIcon /> },
  { to: '/finance/ledger', label: 'Ledger', icon: <LedgerIcon /> },
  { to: '/finance/rules', label: 'Lending Rules', icon: <RulesIcon /> },
];

const MODULE_TITLES: [string, string][] = [
  ['/finance/reconciliation', 'Reconciliation'],
  ['/finance/portfolio', 'Portfolio'],
  ['/finance/ledger', 'Ledger'],
  ['/finance/rules', 'Lending rules'],
];

function moduleTitle(pathname: string): string {
  return MODULE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Finance';
}

/** Chrome for the Finance persona's own section.
 *
 *  This was the last section on the 88px icon rail while the citizen portal and
 *  the administration console had both moved to the labelled column, so one
 *  person doing one job — a disbursement officer who releases funds and then
 *  reconciles what arrived — crossed between two different navigation systems
 *  mid-task and lost every label on the way. Same sidebar, same header, same
 *  identity block as the other two shells now; only the destinations differ.
 *
 *  The way back to the portal is a rail item rather than a link floating in the
 *  header, because it is a destination like any other and the header is for
 *  saying where you are.
 */
export function FinanceLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  // A finance officer who also releases funds works out of two sections; the
  // one they are not in stays one click away rather than a browser Back.
  //
  // There is deliberately NO link back to the citizen portal. This is a staff
  // account, and the citizen half of the portal is not its to open — the same
  // human reaches it by signing in with their e-ID, on their own account.
  const groups: SidebarGroup[] = user?.is_disbursement
    ? [
        {
          label: 'Elsewhere',
          items: [{ to: '/disbursements', label: 'Disbursements', icon: <ReviewIcon /> }],
        },
      ]
    : [];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        variant="wide"
        brand={{ title: 'Guyana Development Bank', subtitle: 'Finance' }}
        items={NAV_ITEMS}
        groups={groups}
        account={
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-text">
              {(user?.full_name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-800">
                {user?.full_name}
              </span>
              <span className="block truncate text-[11px] text-slate-400">
                {user?.is_disbursement ? 'Disbursement Officer' : 'Finance Officer'}
              </span>
            </span>
          </div>
        }
        footer={{ label: 'Log out', icon: <LogoutIcon />, onClick: () => void onLogout() }}
      />

      {/* `min-w-0` is load-bearing: a flex child defaults to min-width:auto,
          so without it this column refuses to shrink below its widest
          descendant and the whole Finance section scrolls sideways on a
          phone — the page itself, not the table inside it, which has its own
          scroll container. */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-white/70 px-5 py-3 backdrop-blur lg:px-8">
          <div className="leading-tight">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              Finance
            </p>
            <h1 className="text-lg font-bold text-slate-900">{moduleTitle(pathname)}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
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
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-5 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
