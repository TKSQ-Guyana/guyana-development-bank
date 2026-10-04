import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { STAFF_LOGIN } from "../../shared/staffRoutes";
import { useAuth } from "../../auth";
import { coatOfArms } from "../../components/site/assets";
import { Sidebar } from "../../components/ui/Sidebar";
import type { SidebarItem } from "../../components/ui/Sidebar";
import {
  DashboardIcon,
  HistoryIcon,
  LogoutIcon,
  PulseIcon,
  SlidersIcon,
  UsersIcon,
} from "../../components/ui/icons";
import { Avatar } from "./ui";

const NAV_ITEMS: SidebarItem[] = [
  { to: "/admin/overview", label: "Overview", icon: <DashboardIcon /> },
  { to: "/admin/users", label: "Users & roles", icon: <UsersIcon /> },
  { to: "/admin/health", label: "System health", icon: <PulseIcon /> },
  { to: "/admin/integrations", label: "Integrations", icon: <SlidersIcon /> },
  { to: "/admin/history", label: "Access history", icon: <HistoryIcon /> },
];

/** Chrome for the platform administrator's own section. No link back to the
 *  citizen portal and no "Bank" group: this persona has no case, no queue and
 *  no money page to reach, and the server refuses it at every one of them. */
export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const here = NAV_ITEMS.find((item) => pathname.startsWith(item.to));

  const onLogout = async () => {
    await logout();
    navigate(STAFF_LOGIN);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        variant="wide"
        brand={{
          title: "Guyana Development Bank",
          subtitle: "Administration",
          crest: coatOfArms,
        }}
        items={NAV_ITEMS}
        account={
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <Avatar name={user?.full_name} size="sm" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-800">
                {user?.full_name}
              </span>
              <span className="block text-[11px] text-slate-400">
                Platform Admin
              </span>
            </span>
          </div>
        }
        footer={{
          label: "Log out",
          icon: <LogoutIcon />,
          onClick: () => void onLogout(),
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-5 lg:px-8">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="rounded-md bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-text">
                Admin console
              </span>
              <span className="text-slate-300">/</span>
              <span className="truncate font-medium text-slate-700">
                {here?.label ?? "Administration"}
              </span>
            </nav>
            <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-xs font-medium text-slate-600 sm:flex">
              <Avatar name={user?.full_name} size="sm" />
              {user?.full_name}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-5 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
