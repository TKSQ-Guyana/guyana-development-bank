// Provision what the MPS portal needs into the local Keycloak.
//
// The realm this container imports is a real export of Guyana-Gov, so most of it is
// already correct: both MPS clients exist, are public, have Direct Access Grants on and
// list http://localhost:5173 in Web Origins, and each carries its own protocol mappers
// for `mps_roles`, `agency_id`, `agency_name` and the `mule-api` audience. Do NOT add an
// `mps-claims` client scope on top of those — the claims would be emitted twice and
// `mps_roles` comes back with every role duplicated.
//
// Three things the export does not give you:
//
//   1. AGENCIES. `/MPS-Agencies` exists but has no children, so no agency user can be
//      given an agency.
//   2. USERS. One account ships (`ps-health`) and nobody has its password.
//   3. GROUP ATTRIBUTE INHERITANCE. The clients' `agency_id`/`agency_name` mappers are
//      set to `aggregate.attrs: false`, meaning they read the attribute from the USER
//      record only — but MPS provisions agency users by GROUP MEMBERSHIP ALONE
//      (see toUserRepresentation in frontend/src/features/users/account.js, which sends
//      `groups` and no attributes). With the mapper as exported, such a user's token has
//      no agency_id, and keycloakAdapter.js then gives them an EMPTY agency scope.
//      Turning aggregation on makes group membership actually reach the token.
//
//      WORTH RAISING against the shared realm — the same mismatch is presumably there.
//
// IDEMPOTENT. Re-run as often as you like. Run it again after `docker compose down`,
// which discards the H2 database and re-imports the JSON fresh.
//
//   node setup-mps.mjs
//
// Override if your Keycloak is elsewhere:
//   KC=http://localhost:8080  REALM=Guyana-Gov  KC_ADMIN=admin  KC_ADMIN_PASSWORD=admin

// THE STRUCTURE (realm roles, the 38 agencies) IS SHARED with the backend's
// boot-time realm ensure (backend/scripts/kc-ensure-realm.mjs) — one module,
// so a deployed realm and this dev seeder can never disagree about what must
// exist. The kc-bootstrap compose sidecar mounts the module beside /seed so
// this relative import resolves inside the container too.
import { REQUIRED_REALM_ROLES, AGENCIES } from '../backend/scripts/kc-realm-structure.mjs';

const KC = (process.env.KC || 'http://localhost:8080').replace(/\/+$/, '');
const REALM = process.env.REALM || 'Guyana-Gov';
const ADMIN = process.env.KC_ADMIN || 'admin';
const ADMIN_PW = process.env.KC_ADMIN_PASSWORD || 'admin';

// Shared by every seeded account. Local dev only — this realm is not reachable off this
// machine. Must satisfy the realm's policy: length(10), specialChars(1), notUsername.
//
// DELIBERATELY THE SAME STRING as DEFAULT_PASSWORD in
// frontend/src/features/users/account.js — the password the portal itself assigns to every
// account provisioned through the Users screen. One password for every local account,
// however it was created, instead of two that look alike and are not.
const PASSWORD = process.env.MPS_TEST_PASSWORD || 'ChangeMe@123';

const CLIENTS = ['mps-agency-portal', 'mps-staff-console'];
const AGENCY_PARENT = 'MPS-Agencies';

// THE FULL ESTABLISHMENT REGISTER now lives in the shared structure module
// (imported above): the backend's boot-time realm ensure creates these same
// groups on deployed realms, and two lists would eventually be two registers.
// Everything the old comment said still holds — ids and names EXACTLY as
// mps.agencies spells them, all 38 seeded, and the matching below accepts a
// child named by id OR by name so the export's shipped groups are recognised
// as present rather than duplicated.

