/** The national e-ID's shape, in one place.
 *
 * WHY ITS OWN MODULE. The e-ID is not decoration — it IS the Keycloak
 * username, so its spelling is a contract between three places: this control,
 * the Keycloak account, and `gdb_bank/identity.py` (which repeats these same
 * two constants in Python). If any two of them disagreed by a single digit,
 * the mismatch would surface as "Incorrect e-ID or password", because that is
 * what a token endpoint answers for a username it does not know — a wrong
 * answer to a question nobody asked.
 */

/** 3 / 4 / 4 — the e-ID's own grouping, and the width of each box. */
export const EID_PART_LENGTHS = [3, 4, 4] as const;

/** `123-4567-8901`. DASHES INCLUDED: the sign-in form joins its three boxes
 *  with '-' and submits that combined string as the username, so this is the
 *  stored form too. */
export const EID_SHAPE = /^\d{3}-\d{4}-\d{4}$/;

/** Eleven — 3 + 4 + 4. What a paste must hold to fill the whole control. */
export const EID_TOTAL_DIGITS = EID_PART_LENGTHS.reduce((sum, n) => sum + n, 0);

/** An empty control's value: three empty parts, so `split('-')` still gives
 *  three. `''` would render as a control with no boxes at all. */
export const EMPTY_EID = '--';

/** Is this a complete e-ID? The submit button asks before enabling. */
export const isCompleteEid = (value: string): boolean => EID_SHAPE.test(value);
