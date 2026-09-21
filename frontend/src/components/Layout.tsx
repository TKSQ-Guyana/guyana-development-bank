import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { visibleNav } from '../widgets/navigation/nav-registry';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-gdb-green-dark text-white' : 'text-green-100 hover:bg-gdb-green-dark/70 hover:text-white'
  }`;

export function Layout() {
  const { user, logout } = useAuth();

  // No `navigate('/login')` after this: `logout` ends the Keycloak session too,
  // which means leaving the SPA entirely. Keycloak returns the browser to
  // /login itself (post_logout_redirect_uri), and a client-side navigate here
  // would only race the redirect.
  const onLogout = () => void logout();

  return (
    <div className="min-h-screen">
      <header className="bg-gdb-green shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gdb-gold text-lg font-black text-gdb-green-dark">
              G
            </span>
            <span className="text-lg font-semibold text-white">
              Guyana Development Bank
              <span className="ml-2 hidden text-sm font-normal text-green-200 sm:inline">
                Citizen Portal
              </span>
            </span>
          </Link>
          {/* Nav is data, filtered by capability — see
              widgets/navigation/nav-registry.ts. No role checks live here. */}
          <nav className="flex items-center gap-1">
            {visibleNav(user).map((entry) => (
              <NavLink key={entry.to} to={entry.to} end={entry.end} className={navLinkClass}>
                {entry.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-4 py-2 text-sm text-slate-600">
          <span>
            {user?.full_name}
            {user?.personas.map((persona) => (
              <span
                key={persona.key}
                className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-gdb-green-dark"
              >
                {persona.title}
              </span>
            ))}
          </span>
          <button onClick={onLogout} className="font-medium text-gdb-green hover:underline">
            Log out
          </button>
        </div>
      </div>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