// One account per portal persona, so every screen can be reached. Usernames are emails
// because that is what the sign-in form is used with; Keycloak treats them as opaque.
const USERS = [
  { username: 'ps@mps.gov.gy', first: 'Permanent', last: 'Secretary', roles: ['MPS_PS'] },
  { username: 'cpo@mps.gov.gy', first: 'Chief Personnel', last: 'Officer', roles: ['MPS_CPO'] },
  { username: 'sec@mps.gov.gy', first: 'Confidential', last: 'Secretary', roles: ['MPS_Conf_Secretary'] },
  { username: 'off@mps.gov.gy', first: 'Personnel', last: 'Officer', roles: ['MPS_HR_Officer'] },
  { username: 'min@mps.gov.gy', first: 'The', last: 'Minister', roles: ['MPS_Minister'] },
  // The Data Entry Clerk persona (signed-memo scan & upload). BACKEND-ONLY
  // for now: backend/src/auth/claims.ts maps MPS_Data_Clerk to the CLERK persona and the
  // SQL layer grants it permissions, but the frontend's ROLE_MAP (auth/claims.js) has no
  // entry for it — so this account works against /api/v1 and lands on the "no access"
  // page in the portal until the frontend gains the persona.
  { username: 'clerk@mps.gov.gy', first: 'Data Entry', last: 'Clerk', roles: ['MPS_Data_Clerk'] },
  {
    username: 'adm@mps.gov.gy',
    first: 'IT',
    last: 'Administrator',
    roles: ['MPS_IT_Admin'],
    // What the Users screen needs on VITE_USERS_TRANSPORT=keycloak: the /kcadmin proxy
    // forwards this person's own token and Keycloak authorises against these roles.
    clientRoles: { 'realm-management': ['manage-users', 'view-users', 'view-realm'] },
  },
  {
    username: 'agency@moh.gov.gy',
    first: 'Health',
    last: 'Originator',
    roles: ['MPS_Agency_Originator'],
    group: 'AG-MOH',
    // Belt and braces: the group carries these too, but the exported mappers read
    // the USER attribute unless aggregation is on (step 1). Setting both means the
    // token carries the agency either way.
    attributes: { agency_id: ['AG-MOH'], agency_name: ['Ministry of Health'] },
  },
  {
    // 0063 — the Agency Minister (pre-MPS review). Agency-scoped like the
    // originator above: the group is the fence, the attributes are the belt.
    username: 'minister@moh.gov.gy',
    first: 'Health',
    last: 'Minister',
    roles: ['MPS_Agency_Minister'],
    group: 'AG-MOH',
    attributes: { agency_id: ['AG-MOH'], agency_name: ['Ministry of Health'] },
  },
];

