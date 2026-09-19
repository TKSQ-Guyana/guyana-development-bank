import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { BankIcon } from './icons';

export interface SidebarItem {
  to: string;
  label: string;
  icon: ReactNode;
}

interface SidebarProps {
  items: SidebarItem[];
  /** Rendered at the bottom, below a spacer — e.g. logout. An action, not a
   *  route, so it takes a click handler rather than a `to`. */
  footer?: { label: string; icon: ReactNode; onClick: () => void };
}

const iconButtonClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
    isActive
      ? 'bg-gradient-to-br from-brand to-brand-dark text-white shadow-sm shadow-brand/40'
      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
  }`;

export function Sidebar({ items, footer }: SidebarProps) {
  return (
    <aside className="flex h-screen w-[88px] flex-none flex-col items-center gap-6 border-r border-slate-100 bg-white py-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white">
        <BankIcon />
      </div>
      <nav className="flex flex-1 flex-col items-center gap-2">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={iconButtonClass} title={item.label}>
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
