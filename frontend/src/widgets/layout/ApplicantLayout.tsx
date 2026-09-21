import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth';
import { groupedNav } from '../navigation/nav-registry';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-gdb-green-dark text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

export function ApplicantLayout() {
  const { user, logout } = useAuth();
  const onLogout = () => void logout();

  // Spec §5.3: "Staff destinations come from visibleNav() like everything else,
  // grouped under a 'Bank' heading." Which block an entry belongs to is
  // declared on the entry itself, so this component decides nothing — the
  // previous version tested `to` against a hardcoded list of citizen paths,
  // and anything missing from that list silently appeared under "Bank".
  const { citizen: citizenNav, bank: bankNav } = groupedNav(user);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar Rail */}
      <aside className="w-64 border-r border-slate-200 bg-white shadow-sm flex flex-col">
        <div className="p-4 border-b border-slate-200 bg-gdb-green">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gdb-gold text-lg font-black text-gdb-green-dark">
              G
            </span>
            <span className="text-sm font-semibold text-white">Guyana Development Bank</span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {citizenNav.length > 0 && (
            <div>
              <ul className="space-y-1">
                {citizenNav.map(entry => (
                  <li key={entry.to}>
                    <NavLink to={entry.to} end={entry.end} className={navLinkClass}>
                      {entry.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bankNav.length > 0 && (
            <div>
              <h3 className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Bank</h3>
              <ul className="space-y-1">
                {bankNav.map(entry => (
                  <li key={entry.to}>
                    <NavLink to={entry.to} end={entry.end} className={navLinkClass}>
                      {entry.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="text-sm font-medium text-slate-900 truncate">{user?.full_name}</div>
          <div className="text-xs text-gdb-gold font-semibold mb-3">e-ID verified</div>
          <button onClick={onLogout} className="text-sm text-gdb-green font-medium hover:underline">
            Log out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        <div className="p-8 max-w-5xl mx-auto w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
