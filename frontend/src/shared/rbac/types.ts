import type { Capability, PersonaKey } from './capabilities.generated';

export type RowScope = 'none' | 'own_eid' | 'facilitated' | 'all';

export interface PersonaSummary {
  key: PersonaKey;
  title: string;
  portal_home: string;
  row_scope: RowScope;
}

/**
 * The payload of `gdb_bank.api.v1_identity.whoami`.
 *
 * `capabilities` is what the UI branches on. It never branches on a role name:
 * that is precisely the coupling that makes adding a persona a frontend change
 * as well as a backend one.
 */
export interface Identity {
  user: string;
  full_name: string;
  eid: string | null;
  personas: PersonaSummary[];
  capabilities: Capability[];
  row_scope: RowScope;
  portal_home: string;
}

/*
 * REMOVED 2026-09-21: `roles: string[]` and `is_underwriter: boolean`.
 *
 * Both were carried as `@deprecated` while the pre-registry screens migrated.
 * They are gone from `_identity_payload` too — leaving them on the wire would
 * have kept the door open: the next person in a hurry writes
 * `user.is_underwriter` because the field is right there, and the coupling the
 * persona registry exists to delete grows back.
 *
 * `roles` had no reader in this codebase at all. `is_underwriter` had two, in
 * LoanDetail.tsx, now `can(user, CAP.CREDIT_APPROVE)` and
 * `can(user, CAP.APPLICATION_VIEW_QUEUE)`.
 */
