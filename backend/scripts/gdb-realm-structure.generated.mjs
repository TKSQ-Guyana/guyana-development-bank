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
  attributes: {
    'pkce.code.challenge.method': 'S256',
    // RP-initiated logout returns here. Without it Keycloak
    // refuses the post_logout_redirect_uri and the citizen is
    // left on a Keycloak page after signing out of the portal.
    'post.logout.redirect.uris': [
      'http://localhost:3000/*',
      'http://localhost:3001/*',
      'http://localhost:5173/*',
    ].join('##'),
  },
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

/** Put `gdb-portal` in its own access tokens' `aud` claim.
 *
 * WITHOUT THIS, EVERY SIGN-IN FAILS. Keycloak does not add a public client's
 * own id to `aud`: that claim is filled by the Audience Resolve mapper from
 * the *client roles* a user holds, and `gdb-portal` defines none. Its access
 * tokens therefore carry `aud: ["account"]` and name the client only in `azp`,
 * while `security/keycloak.verify_token` decodes with `audience='gdb-portal'`
 * and rejects the lot - as "Your sign-in could not be verified", with the
 * library's real message deliberately swallowed.
 *
 * The backend also asserts `azp`, so removing this mapper degrades to a
 * refusal rather than to accepting another client's token. */
export const GDB_AUDIENCE_MAPPER = {
  name: 'gdb-portal-audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  config: {
    'included.client.audience': 'gdb-portal',
    'access.token.claim': 'true',
    'id.token.claim': 'false',
  },
};

/** The token claim carrying the three-box e-ID. */
export const GDB_EID_CLAIM = 'eid';

/** The realm's login theme - `keycloak-local/themes/gdb`.
 *
 * Under PKCE the credential page belongs to Keycloak, so this theme is where
 * the three-box e-ID control and the GDB branding live. Stock Keycloak asks
 * for a "Username", which is not a thing a citizen has. */
export const GDB_LOGIN_THEME = 'gdb';

/** One development account per persona. NOT FOR ANY DEPLOYED REALM.
 *
 * `username` is the e-ID, not the email: under Authorization Code + PKCE the
 * citizen types their credentials into Keycloak's own page, so the Keycloak
 * username IS the thing they are asked for. Derived from `rbac/demo.py`, which
 * `install.make_demo_users()` also builds the Frappe side from - the two must
 * name the same person by the same e-ID or Keycloak answers `invalid_grant`
 * for an account that exists. */
export const GDB_DEMO_IDENTITIES = [
  {
    persona: 'citizen',
    username: '999-1001-0001',
    eid: '999-1001-0001',
    email: 'citizen@gdb.gov.gy',
    fullName: 'Demo Citizen',
    realmRoles: ['Citizen', 'GDB_Citizen'],
  },
  {
    persona: 'facilitator',
    username: '999-1002-0002',
    eid: '999-1002-0002',
    email: 'facilitator@gdb.gov.gy',
    fullName: 'Demo Regional Facilitator',
    realmRoles: ['GDB_Regional_Facilitator'],
  },
  {
    persona: 'underwriter',
    username: '999-1003-0003',
    eid: '999-1003-0003',
    email: 'underwriter@gdb.gov.gy',
    fullName: 'Demo Underwriter',
    realmRoles: ['GDB_Underwriter'],
  },
  {
    persona: 'disbursement_officer',
    username: '999-1004-0004',
    eid: '999-1004-0004',
    email: 'disbursement.officer@gdb.gov.gy',
    fullName: 'Demo Disbursement Officer',
    realmRoles: ['GDB_Disbursement_Officer'],
  },
  {
    persona: 'finance',
    username: '999-1005-0005',
    eid: '999-1005-0005',
    email: 'finance@gdb.gov.gy',
    fullName: 'Demo Finance Officer',
    realmRoles: ['GDB_Finance_Officer'],
  },
  {
    persona: 'board',
    username: '999-1006-0006',
    eid: '999-1006-0006',
    email: 'board@gdb.gov.gy',
    fullName: 'Demo Board / CEO',
    realmRoles: ['GDB_Board_Member', 'GDB_CEO'],
  },
  {
    persona: 'platform_admin',
    username: '999-1007-0007',
    eid: '999-1007-0007',
    email: 'platform.admin@gdb.gov.gy',
    fullName: 'Demo Platform Admin',
    realmRoles: ['GDB_Platform_Admin'],
  },
];
