// GDB realm seeder — the Keycloak half of the persona registry.
//
// `setup-mps.mjs` seeds the shared Guyana-Gov realm (MPS roles, the agency
// register, the MPS test accounts). This seeds what GDB adds on top:
//
//   1. The realm roles every GDB persona maps from, plus a protocol mapper so
//      the `eid` user attribute reaches the token as a claim.
//   2. The `gdb-portal` public OIDC client the SPA runs PKCE against.
//   3. One test account per persona, matching the Frappe demo users created by
//      `gdb_bank.install.make_demo_users`, so a developer can sign in as any
//      persona end to end.
//
// Roles and the client come from `gdb-realm-structure.generated.mjs`, which is
// generated from `rbac/personas.py`. Adding a persona therefore reaches
// Keycloak by regenerating, not by editing this file.
//
// STRUCTURE vs TEST DATA: items 1 and 2 are structure and belong in any realm.
// Item 3 is local-only — passwords and localhost origins must never reach a
// deployed realm, which is why they live in this dev seeder and not in the
// generated structure module.

import {
  GDB_REALM_ROLES,
  GDB_PORTAL_CLIENT,
  GDB_EID_CLAIM,
} from '../backend/scripts/gdb-realm-structure.generated.mjs';

const KC = (process.env.KC || 'http://localhost:8080').replace(/\/+$/, '');
const REALM = process.env.REALM || 'Guyana-Gov';
const ADMIN = process.env.KC_ADMIN || 'admin';
const ADMIN_PW = process.env.KC_ADMIN_PASSWORD || 'admin';
const PASSWORD = process.env.GDB_DEMO_PASSWORD || 'ChangeMe@123';

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

// --- 1. realm roles -----------------------------------------------------------

async function ensureRealmRoles() {
  const existing = new Set((await api('/roles')).map((r) => r.name));
  const seen = new Set();

  for (const role of GDB_REALM_ROLES) {
    if (seen.has(role.name)) continue; // two personas may share a realm role
    seen.add(role.name);

    if (existing.has(role.name)) {
      log(`  ${role.name} — present`);
      continue;
    }
    await api('/roles', {
      method: 'POST',
      body: { name: role.name, description: role.description },
    });
    log(`  ${role.name} — created (persona: ${role.persona})`);
  }
}

// --- 2. the gdb-portal public client ------------------------------------------
// Public + PKCE: the SPA holds no client secret, per CLAUDE.md section 4.

async function ensurePortalClient() {
  const [existing] = await api(
    `/clients?clientId=${encodeURIComponent(GDB_PORTAL_CLIENT.clientId)}`,
  );

  if (!existing) {
    await api('/clients', {
      method: 'POST',
      body: {
        ...GDB_PORTAL_CLIENT,
        protocol: 'openid-connect',
        // Direct access grants stay OFF: the whole point of PKCE is that the
        // portal never sees a password to send.
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        fullScopeAllowed: true,
      },
    });
    log(`  ${GDB_PORTAL_CLIENT.clientId} — created`);
  } else {
    // Converge redirect URIs and web origins without clobbering anything an
    // operator added by hand for a deployed edge.
    const redirectUris = new Set([
      ...(existing.redirectUris || []),
      ...GDB_PORTAL_CLIENT.redirectUris,
    ]);
    const webOrigins = new Set([
      ...(existing.webOrigins || []),
      ...GDB_PORTAL_CLIENT.webOrigins,
    ]);
    existing.redirectUris = [...redirectUris];
    existing.webOrigins = [...webOrigins];
    existing.publicClient = true;
    existing.attributes = { ...(existing.attributes || {}), ...GDB_PORTAL_CLIENT.attributes };
    await api(`/clients/${existing.id}`, { method: 'PUT', raw: true, body: existing });
    log(`  ${GDB_PORTAL_CLIENT.clientId} — converged`);
  }

  await ensureEidMapper();
}

// --- 2b. the e-ID claim mapper ------------------------------------------------
// Without this the `eid` user attribute never reaches the token, `whoami`
// returns eid: null, and every scoped query denies — the failure that looks
// like "the portal shows nothing".

async function ensureEidMapper() {
  const [client] = await api(
    `/clients?clientId=${encodeURIComponent(GDB_PORTAL_CLIENT.clientId)}`,
  );
  if (!client) return;

  const mappers = await api(`/clients/${client.id}/protocol-mappers/models`);
  if (mappers.some((m) => m.name === 'gdb-eid')) {
    log('  gdb-eid claim mapper — present');
    return;
  }

  await api(`/clients/${client.id}/protocol-mappers/models`, {
    method: 'POST',
    body: {
      name: 'gdb-eid',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-attribute-mapper',
      config: {
        'user.attribute': GDB_EID_CLAIM,
        'claim.name': GDB_EID_CLAIM,
        'jsonType.label': 'String',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
        'userinfo.token.claim': 'true',
      },
    },
  });
  log('  gdb-eid claim mapper — created');
}

// --- 3. one test account per persona ------------------------------------------
// Emails and e-IDs match gdb_bank.install._demo_account so the same identity
// resolves on both sides.

const DEMO_USERS = (() => {
  const byPersona = new Map();
  for (const role of GDB_REALM_ROLES) {
    if (!byPersona.has(role.persona)) byPersona.set(role.persona, []);
    byPersona.get(role.persona).push(role.name);
  }
  return [...byPersona.entries()].map(([persona, roles], i) => ({
    persona,
    roles,
    username: `${persona.replace(/_/g, '.')}@gdb.gov.gy`,
    eid: `999-${String(1000 + i + 1).padStart(4, '0')}-${String(i + 1).padStart(3, '0')}`,
  }));
})();

async function ensureUsers() {
  const realmRoles = await api('/roles');
  const roleByName = new Map(realmRoles.map((r) => [r.name, r]));

  for (const spec of DEMO_USERS) {
    let [user] = await api(`/users?username=${encodeURIComponent(spec.username)}&exact=true`);

    if (!user) {
      await api('/users', {
        method: 'POST',
        body: {
          username: spec.username,
          email: spec.username,
          firstName: 'Demo',
          lastName: spec.persona,
          enabled: true,
          emailVerified: true,
          attributes: { [GDB_EID_CLAIM]: [spec.eid] },
          credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
        },
      });
      [user] = await api(`/users?username=${encodeURIComponent(spec.username)}&exact=true`);
      log(`  ${spec.username} — created (e-ID ${spec.eid})`);
    } else {
      log(`  ${spec.username} — present`);
    }
    if (!user) continue;

    const assigned = new Set((await api(`/users/${user.id}/role-mappings/realm`)).map((r) => r.name));
    const missing = spec.roles.filter((r) => !assigned.has(r) && roleByName.has(r));
    if (missing.length) {
      await api(`/users/${user.id}/role-mappings/realm`, {
        method: 'POST',
        raw: true,
        body: missing.map((r) => roleByName.get(r)),
      });
      log(`    + realm roles ${missing.join(', ')}`);
    }
  }
}

// --- run ----------------------------------------------------------------------

await authenticate();
log(`[setup-gdb] realm ${REALM} at ${KC}`);

log('[setup-gdb] realm roles');
await ensureRealmRoles();

log('[setup-gdb] gdb-portal client');
await ensurePortalClient();

log('[setup-gdb] persona test accounts');
await ensureUsers();

log('[setup-gdb] done');
