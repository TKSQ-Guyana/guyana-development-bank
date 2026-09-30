import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { Sidebar } from '../../components/ui/Sidebar';
import type { SidebarItem } from '../../components/ui/Sidebar';
import { HistoryIcon, LogoutIcon, PulseIcon, SlidersIcon, UsersIcon } from '../../components/ui/icons';

const NAV_ITEMS: SidebarItem[] = [
  { to: '/admin/users', label: 'Users', icon: <UsersIcon /> },
  { to: '/admin/health', label: 'System health', icon: <PulseIcon /> },
  { to: '/admin/integrations', label: 'Integrations', icon: <SlidersIcon /> },
  { to: '/admin/history', label: 'Access history', icon: <HistoryIcon /> },
];

/** Chrome for the platform administrator's own section. No link back to the
 *  citizen portal and no "Bank" group: this persona has no case, no queue and
 *  no money page to reach, and the server refuses it at every one of them. */
export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        variant="wide"
        brand={{ title: 'Guyana Development Bank', subtitle: 'Administration' }}
        items={NAV_ITEMS}
        account={
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-text">
              {(user?.full_name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-800">{user?.full_name}</span>
              <span className="block text-[11px] text-slate-400">Platform Admin</span>
            </span>
          </div>
        }
        footer={{ label: 'Log out', icon: <LogoutIcon />, onClick: () => void onLogout() }}
      />
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-5 py-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