// The same personas again, under e-ID usernames.
//
// THE SIGN-IN FORM CANNOT TYPE THE ACCOUNTS ABOVE. It takes an e-ID as three boxes of
// 3, 4 and 4 DIGITS (frontend/src/pages/SignIn/EidInput.jsx) and submits them joined by
// hyphens, so `ps@mps.gov.gy` is literally unreachable from the portal's own front door
// — only from Postman, the admin console, or a build predating the e-ID field. Every
// persona therefore needs a second account whose username is a valid e-ID, or that
// persona cannot be demonstrated at all.
//
// BOTH SETS ARE KEPT. The @-style names are what CLAUDE.md, the Postman collection and
// the handover notes all quote, and they still work everywhere a username is typed
// freely; deleting them would silently break those. Two accounts per persona is the
// cheaper of the two problems.
//
// The digits are a mnemonic, not data: the repeated digit IS the persona, so 555… is the
// Minister and nothing has to be looked up. 333-4444-4444 breaks the pattern because it
// is the one that already existed — created by hand while the e-ID field was being built
// — and it is reproduced here EXACTLY as Keycloak already holds it (EID Tester,
// MPS_Agency_Originator, /MPS-Agencies/AG-MOH), so re-running this script confirms that
// account rather than mutating it.
//
// EVERY ONE OF THEM NEEDS AN `email`, and the failure if you omit it is thoroughly
// misleading. The realm's declarative user profile marks email required for the `user`
// role (GET /admin/realms/Guyana-Gov/users/profile), and Keycloak validates the profile
// during authentication — so an account with no email is created happily, shows no
// required actions in the admin console, and then answers the password grant with
// `invalid_grant: "Account is not fully set up"`, which reads like a credentials or
// required-action problem and is neither. The @-style seeds above never hit this because
// their username IS an email and gets copied into the field.
const EID_USERS = [
  {
    username: '111-1111-1111',
    email: 'eid.ps@mps.gov.gy',
    first: 'Permanent',
    last: 'Secretary',
    roles: ['MPS_PS'],
  },
  {
    username: '222-2222-2222',
    email: 'eid.cpo@mps.gov.gy',
    first: 'Chief Personnel',
    last: 'Officer',
    roles: ['MPS_CPO'],
  },
  {
    username: '333-3333-3333',
    email: 'eid.sec@mps.gov.gy',
    first: 'Confidential',
    last: 'Secretary',
    roles: ['MPS_Conf_Secretary'],
  },
  {
    username: '444-4444-4444',
    email: 'eid.off@mps.gov.gy',
    first: 'Personnel',
    last: 'Officer',
    roles: ['MPS_HR_Officer'],
  },
  {
    username: '555-5555-5555',
    email: 'eid.min@mps.gov.gy',
    first: 'The',
    last: 'Minister',
    roles: ['MPS_Minister'],
  },
  {
    // Backend-only persona for now — see the note on clerk@mps.gov.gy above.
    username: '666-6666-6666',
    email: 'eid.clerk@mps.gov.gy',
    first: 'Data Entry',
    last: 'Clerk',
    roles: ['MPS_Data_Clerk'],
  },
  {
    username: '777-7777-7777',
    email: 'eid.adm@mps.gov.gy',
    first: 'IT',
    last: 'Administrator',
    roles: ['MPS_IT_Admin'],
    // Same reason as adm@mps.gov.gy: without these the Users screen's /kcadmin calls are
    // refused by Keycloak itself, not by the portal.
    clientRoles: { 'realm-management': ['manage-users', 'view-users', 'view-realm'] },
  },
  // The three agency originators sit in DIFFERENT agencies on purpose: one per ministry
  // is what makes the per-agency grants visible. Three accounts all in AG-MOH would look
  // identical from inside the portal.
  {
    username: '333-4444-4444',
    // The address the hand-made account already carries — matched, not chosen.
    email: 'eid.tester@moh.gov.gy',
    first: 'EID',
    last: 'Tester',
    roles: ['MPS_Agency_Originator'],
    group: 'AG-MOH',
    attributes: { agency_id: ['AG-MOH'], agency_name: ['Ministry of Health'] },
  },
  {
    username: '888-8888-8888',
    email: 'eid.agency@moe.gov.gy',
    first: 'Education',
    last: 'Originator',
    roles: ['MPS_Agency_Originator'],
    group: 'AG-MOE',
    attributes: { agency_id: ['AG-MOE'], agency_name: ['Ministry of Education'] },
  },
  {
    username: '999-9999-9999',
    email: 'eid.agency@moa.gov.gy',
    first: 'Agriculture',
    last: 'Originator',
    roles: ['MPS_Agency_Originator'],
    // AG-MOAG, as the establishment register spells it (mps.agencies) — the earlier
    // AG-MOA existed only in this script, so this originator filed under a phantom
    // agency no grant or IAP row could ever match.
    group: 'AG-MOAG',
    attributes: { agency_id: ['AG-MOAG'], agency_name: ['Ministry of Agriculture'] },
  },
  // 0063 — Agency Ministers, one per ministry that has a seeded originator pair
  // to review. The mnemonic bends the same way the originators' did: the PREFIX
  // is the ministry's originator block (333-…=MOH, 888-…=MOE) and the repeated
  // 5555 is the minister persona digit, same as the MPS Minister's 555….
  {
    username: '333-5555-5555',
    email: 'eid.minister@moh.gov.gy',
    first: 'Health',
    last: 'Minister',
    roles: ['MPS_Agency_Minister'],
    group: 'AG-MOH',
    attributes: { agency_id: ['AG-MOH'], agency_name: ['Ministry of Health'] },
  },
  {
    username: '888-5555-5555',
    email: 'eid.minister@moe.gov.gy',
    first: 'Education',
    last: 'Minister',
    roles: ['MPS_Agency_Minister'],
    group: 'AG-MOE',
    attributes: { agency_id: ['AG-MOE'], agency_name: ['Ministry of Education'] },
  },
];

let token;
const log = (m) => console.log(m);

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  if (raw || res.status === 204 || res.status === 409) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function authenticate() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN,
      password: ADMIN_PW,
    }),
  });
  if (!res.ok) throw new Error(`Admin sign-in failed (${res.status}). Is Keycloak up at ${KC}?`);
  token = (await res.json()).access_token;
}

