import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { BankIcon } from './icons';

export interface SidebarItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match this route exactly. Needed for "/", which otherwise matches every
   *  page in the portal and leaves two items lit at once. */
  end?: boolean;
  /** A short note under the label — a count, a state, the one thing this
   *  section is waiting on. */
  hint?: string;
  /** Renders the item muted with a "Soon" tag and no navigation. */
  disabled?: boolean;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

interface SidebarProps {
  items: SidebarItem[];
  /** Rendered at the bottom, below a spacer — e.g. logout. An action, not a
   *  route, so it takes a click handler rather than a `to`. */
  footer?: { label: string; icon: ReactNode; onClick: () => void };
  /** Kept as a prop so call sites read explicitly, but there is one variant.
   *  There used to be a second — an 88px icon-only strip that the Finance
   *  section alone still used — and having two meant one person doing one job
   *  crossed between two navigation systems mid-task and lost every label on
   *  the way. A seam is worth having when something varies across it; this one
   *  did not. */
  variant?: 'wide';
  /** The wordmark above the navigation. */
  brand?: { title: string; subtitle?: string };
  /** Role-gated sections — staff destinations appear under their own heading
   *  rather than mixed into the citizen's six. */
  groups?: SidebarGroup[];
  /** Sits above the footer — the signed-in identity. */
  account?: ReactNode;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
    isActive
      ? 'bg-gradient-to-r from-brand to-brand-dark text-white shadow-sm shadow-brand/30'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
  }`;

function Item({ item }: { item: SidebarItem }) {
  if (item.disabled) {
    return (
      <div className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300">
        <span className="flex h-5 w-5 flex-none items-center justify-center">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Soon
        </span>
      </div>
    );
  }
  return (
    <NavLink to={item.to} end={item.end} className={linkClass}>
      {({ isActive }) => (
        <>
          <span className="flex h-5 w-5 flex-none items-center justify-center">{item.icon}</span>
          <span className="flex-1 leading-tight">
            {item.label}
            {item.hint && (
              <span
                className={`block text-[11px] font-normal ${
                  isActive ? 'text-white/70' : 'text-slate-400'
                }`}
              >
                {item.hint}
              </span>
            )}
          </span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ items, footer, brand, groups, account }: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] flex-none flex-col border-r border-slate-200/70 bg-white/80 backdrop-blur md:flex">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-dark text-white">
          <BankIcon />
        </span>
        {brand && (
          <span className="min-w-0 leading-tight">
            {/* Wraps rather than truncates: "Guyana Developmen…" is not the
                Bank's name, and a wordmark is the one label in here that must
                never be abbreviated. */}
            <span className="block text-sm font-bold text-slate-900">{brand.title}</span>
            {brand.subtitle && (
              <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {brand.subtitle}
              </span>
            )}
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        <div className="space-y-0.5">
          {items.map((item) => (
            <Item key={item.to} item={item} />
          ))}
        </div>
        {groups?.map((group) => (
          <div key={group.label} className="mt-4">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Item key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200/70 p-2.5">
        {account}
        {footer && (
          <button
            onClick={footer.onClick}
            className="mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <span className="flex h-5 w-5 flex-none items-center justify-center">{footer.icon}</span>
            {footer.label}
          </button>
        )}
      </div>
    </aside>
  );
}
