/** The national e-ID's shape, in one place on this side of the wire.
 *
 * WHY A FRONTEND COPY EXISTS AT ALL. The SPA does not collect the e-ID —
 * under Authorization Code + PKCE the citizen types it on Keycloak's page, not
 * ours. But the portal still *displays* it (the header stamp, the account
 * block, the application summary), and a value shown in the wrong grouping is
 * a value a citizen will not recognise as their own.
 *
 * THE SHAPE IS STATED IN THREE PLACES and they must agree:
 *   backend/apps/gdb_bank/gdb_bank/domain/eid_format.py     the authority
 *   keycloak-local/themes/gdb/login/resources/js/eid-boxes.js
 *   here
 * Only the first is enforced. A disagreement here shows up as a misgrouped
 * number on screen, not as a failed sign-in — which is why this module formats
 * and never validates for access.
 */

/** 3 / 4 / 4 — the e-ID's own grouping, matching the card. */
export const EID_PART_LENGTHS = [3, 4, 4] as const;

export const EID_TOTAL_DIGITS = EID_PART_LENGTHS.reduce((sum, n) => sum + n, 0);

/** `592-1111-0001`. Dashes included: this is the stored form. */
export const EID_SHAPE = /^\d{3}-\d{4}-\d{4}$/;

export const isCompleteEid = (value: string | null | undefined): boolean =>
  EID_SHAPE.test(value ?? '');

/**
 * The canonical spelling of whatever we were handed.
 *
 * Lenient in, strict out, mirroring `eid_format.normalize`. Anything that is
 * not eleven digits comes back unchanged rather than half-grouped: a value we
 * cannot read is better shown as it arrived than rewritten into something that
 * looks authoritative and is not.
 */
export function formatEid(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== EID_TOTAL_DIGITS) return value;

  const parts: string[] = [];
  let at = 0;
  for (const length of EID_PART_LENGTHS) {
    parts.push(digits.slice(at, at + length));
    at += length;
  }
  return parts.join('-');
}