// --- 0. local origins on the MPS clients -------------------------------------
// The export lists the dev server (5173) and the deployed edges. The
// containerized frontend (docker-compose.dev.yml) serves from 3005; without it
// in Web Origins, Keycloak refuses the token CORS preflight and sign-in fails
// with "Could not reach the sign-in service".

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:3005'];

async function ensureLocalOrigins() {
  for (const clientId of CLIENTS) {
    const [client] = await api(`/clients?clientId=${encodeURIComponent(clientId)}`);
    if (!client) continue;
    const webOrigins = new Set(client.webOrigins || []);
    const redirectUris = new Set(client.redirectUris || []);
    const before = webOrigins.size + redirectUris.size;
    for (const origin of LOCAL_ORIGINS) {
      webOrigins.add(origin);
      redirectUris.add(`${origin}/*`);
    }
    if (webOrigins.size + redirectUris.size === before) {
      log(`  ${clientId}: local origins already listed`);
      continue;
    }
    client.webOrigins = [...webOrigins];
    client.redirectUris = [...redirectUris];
    await api(`/clients/${client.id}`, { method: 'PUT', raw: true, body: client });
    log(`  ${clientId}: + ${LOCAL_ORIGINS.join(', ')}`);
  }
}

// --- 1. make group membership reach the token ------------------------------

async function enableAttributeAggregation() {
  for (const clientId of CLIENTS) {
    const [client] = await api(`/clients?clientId=${encodeURIComponent(clientId)}`);
    if (!client) {
      log(`  !! client ${clientId} not found — skipping`);
      continue;
    }
    const mappers = await api(`/clients/${client.id}/protocol-mappers/models`);
    for (const name of ['agency_id', 'agency_name']) {
      const mapper = mappers.find((m) => m.name === name);
      if (!mapper) {
        log(`  ${clientId}: no ${name} mapper — skipping`);
        continue;
      }
      if (mapper.config['aggregate.attrs'] === 'true') {
        log(`  ${clientId}: ${name} already aggregates group attributes`);
        continue;
      }
      mapper.config['aggregate.attrs'] = 'true';
      await api(`/clients/${client.id}/protocol-mappers/models/${mapper.id}`, {
        method: 'PUT',
        raw: true,
        body: mapper,
      });
      log(`  ${clientId}: ${name} -> aggregate.attrs=true`);
    }
  }
}

// --- 1b. realm roles the export predates -------------------------------------
// The imported realm ships every role EXCEPT the ones added after its export
// date. The list is the SHARED structure module's — the backend's boot-time
// ensure creates the same roles on deployed realms. POST /roles answers 409
// when present, which api() treats as success.

async function ensureRealmRoles() {
  const existing = new Set((await api('/roles')).map((r) => r.name));
  for (const role of REQUIRED_REALM_ROLES) {
    if (existing.has(role.name)) {
      log(`  ${role.name} — present`);
      continue;
    }
    await api('/roles', { method: 'POST', body: role });
    log(`  ${role.name} — created`);
  }
}

// --- 1c. the service account's own grants -------------------------------------
// The backend's boot-time realm ensure (and the notification mailer's realm
// reads) run as mps-provisioning-service, and each needs realm-management
// roles on that service account: view-realm/view-users to read, manage-realm
// to create realm roles, manage-users to create groups. Deployed realms get
// these granted BY HAND once (documented in docs/DEPLOYMENT-ENV.md); the local
// realm gets them here so a wiped volume comes back self-sufficient.

const SERVICE_ACCOUNT_CLIENT = 'mps-provisioning-service';
const SERVICE_ACCOUNT_ROLES = ['view-realm', 'view-users', 'manage-realm', 'manage-users'];

