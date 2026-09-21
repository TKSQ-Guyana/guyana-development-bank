import { CAP } from '../../shared/rbac';
import type { Capability, Identity } from '../../shared/rbac';
import { canAny } from '../../shared/rbac';

/**
 * The navigation, declared as data and filtered by capability.
 *
 * Mirrors `rbac/personas.py` on the backend: one entry per destination, gated
 * by the capabilities that make the destination meaningful. Adding a persona
 * server-side lights up the entries it can reach without touching this file;
 * adding a *screen* is one entry here.
 *
 * `requires` is OR-ed: a link shows if the user holds ANY of the listed
 * capabilities. Use the narrowest capability that the screen actually needs,
 * not the persona's broadest one - that is what keeps this honest when a
 * capability moves between personas.
 */
/**
 * Which block of the sidebar an entry belongs in.
 *
 * It lives HERE rather than in the layout. `ApplicantLayout` used to decide by
 * testing `to` against a hardcoded array of citizen paths, which meant a new
 * citizen screen was two edits instead of the one this file promises - and the
 * edit you forgot failed silently, filing the screen under "Bank". `/apply`
 * was sitting under "Bank" for exactly that reason.
 */
export type NavGroup = 'citizen' | 'bank';

export interface NavEntry {
  to: string;
  label: string;
  requires: Capability[];
  /** Required, not optional: a new entry must state where it belongs, and
   *  TypeScript should be the thing that insists. */
  group: NavGroup;
  /** Exact-match the route (for the index route). */
  end?: boolean;
  icon?: string;
}

export const NAV: NavEntry[] = [
  // --- Citizen Destinations ---
  {
    to: '/dashboard',
    group: 'citizen',
    label: 'Dashboard',
    icon: 'home',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  {
    to: '/loans',
    group: 'citizen',
    label: 'My applications',
    icon: 'folder',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  {
    to: '/payments',
    group: 'citizen',
    label: 'Payments',
    icon: 'credit-card',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  {
    to: '/statements',
    group: 'citizen',
    label: 'Statements',
    icon: 'file-text',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  {
    to: '/training',
    group: 'citizen',
    label: 'Training (soon)',
    icon: 'book',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  {
    to: '/details',
    group: 'citizen',
    label: 'My details',
    icon: 'user',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  {
    to: '/cluster',
    group: 'citizen',
    label: 'My cluster',
    icon: 'users',
    requires: [CAP.APPLICATION_VIEW_OWN],
  },
  
  // REMOVED: `{ to: '/', label: 'My Applications (Legacy)' }`.
  //
  // `/` and `/dashboard` both render `PortalHome` (App.tsx), so this was a
  // second link to the screen `Dashboard` already covers - and the label was
  // wrong twice over, because once `/loans` became "My applications" this
  // entry stopped pointing at any application list at all. The index route
  // still exists; it just does not need its own sidebar link.

  // `Apply` is a CITIZEN action - it is what `application.create` buys. It
  // showed under "Bank" only because the layout's old path list did not
  // mention it.
  {
    to: '/apply',
    label: 'Apply',
    group: 'citizen',
    requires: [CAP.APPLICATION_CREATE],
  },

  // --- Staff / Internal Destinations ---
  {
    to: '/facilitator',
    group: 'bank',
    label: 'Facilitator',
    requires: [CAP.APPLICATION_VIEW_FACILITATED, CAP.APPLICATION_DRAFT_ON_BEHALF],
  },
  {
    to: '/underwriting',
    group: 'bank',
    label: 'Review Queue',
    requires: [CAP.APPLICATION_VIEW_QUEUE],
  },
  {
    to: '/disbursement',
    group: 'bank',
    label: 'Disbursement',
    requires: [CAP.DISBURSEMENT_VIEW_QUEUE, CAP.CONDITION_VERIFY],
  },
  {
    to: '/finance',
    group: 'bank',
    label: 'Finance',
    requires: [CAP.FINANCE_VIEW_LEDGER, CAP.FINANCE_RECONCILE],
  },
  {
    to: '/board',
    group: 'bank',
    label: 'Portfolio',
    requires: [CAP.REPORT_PORTFOLIO_AGGREGATE],
  },
  {
    to: '/rules',
    group: 'bank',
    label: 'Lending Rules',
    requires: [CAP.RULE_PROPOSE, CAP.RULE_APPROVE, CAP.RULE_VIEW_HISTORY],
  },
  {
    to: '/admin',
    group: 'bank',
    label: 'Administration',
    requires: [CAP.ADMIN_MANAGE_USERS, CAP.ADMIN_GRANT_ROLES],
  },
];

export function visibleNav(identity: Identity | null): NavEntry[] {
  return NAV.filter((entry) => canAny(identity, ...entry.requires));
}

/**
 * `visibleNav`, split into the sidebar's blocks.
 *
 * The layout renders what it is handed and decides nothing. Order within each
 * block is the order declared in NAV.
 */
export function groupedNav(identity: Identity | null): Record<NavGroup, NavEntry[]> {
  const visible = visibleNav(identity);
  return {
    citizen: visible.filter((entry) => entry.group === 'citizen'),
    bank: visible.filter((entry) => entry.group === 'bank'),
  };
}
