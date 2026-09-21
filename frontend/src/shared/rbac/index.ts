/**
 * Capability-based rendering for the SPA.
 *
 * THE RULE: components ask `can(CAP.CREDIT_APPROVE)`, never
 * `user.roles.includes('GDB Underwriter')`. Adding a persona on the backend
 * then lights up the right screens here with no frontend change at all,
 * because the screens are keyed to capabilities the new persona already holds.
 *
 * THIS IS NOT SECURITY. It decides what to draw. The backend re-checks every
 * capability on the call that uses it (`rbac/guards.py`), so a user who edits
 * their capability array in devtools gets a nicer-looking 403, nothing more.
 */
export { CAP, PERSONAS } from './capabilities.generated';
export type { Capability, PersonaKey } from './capabilities.generated';
export type { Identity, PersonaSummary, RowScope } from './types';

import type { Capability } from './capabilities.generated';
import type { Identity } from './types';

export function can(identity: Identity | null, capability: Capability): boolean {
  return !!identity?.capabilities.includes(capability);
}

export function canAny(identity: Identity | null, ...capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(identity, c));
}

export function canAll(identity: Identity | null, ...capabilities: Capability[]): boolean {
  return capabilities.every((c) => can(identity, c));
}

export function hasPersona(identity: Identity | null, key: string): boolean {
  return !!identity?.personas.some((p) => p.key === key);
}
