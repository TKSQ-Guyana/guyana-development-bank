/** The staff side of the portal: where a GDB officer works, and where they
 *  sign in. A signed-out visit to any of these goes to the staff sign-in, not
 *  the citizen one; a staff member signing out lands back on it. */
export const STAFF_LOGIN = "/staff/login";

const STAFF_PREFIXES = [
  "/review",
  "/disbursements",
  "/facilitator",
  "/field",
  "/finance",
  "/admin",
  "/staff",
];

export const isStaffPath = (pathname: string): boolean =>
  STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Where to sign in to reach `pathname`. */
export const loginFor = (pathname: string): string =>
  isStaffPath(pathname) ? STAFF_LOGIN : "/login";