async function ensureServiceAccountGrants() {
  const [client] = await api(`/clients?clientId=${encodeURIComponent(SERVICE_ACCOUNT_CLIENT)}`);
  if (!client) {
    log(`  !! client ${SERVICE_ACCOUNT_CLIENT} not found — skipping`);
    return;
  }
  const [rm] = await api('/clients?clientId=realm-management');
  const user = await api(`/clients/${client.id}/service-account-user`);
  // `available` lists only what the account does NOT already hold, so this is
  // idempotent the same way the user-role grants below are.
  const available = await api(`/users/${user.id}/role-mappings/clients/${rm.id}/available`);
  const want = available.filter((r) => SERVICE_ACCOUNT_ROLES.includes(r.name));
  if (!want.length) {
    log(`  ${SERVICE_ACCOUNT_CLIENT}: grants already present`);
    return;
  }
  await api(`/users/${user.id}/role-mappings/clients/${rm.id}`, {
    method: 'POST',
    raw: true,
    body: want,
  });
  log(`  ${SERVICE_ACCOUNT_CLIENT}: + ${want.map((r) => r.name).join(', ')}`);
}

// --- 2. agencies under /MPS-Agencies ---------------------------------------

async function ensureAgencies() {
  const groups = await api(`/groups?search=${encodeURIComponent(AGENCY_PARENT)}`);
  let parent = groups.find((g) => g.name === AGENCY_PARENT);
  if (!parent) {
    await api('/groups', { method: 'POST', body: { name: AGENCY_PARENT } });
    parent = (await api(`/groups?search=${encodeURIComponent(AGENCY_PARENT)}`)).find(
      (g) => g.name === AGENCY_PARENT,
    );
    log(`  created /${AGENCY_PARENT}`);
  }

  // Keycloak 23+ serves children from their own endpoint rather than inline.
  const children = (await api(`/groups/${parent.id}/children`)) || parent.subGroups || [];
  // The current export names children by agency ID (AG-MOH); earlier ones used
  // the agency name. Recognise either so neither layout gets a duplicate.
  const present = (agency) => children.find((c) => c.name === agency.id || c.name === agency.name);

  for (const agency of AGENCIES) {
    if (present(agency)) {
      log(`  /${AGENCY_PARENT}/${present(agency).name} — present`);
      continue;
    }
    await api(`/groups/${parent.id}/children`, {
      method: 'POST',
      body: {
        name: agency.id,
        attributes: { agency_id: [agency.id], agency_name: [agency.name] },
      },
    });
    log(`  /${AGENCY_PARENT}/${agency.id} — created (${agency.name})`);
  }

  const refreshed = (await api(`/groups/${parent.id}/children`)) || [];
  const map = new Map();
  for (const child of refreshed) {
    map.set(child.name, child)
    const agency = AGENCIES.find((a) => a.id === child.name || a.name === child.name);
    if (agency) {
      map.set(agency.id, child);
      map.set(agency.name, child);
    }
  }
  return map;
}

// --- 2b. agency groups convey the AGENCY, never a persona --------------------
// The realm export ships some /MPS-Agencies children (AG-MOH at least) with a
// realm-role mapping of MPS_Agency_Originator on the GROUP — so every member
// inherited the originator persona. That was invisible while originators were
// the only members; it breaks the moment an Agency Minister joins the group
// (0063): their token would carry BOTH roles and pass every ORIG gate
// (create, clarify, submit). The persona is the USER's own realm role — the
// portal's provisioning has always assigned it directly — so the group
// mapping is stripped wherever it appears.

async function stripPersonaRolesFromAgencyGroups(agencyGroups) {
  const seen = new Set();
  for (const group of agencyGroups.values()) {
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    const mapped = await api(`/groups/${group.id}/role-mappings/realm`);
    const personaRoles = (mapped || []).filter((r) => r.name.startsWith('MPS_'));
    if (!personaRoles.length) continue;
    await api(`/groups/${group.id}/role-mappings/realm`, {
      method: 'DELETE',
      raw: true,
      body: personaRoles,
    });
    log(`  ${group.name}: - group-mapped roles ${personaRoles.map((r) => r.name).join(', ')}`);
  }
}

// --- 3. users --------------------------------------------------------------

