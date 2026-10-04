import type { Whoami } from '../types';

/** Who is staff, and where each staff persona works from.
 *
 *  ONE definition, because "is this person staff?" was being answered in three
 *  places with three slightly different lists, and the answer now decides what
 *  a signed-in account may open — not just which nav items to draw.
 *
 *  A GDB staff account is NOT a citizen account and never becomes one. Staff
 *  sign in by work email against realm `gdb-staff`; citizens sign in by e-ID
 *  against `gdb-citizen`, and the sign-in policy refuses each door the other's
 *  kind of account. One human may hold both — that is exactly what
 *  `security/conflict.py` and `User.gdb_staff_eid` exist for — but they are two
 *  accounts, and the citizen half of the portal belongs to the citizen one.
 *  `docs/architecture/identity-and-auth.md` §7 (R-169/R-211) puts the two
 *  surfaces on separate hosts with separate sessions; this is that separation
 *  as far as a single-host SPA can carry it.
 *
 *  Mirrored server-side, where it actually counts: `_require_underwriter`,
 *  `_require_finance`, `_require_disbursement` and `services/finance._may_repay`
 *  all refuse on their own. Nothing here is a control — it decides what to
 *  render and where to send somebody, so that a staff account is never sitting
 *  on a page built for a borrower.
 */
export function isStaff(user: Whoami | null | undefined): boolean {
  return Boolean(
    user?.is_underwriter ||
      user?.is_finance ||
      user?.is_disbursement ||
      user?.is_platform_admin ||
      user?.is_facilitator ||
      user?.is_field_officer,
  );
}

/** The route a staff account lands on and is sent back to, or `null` for a
 *  citizen. Ordered by how narrow the persona's authority is, so an account
 *  holding several roles lands on the most specific desk it has rather than
 *  the most powerful. */
export function deskFor(user: Whoami | null | undefined): string | null {
  if (user?.is_platform_admin) return '/admin/overview';
  if (user?.is_facilitator) return '/facilitator';
  if (user?.is_field_officer) return '/field';
  if (user?.is_underwriter) return '/review';
  if (user?.is_disbursement) return '/disbursements';
  if (user?.is_finance) return '/finance/reconciliation';
  return null;
}

/** A role as staff read it. The role keeps its system name ("Loan Underwriter")
 *  so no permission moves; only what people see is renamed (GDB, 2026-10-02). */
const ROLE_LABELS: Record<string, string> = { 'Loan Underwriter': 'Loan Officer' };
export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;
