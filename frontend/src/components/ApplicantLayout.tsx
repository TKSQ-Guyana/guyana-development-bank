import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { STAFF_LOGIN } from "../shared/staffRoutes";
import {
  MenuButton,
  Sidebar,
  useMobileNav,
  type SidebarGroup,
  type SidebarItem,
} from "./ui/Sidebar";
import {
  ApplicationsIcon,
  CheckIcon,
  DashboardIcon,
  LedgerIcon,
  LogoutIcon,
  MapPinIcon,
  PaymentsIcon,
  PortfolioIcon,
  ProfileIcon,
  ClusterIcon,
  ReviewIcon,
  StatementsIcon,
  TrainingIcon,
  UsersIcon,
} from "./ui/icons";
import { useAuth } from "../auth";
import { isStaff } from "../shared/personas";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { coatOfArms } from "./site/assets";

const NAV_ITEMS: SidebarItem[] = [
  { to: "/", label: "Dashboard", icon: <DashboardIcon />, end: true },
  { to: "/apply", label: "My applications", icon: <ApplicationsIcon /> },
  { to: "/payments", label: "Payments", icon: <PaymentsIcon /> },
  { to: "/statements", label: "Statements", icon: <StatementsIcon /> },
  {
    to: "/training",
    label: "Training",
    icon: <TrainingIcon />,
    disabled: true,
  },
  { to: "/profile", label: "My details", icon: <ProfileIcon /> },
];

/** Which module the header names. Longest prefix wins, so /apply/new still
 *  reads as the application module. */
const MODULE_TITLES: [string, string][] = [
  ["/apply/new", "New application"],
  ["/apply/draft", "Draft application"],
  ["/apply/quick", "Quick Loan"],
  ["/apply", "My applications"],
  ["/payments/history", "Payment history"],
  ["/payments", "Payments"],
  ["/statements", "Statements"],
  ["/training", "Training"],
  ["/profile", "My details"],
  ["/cluster", "My groups"],
  ["/facilitator/groups/new", "New group"],
  ["/facilitator", "Groups"],
  ["/field/assist", "Assisted application"],
  ["/field/requests", "Assist request"],
  ["/field/tasks", "Field task"],
  ["/field/cases", "Case"],
  ["/field/find", "Find applicant"],
  ["/field", "Field desk"],
  ["/loans/", "Application"],
  ["/review", "Review queue"],
  ["/disbursements", "Disbursements"],
  ["/", "Dashboard"],
];

