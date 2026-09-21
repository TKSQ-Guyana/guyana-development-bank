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

  /** @deprecated carried while the pre-registry screens are migrated. */
  roles: string[];
  /** @deprecated use `can(CAP.CREDIT_APPROVE)`. */
  is_underwriter: boolean;
}
