// GENERATED FILE - DO NOT EDIT.
// Source of truth: backend/apps/gdb_bank/gdb_bank/rbac/personas.py
// Regenerate:      cd backend && python scripts/export_rbac.py
//
// The realm roles a GDB persona is granted by. Consumed by
// keycloak-local/setup-gdb.mjs (the dev seeder) and by the deploy-time realm
// gate, exactly as kc-realm-structure.mjs is for MPS.
//
// A persona whose realm role is missing from Keycloak exists in Frappe but can
// never be granted to anyone by login - which is why this is generated rather
// than kept in step by hand.

export const GDB_REALM_ROLES = [
  {
    name: 'Citizen',
    description: 'GDB Citizen - Applicant or borrower. Sees only their own case.',
    persona: 'citizen',
    frappeRole: 'GDB Citizen',
  },
  {
    name: 'GDB_Citizen',
    description: 'GDB Citizen - Applicant or borrower. Sees only their own case.',
    persona: 'citizen',
    frappeRole: 'GDB Citizen',
  },
  {
    name: 'GDB_Regional_Facilitator',
    description: 'GDB Regional Facilitator - Drafts and submits on behalf of a cluster that has explicitly mandated them. Never becomes the owner of the application.',
    persona: 'facilitator',
    frappeRole: 'GDB Regional Facilitator',
  },
  {
    name: 'GDB_Underwriter',
    description: 'GDB Underwriter - Credit decision maker. Cannot release money, verify conditions, change a lending rule, or review their own application.',
    persona: 'underwriter',
    frappeRole: 'GDB Underwriter',
  },
  {
    name: 'GDB_Disbursement_Officer',
    description: 'GDB Disbursement Officer - Verifies conditions, countersigns, releases funds. Cannot decide credit, and cannot release a loan they approved or are party to.',
    persona: 'disbursement_officer',
    frappeRole: 'GDB Disbursement Officer',
  },
  {
    name: 'GDB_Finance_Officer',
    description: 'GDB Finance Officer - Ledger, reconciliation, refunds, portfolio reporting down to the case. Proposes lending rule changes but never approves their own.',
    persona: 'finance',
    frappeRole: 'GDB Finance Officer',
  },
  {
    name: 'GDB_Board_Member',
    description: 'GDB Board / CEO - Aggregate reporting and rule approval. Has NO read permission on any case-level DocType - Phase 5\'s privacy guarantee is the absence of a DocPerm row, not a hidden route.',
    persona: 'board',
    frappeRole: 'GDB Board Member',
  },
  {
    name: 'GDB_CEO',
    description: 'GDB Board / CEO - Aggregate reporting and rule approval. Has NO read permission on any case-level DocType - Phase 5\'s privacy guarantee is the absence of a DocPerm row, not a hidden route.',
    persona: 'board',
    frappeRole: 'GDB Board Member',
  },
  {
    name: 'GDB_Platform_Admin',
    description: 'GDB Platform Admin - User and role administration, the kill switch, system health and integration settings. By policy: no credit decisions, no money.',
    persona: 'platform_admin',
    frappeRole: 'GDB Platform Admin',
  },
];

/** The public OIDC client the GDB portal signs in through. */
export const GDB_PORTAL_CLIENT = {
  clientId: 'gdb-portal',
  publicClient: true,
  standardFlowEnabled: true,
  // PKCE, no client secret in the browser (CLAUDE.md section 4).
  attributes: { 'pkce.code.challenge.method': 'S256' },
  redirectUris: [
    'http://localhost:3000/*',
    'http://localhost:3001/*',
    'http://localhost:5173/*',
  ],
  webOrigins: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ],
};

/** The token claim carrying the three-box e-ID. */
export const GDB_EID_CLAIM = 'eid';