function moduleTitle(pathname: string): string {
  const hit = MODULE_TITLES.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(prefix),
  );
  return hit ? hit[1] : "Dashboard";
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
  const nav = useMobileNav(pathname);

  const onLogout = async () => {
    const staff = Boolean(
      user?.is_underwriter ||
      user?.is_finance ||
      user?.is_disbursement ||
      user?.is_field_officer ||
      user?.is_representative,
    );
    await logout();
    navigate(staff ? STAFF_LOGIN : "/login");
  };

  // Staff aren't applying for anything themselves, and the routes behind the
  // citizen rail now refuse a staff account outright (App.CitizenOnly) — so
  // drawing them here would be offering doors that answer with a redirect.
  // Their destinations are the "Bank" group below.
  const staff = isStaff(user);
  const items = staff ? [] : NAV_ITEMS;

  const staffItems: SidebarItem[] = [];
  if (user?.is_underwriter) {
    staffItems.push({
      to: "/review",
      label: "Review queue",
      icon: <ReviewIcon />,
    });
  }
  if (user?.is_disbursement) {
    staffItems.push({
      to: "/disbursements",
      label: "Disbursements",
      icon: <LedgerIcon />,
    });
  }
  if (user?.is_finance) {
    staffItems.push({
      to: "/finance/reconciliation",
      label: "Finance",
      icon: <PortfolioIcon />,
    });
  }
  if (user?.is_facilitator) {
    staffItems.push({
      to: "/facilitator",
      label: "Groups",
      icon: <ClusterIcon />,
    });
  }
  if (user?.is_representative) {
    staffItems.push({
      to: "/appointments",
      label: "Appointments",
      icon: <UsersIcon />,
    });
  }
  if (user?.is_field_officer) {
    staffItems.push({
      to: "/field",
      label: "Field desk",
      icon: <MapPinIcon />,
    });
  }
  if (user?.is_platform_admin) {
    staffItems.push({
      to: "/admin/overview",
      label: "Administration",
      icon: <UsersIcon />,
    });
  }
  const groups: SidebarGroup[] = staffItems.length
    ? [{ label: "Bank", items: staffItems }]
    : [];

  return (
    // The citizen portal wears the applicant prototype's palette and type
    // (.theme-citizen); staff keep the bank's own.
    <div className={`flex min-h-screen ${staff ? "" : "theme-citizen"}`}>
      <Sidebar
        variant="wide"
        brand={{
          title: "Guyana Development Bank",
          crest: coatOfArms,
          subtitle: staff ? "Staff portal" : "Citizen portal",
        }}
        items={items}
        groups={groups}
        account={
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-amber-400/40 bg-emerald-900 text-sm font-bold text-amber-400">
              {(user?.full_name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-xs font-bold text-slate-900">
                  {user?.full_name}
                </span>
                <span className="h-2 w-2 flex-none rounded-full bg-emerald-600" />
              </span>
              <span className="block truncate font-mono text-[11px] tracking-tight text-slate-500">
                {user?.eid ??
                  (user?.national_id
                    ? `National ID ${user.national_id}`
                    : user?.tin
                      ? `TIN ${user.tin}`
                      : user?.user)}
              </span>
              {user?.eid && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                  <CheckIcon className="h-3 w-3" />
                  e-ID verified
                </span>
              )}
            </span>
          </div>
        }
        footer={{
          label: "Log out",
          icon: <LogoutIcon />,
          onClick: () => void onLogout(),
        }}
        mobileOpen={nav.open}
        onMobileClose={nav.hide}
      />

      <div
        className={`flex min-w-0 flex-1 flex-col ${staff ? "bg-slate-50" : "bg-ql-bg"}`}
      >
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/60 bg-white/55 px-4 py-2 shadow-[0_4px_24px_-12px_rgba(11,38,84,0.18)] backdrop-blur-xl backdrop-saturate-150 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <MenuButton onClick={nav.show} />
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-2">
                <span className="rounded border border-emerald-200 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
                  Ministry of Finance
                </span>
                <span className="text-xs text-slate-400">/</span>
                <span className="text-xs font-medium text-slate-500">
                  {moduleTitle(pathname)}
                </span>
              </div>
              <h1 className="text-base font-black tracking-tight text-slate-900 sm:text-lg">
                {staff ? "GDB Staff Portal" : "Citizen Loan Portal"}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            {!user?.eid && (user?.national_id || user?.tin) && (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-50/70 px-3 py-1 text-xs font-semibold text-emerald-950 backdrop-blur">
                <span className="font-normal text-slate-600">
                  {user.national_id ? "National ID:" : "TIN:"}
                </span>
                <span className="font-mono font-bold text-brand-dark">
                  {user.national_id || user.tin}
                </span>
              </span>
            )}
            {user?.eid && (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-50/70 px-3 py-1 text-xs font-semibold text-emerald-950 backdrop-blur">
                <ShieldCheckIcon />
                <span className="font-normal text-slate-600">Guyana e-ID:</span>
                <span className="font-mono font-bold text-brand-dark">
                  {user.eid}
                </span>
              </span>
            )}
            <NotificationBell />
            {user?.is_underwriter && (
              <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-text">
                Loan Officer
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
            {user?.is_representative && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                GDB Representative
              </span>
            )}
          </div>
        </header>

        {/* The Quick Loan screens use the whole width of the screen — its two
            columns and its forms are laid out for it; every other page keeps
            the readable 1280px column. */}
        <main
          className={`mx-auto w-full min-w-0 flex-1 px-6 py-8 lg:px-8 ${
            pathname.startsWith("/apply/") && pathname !== "/apply/new"
              ? ""
              : "max-w-7xl"
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ShieldCheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-emerald-700"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
      />
    </svg>
  );
}
