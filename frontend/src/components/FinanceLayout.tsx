import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './ui/Sidebar';
import { LedgerIcon, PortfolioIcon, ReconcileIcon, RulesIcon, LogoutIcon } from './ui/icons';
import { useAuth } from '../auth';

const NAV_ITEMS = [
  { to: '/finance/reconciliation', label: 'Reconciliation', icon: <ReconcileIcon /> },
  { to: '/finance/portfolio', label: 'Portfolio', icon: <PortfolioIcon /> },
  { to: '/finance/ledger', label: 'Ledger', icon: <LedgerIcon /> },
  { to: '/finance/rules', label: 'Lending Rules', icon: <RulesIcon /> },
];

/** Chrome for the Finance persona's own section: the sidebar-and-card layout
 *  from the design reference, kept apart from the rest of the portal's
 *  top-nav Layout so the theme migration can move one section at a time. */
export function FinanceLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar items={NAV_ITEMS} footer={{ label: 'Log out', icon: <LogoutIcon />, onClick: () => void onLogout() }} />
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-100 bg-white/60 px-8 py-4">
          <Link to="/" className="text-sm font-medium text-brand hover:underline">
            &larr; Citizen Portal
          </Link>
          <div className="text-sm text-slate-500">
            {user?.full_name}
            <span className="ml-2 rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-text">
              Finance
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-8 py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
