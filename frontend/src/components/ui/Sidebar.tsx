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
  /** A short note under the label in the wide variant — a count, a state, the
   *  one thing this section is waiting on. */
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
  /** `rail` is the 88px icon strip the Finance section uses. `wide` is the
   *  labelled 260px column: the citizen portal has six destinations with
   *  nothing in common visually, and an icon alone does not tell somebody
   *  applying for their first loan where "Statements" is. */
  variant?: 'rail' | 'wide';
  /** Wide only. The wordmark above the navigation. */
  brand?: { title: string; subtitle?: string };
  /** Wide only. Role-gated sections — staff destinations appear under their
   *  own heading rather than mixed into the citizen's six. */
  groups?: SidebarGroup[];
  /** Wide only. Sits above the footer — the signed-in identity. */
  account?: ReactNode;
}

const iconButtonClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
    isActive
      ? 'bg-gradient-to-br from-brand to-brand-dark text-white shadow-sm shadow-brand/40'
      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
  }`;

const wideLinkClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
    isActive
      ? 'bg-gradient-to-r from-brand to-brand-dark text-white shadow-sm shadow-brand/30'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
  }`;

function WideItem({ item }: { item: SidebarItem }) {
  if (item.disabled) {
    return (
      <div className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300">
        <span className="flex h-5 w-5 flex-none items-center justify-center">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Soon
        </span>
      </div>
    );
  }
  return (
    <NavLink to={item.to} end={item.end} className={wideLinkClass}>
      {({ isActive }) => (
        <>
          <span className="flex h-5 w-5 flex-none items-center justify-center">{item.icon}</span>
          <span className="flex-1 leading-tight">
            {item.label}
            {item.hint && (
              <span
                className={`block text-[11px] font-normal ${isActive ? 'text-white/70' : 'text-slate-400'}`}
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

export function Sidebar({ items, footer, variant = 'rail', brand, groups, account }: SidebarProps) {
  if (variant === 'wide') {
    return (
      <aside className="sticky top-0 hidden h-screen w-[260px] flex-none flex-col border-r border-slate-200/70 bg-white/80 backdrop-blur md:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white">
            <BankIcon />
          </span>
          {brand && (
            <span className="leading-tight">
              <span className="block text-sm font-bold text-slate-900">{brand.title}</span>
              {brand.subtitle && (
                <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {brand.subtitle}
                </span>
              )}
            </span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="space-y-1">
            {items.map((item) => (
              <WideItem key={item.to} item={item} />
            ))}
          </div>
          {groups?.map((group) => (
            <div key={group.label} className="mt-6">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <WideItem key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200/70 p-3">
          {account}
          {footer && (
            <button
              onClick={footer.onClick}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <span className="flex h-5 w-5 flex-none items-center justify-center">{footer.icon}</span>
              {footer.label}
            </button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-screen w-[88px] flex-none flex-col items-center gap-6 border-r border-slate-100 bg-white py-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white">
        <BankIcon />
      </div>
      <nav className="flex flex-1 flex-col items-center gap-2">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={iconButtonClass} title={item.label}>
            {item.icon}
          </NavLink>
        ))}
      </nav>
      {footer && (
        <button
          onClick={footer.onClick}
          title={footer.label}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          {footer.icon}
        </button>
      )}
    </aside>
  );
}