async function ensureUsers(specs, agencyGroups) {
  const roleByName = new Map((await api('/roles')).map((r) => [r.name, r]));

  for (const spec of specs) {
    let [user] = await api(`/users?username=${encodeURIComponent(spec.username)}&exact=true`);

    // An explicit `email`, or the username when the username itself is one. Never the
    // raw username otherwise — the realm rejects a non-email in the email field (the old
    // ps-health crash) — and never nothing, or the account cannot authenticate at all
    // (see the note on EID_USERS).
    const email = spec.email ?? (spec.username.includes('@') ? spec.username : null);

    if (!user) {
      await api('/users', {
        method: 'POST',
        body: {
          username: spec.username,
          ...(email ? { email } : {}),
          firstName: spec.first,
          lastName: spec.last,
          enabled: true,
          emailVerified: true,
          ...(spec.attributes ? { attributes: spec.attributes } : {}),
        },
      });
      [user] = await api(`/users?username=${encodeURIComponent(spec.username)}&exact=true`);
      log(`  ${spec.username} — created`);
    } else {
      log(`  ${spec.username} — exists`);
      // Backfill, so an account created by an earlier run of this script — or by hand in
      // the admin console — is repaired rather than left in the state that fails the
      // password grant. Re-running is the documented fix for a broken seed; it has to
      // actually fix this one.
      const needsEmail = email && user.email !== email
      if (spec.attributes || needsEmail) {
        if (needsEmail) log(`    + email: ${email}`);
        await api(`/users/${user.id}`, {
          method: 'PUT',
          raw: true,
          body: {
            ...user,
            ...(needsEmail ? { email, emailVerified: true } : {}),
            attributes: { ...(user.attributes || {}), ...(spec.attributes || {}) },
          },
        });
      }
    }

    // Always reset, so the documented password holds even for an account someone changed.
    await api(`/users/${user.id}/reset-password`, {
      method: 'PUT',
      raw: true,
      body: { type: 'password', value: PASSWORD, temporary: false },
    });

    const held = new Set((await api(`/users/${user.id}/role-mappings/realm`)).map((r) => r.name));
    const missing = spec.roles
      .filter((r) => !held.has(r))
      .map((r) => roleByName.get(r))
      .filter(Boolean);
    if (missing.length) {
      await api(`/users/${user.id}/role-mappings/realm`, {
        method: 'POST',
        raw: true,
        body: missing,
      });
      log(`    + realm roles: ${missing.map((r) => r.name).join(', ')}`);
    }

    for (const [clientId, roles] of Object.entries(spec.clientRoles || {})) {
      const [client] = await api(`/clients?clientId=${encodeURIComponent(clientId)}`);
      if (!client) continue;
      const available = await api(`/users/${user.id}/role-mappings/clients/${client.id}/available`);
      const want = available.filter((r) => roles.includes(r.name));
      if (want.length) {
        await api(`/users/${user.id}/role-mappings/clients/${client.id}`, {
          method: 'POST',
          raw: true,
          body: want,
        });
        log(`    + ${clientId} roles: ${want.map((r) => r.name).join(', ')}`);
      }
    }

    // Group membership only — no user attributes, matching exactly what MPS's own
    // provisioning sends. Aggregation (step 2) is what turns this into a claim.
    if (spec.group) {
      const group = agencyGroups.get(spec.group);
      if (group) {
        await api(`/users/${user.id}/groups/${group.id}`, { method: 'PUT', raw: true });
        log(`    + group: /${AGENCY_PARENT}/${spec.group}`);
      }
    }
  }
}

// --- run -------------------------------------------------------------------

log(`\nProvisioning MPS into ${KC} (realm ${REALM})\n`);
await authenticate();
log('[0] local web origins');
await ensureLocalOrigins();
log('\n[1] group-attribute aggregation');
await enableAttributeAggregation();
log('\n[1b] realm roles the export predates');
await ensureRealmRoles();
log('\n[1c] service-account grants (boot-time realm ensure + mailer reads)');
await ensureServiceAccountGrants();
log('\n[2] agencies');
const agencyGroups = await ensureAgencies();
log('\n[2b] agency groups carry no persona roles');
await stripPersonaRolesFromAgencyGroups(agencyGroups);
log('\n[3] users — username accounts');
await ensureUsers(USERS, agencyGroups);
log('\n[4] users — e-ID accounts (the ones the sign-in form can type)');
await ensureUsers(EID_USERS, agencyGroups);

log(`\nDone. Every seeded account signs in with the password: ${PASSWORD}`);
log('Sign in at http://localhost:5173 with an e-ID from [4]; the rest are API-only.\n');
