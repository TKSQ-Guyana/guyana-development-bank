import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { gdbLogo } from "../site/assets";

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
  variant?: "wide";
  /** The wordmark above the navigation. `eyebrow` is the small gold line
   *  above the title. */
  brand?: {
    title: string;
    subtitle?: string;
    eyebrow?: string;
    crest?: string;
  };
  /** Role-gated sections — staff destinations appear under their own heading
   *  rather than mixed into the citizen's six. */
  groups?: SidebarGroup[];
  /** Sits above the footer — the signed-in identity. */
  account?: ReactNode;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all ${
    isActive
      ? "border-l-4 border-amber-400 bg-brand-dark font-bold text-white shadow-sm shadow-emerald-950/20"
      : "font-medium text-slate-700 hover:bg-slate-100 hover:text-brand-dark"
  }`;

function Item({ item }: { item: SidebarItem }) {
  if (item.disabled) {
    return (
      <div className="flex cursor-default items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-300">
        <span className="flex h-5 w-5 flex-none items-center justify-center">
          {item.icon}
        </span>
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
          <span
            className={`flex h-5 w-5 flex-none items-center justify-center ${
              isActive
                ? "text-amber-300"
                : "text-slate-400 group-hover:text-brand-dark"
            }`}
          >
            {item.icon}
          </span>
          <span className="flex-1 leading-tight">
            {item.label}
            {item.hint && (
              <span
                className={`block text-[11px] font-normal ${
                  isActive ? "text-white/70" : "text-slate-400"
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

export function Sidebar({
  items,
  footer,
  brand,
  groups,
  account,
}: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[256px] flex-none flex-col border-r border-slate-200 bg-white shadow-[1px_0_12px_rgba(0,0,0,0.02)] md:flex">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-5">
        <span className="flex items-center gap-3">
          {/* The national coat of arms first, then the Bank's mark: a
              government programme, and it should look like one. */}
          {brand?.crest && (
            <>
              <img
                src={brand.crest}
                alt="Coat of arms of Guyana"
                className="h-11 w-auto flex-none object-contain"
              />
              <span className="h-8 w-px flex-none bg-slate-200" aria-hidden />
            </>
          )}
          {/* The Bank's logo carries its name; the title stays for screen readers. */}
          <img
            src={gdbLogo}
            alt={brand?.title ?? "Guyana Development Bank"}
            className="h-10 w-auto min-w-0 max-w-[150px] object-contain"
          />
        </span>
        {brand && (brand.eyebrow || brand.subtitle) && (
          <span className="min-w-0 leading-tight">
            {brand.eyebrow && (
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gdb-goldleaf">
                {brand.eyebrow}
              </span>
            )}
            {brand.subtitle && (
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-tight text-slate-500">
                {brand.subtitle}
              </span>
            )}
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          {items.map((item) => (
            <Item key={item.to} item={item} />
          ))}
        </div>
        {groups?.map((group) => (
          <div key={group.label} className="mt-4">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.label}
            </p>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <Item key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 bg-slate-50 p-4">
        {account}
        {footer && (
          <button
            onClick={footer.onClick}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          >
            <span className="flex h-5 w-5 flex-none items-center justify-center">
              {footer.icon}
            </span>
            {footer.label}
          </button>
        )}
      </div>
    </aside>
  );
}
