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
export interface NavEntry {
  to: string;
  label: string;
  requires: Capability[];
  /** Exact-match the route (for the index route). */
  end?: boolean;
}

export const NAV: NavEntry[] = [
  {
    to: '/',
    label: 'My Applications',
    requires: [CAP.APPLICATION_VIEW_OWN],
    end: true,
  },
  {
    to: '/apply',
    label: 'Apply',
    requires: [CAP.APPLICATION_CREATE],
  },
  {
    to: '/facilitator',
    label: 'Facilitator',
    requires: [CAP.APPLICATION_VIEW_FACILITATED, CAP.APPLICATION_DRAFT_ON_BEHALF],
  },
  {
    to: '/underwriting',
    label: 'Review Queue',
    requires: [CAP.APPLICATION_VIEW_QUEUE],
  },
  {
    to: '/disbursement',
    label: 'Disbursement',
    requires: [CAP.DISBURSEMENT_VIEW_QUEUE, CAP.CONDITION_VERIFY],
  },
  {
    to: '/finance',
    label: 'Finance',
    requires: [CAP.FINANCE_VIEW_LEDGER, CAP.FINANCE_RECONCILE],
  },
  {
    to: '/board',
    label: 'Portfolio',
    requires: [CAP.REPORT_PORTFOLIO_AGGREGATE],
  },
  {
    to: '/rules',
    label: 'Lending Rules',
    requires: [CAP.RULE_PROPOSE, CAP.RULE_APPROVE, CAP.RULE_VIEW_HISTORY],
  },
  {
    to: '/admin',
    label: 'Administration',
    requires: [CAP.ADMIN_MANAGE_USERS, CAP.ADMIN_GRANT_ROLES],
  },
];

export function visibleNav(identity: Identity | null): NavEntry[] {
  return NAV.filter((entry) => canAny(identity, ...entry.requires));
}
