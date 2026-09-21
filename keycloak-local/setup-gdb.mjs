// GDB realm seeder — the Keycloak half of the persona registry.
//
// `setup-mps.mjs` seeds the shared Guyana-Gov realm (MPS roles, the agency
// register, the MPS test accounts). This seeds what GDB adds on top:
//
//   1. The realm roles every GDB persona maps from, plus the protocol mappers
//      that put the `eid` attribute and the client's own audience in the token.
//   2. The `gdb-portal` public OIDC client the SPA runs PKCE against, and the
//      GDB login theme that turns Keycloak's credential page into one that asks
//      a citizen for an e-ID rather than a "Username".
//   3. One test account per persona, matching the Frappe demo users created by
//      `gdb_bank.install.make_demo_users`, so a developer can sign in as any
//      persona end to end.
//
// Everything below comes from `gdb-realm-structure.generated.mjs`, which is
// generated from `rbac/personas.py` and `rbac/demo.py`. Adding a persona
// therefore reaches Keycloak by regenerating, not by editing this file.
//
// STRUCTURE vs TEST DATA: items 1 and 2 are structure and belong in any realm.
// Item 3 is local-only. The identities are generated (so the Frappe and
// Keycloak halves cannot drift) but the PASSWORD is read from the environment
// here and never generated — a credential must not be committed to a file that
// a deployed realm gate might one day read.

import {
  GDB_REALM_ROLES,
  GDB_PORTAL_CLIENT,
  GDB_AUDIENCE_MAPPER,
  GDB_EID_CLAIM,
  GDB_LOGIN_THEME,
  GDB_DEMO_IDENTITIES,
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

  await ensureMapper('gdb-eid', eidMapper());
  await ensureMapper(GDB_AUDIENCE_MAPPER.name, GDB_AUDIENCE_MAPPER);
}

// --- 2b. protocol mappers -----------------------------------------------------
// TWO MAPPERS, TWO DIFFERENT FAILURES IF MISSING.
//
//   gdb-eid     Without it the `eid` user attribute never reaches the token,
//               `whoami` returns eid: null, and every scoped query denies —
//               the failure that looks like "the portal shows nothing".
//
//   audience    Without it `verify_token` rejects every token, because Keycloak
//               does not put a public client's own id in `aud`. See the comment
//               on GDB_AUDIENCE_MAPPER in the generated structure module.

function eidMapper() {
  return {
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
  };
}

async function ensureMapper(name, definition) {
  const [client] = await api(
    `/clients?clientId=${encodeURIComponent(GDB_PORTAL_CLIENT.clientId)}`,
  );
  if (!client) return;

  const mappers = await api(`/clients/${client.id}/protocol-mappers/models`);
  const existing = mappers.find((m) => m.name === name);

  if (existing) {
    // Converge rather than skip. A mapper left over from an earlier run with
    // the wrong config is worse than a missing one: it looks present in the
    // admin console while producing a token the backend refuses.
    await api(`/clients/${client.id}/protocol-mappers/models/${existing.id}`, {
      method: 'PUT',
      raw: true,
      body: { ...existing, ...definition, id: existing.id },
    });
    log(`  ${name} mapper — converged`);
    return;
  }

  await api(`/clients/${client.id}/protocol-mappers/models`, {
    method: 'POST',
    body: definition,
  });
  log(`  ${name} mapper — created`);
}

// --- 2bis. the `eid` user-profile attribute -----------------------------------
//
// THE SILENT FAILURE THIS EXISTS TO PREVENT. Keycloak 26's declarative user
// profile drops any attribute it does not know about: `unmanagedAttributePolicy`
// is unset by default, which means DISABLED. Writing `attributes: { eid: [...] }`
// on a user therefore succeeds, returns 204, and stores nothing. Nothing in the
// seeder's output looks wrong.
//
// Downstream, the `gdb-eid` mapper finds no attribute, the token carries no
// `eid` claim, `whoami` answers `eid: null`, and every row-scoped query matches
// nothing — a citizen who signs in perfectly and is shown an empty portal, with
// no error at any layer. It was doing exactly this until the seeded accounts
// were inspected directly.
//
// DECLARED, NOT UNMANAGED. Turning `unmanagedAttributePolicy` on would fix the
// symptom and leave every future typo'd attribute name silently accepted. A
// declared attribute also lets the e-ID carry its own format validation, and —
// the part that matters — lets it be admin-writable but NOT user-writable. The
// e-ID is the key every row-level permission scopes on; a citizen who could
// edit their own would be choosing whose applications they can see.

const EID_ATTRIBUTE = {
  name: GDB_EID_CLAIM,
  displayName: 'e-ID Number',
  multivalued: false,
  permissions: {
    view: ['admin'],
    // NOT 'user'. See above — this is a row-level security boundary, not a
    // profile preference.
    edit: ['admin'],
  },
  validations: {
    pattern: {
      // 3-4-4, the same shape as domain/eid_format.py and the login theme.
      pattern: '^\\d{3}-\\d{4}-\\d{4}$',
      'error-message': 'Enter the e-ID as 3, then 4, then 4 digits.',
    },
  },
};

async function ensureEidAttribute() {
  const profile = await api('/users/profile');
  const attributes = profile.attributes || [];
  const existing = attributes.find((a) => a.name === GDB_EID_CLAIM);

  if (existing && JSON.stringify(existing) === JSON.stringify(EID_ATTRIBUTE)) {
    log(`  ${GDB_EID_CLAIM} attribute — present`);
    return;
  }

  // Replace in place rather than append, so re-running converges an attribute
  // an earlier version of this script declared differently.
  const next = existing
    ? attributes.map((a) => (a.name === GDB_EID_CLAIM ? EID_ATTRIBUTE : a))
    : [...attributes, EID_ATTRIBUTE];

  await api('/users/profile', {
    method: 'PUT',
    raw: true,
    body: { ...profile, attributes: next },
  });
  log(`  ${GDB_EID_CLAIM} attribute — ${existing ? 'converged' : 'declared'}`);
}

// --- 2c. the GDB login theme --------------------------------------------------
// Under PKCE the citizen types their e-ID on Keycloak's page, not ours. Stock
// Keycloak asks for a "Username". The theme in keycloak-local/themes/gdb turns
// that into the three-box e-ID control, and docker-compose mounts it.

async function ensureLoginTheme() {
  const realm = await api('');
  if (realm.loginTheme === GDB_LOGIN_THEME) {
    log(`  loginTheme ${GDB_LOGIN_THEME} — present`);
    return;
  }
  await api('', { method: 'PUT', raw: true, body: { ...realm, loginTheme: GDB_LOGIN_THEME } });
  log(`  loginTheme ${GDB_LOGIN_THEME} — set (was ${realm.loginTheme || 'default'})`);
}

// --- 3. one test account per persona ------------------------------------------
// GDB_DEMO_IDENTITIES is generated from rbac/demo.py, which install.py also
// builds the Frappe side from. Both halves therefore name the same person by
// the same e-ID by construction rather than by two people remembering to.
//
// The USERNAME IS THE E-ID. That is the whole point: it is what a citizen is
// asked for on Keycloak's page. The email is carried separately because Frappe
// keys User on an email address and cannot mint a session without one.

/** Keycloak refuses `/ < > & " ' $ % ! # ? § ; * ~ \ | ^ = [ ] { } ( )` in a
 *  person's name (`error-person-name-invalid-character`). Persona titles are
 *  written for humans and one of them is "Board / CEO", so the title cannot go
 *  through unfiltered — the seeder died on that one persona, after having
 *  already created the five before it. */
function personName(value) {
  return value.replace(/[^\p{L}\p{N} .'-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

async function findUser(username) {
  // `briefRepresentation=false` — the brief form omits `attributes`, which is
  // where the e-ID lives. Without this the convergence check below sees no
  // e-ID on every account and rewrites one it had just written.
  const [user] = await api(
    `/users?username=${encodeURIComponent(username)}&exact=true&briefRepresentation=false`,
  );
  return user;
}

async function ensureUsers() {
  const realmRoles = await api('/roles');
  const roleByName = new Map(realmRoles.map((r) => [r.name, r]));

  for (const spec of GDB_DEMO_IDENTITIES) {
    let user = await findUser(spec.username);

    // A realm seeded before this change holds the same person under an EMAIL
    // username. Rename rather than create: Keycloak refuses a second account
    // with the same email, our `api()` swallows that 409, and the loop would
    // then skip the persona entirely — a seeder reporting success while one
    // persona quietly has no account at all.
    if (!user) {
      const [legacy] = await api(`/users?username=${encodeURIComponent(spec.email)}&exact=true`);
      if (legacy) {
        await api(`/users/${legacy.id}`, {
          method: 'PUT',
          raw: true,
          body: { ...legacy, username: spec.username },
        });
        log(`  ${spec.persona.padEnd(22)} username ${spec.email} -> ${spec.username}`);
        user = await findUser(spec.username);
      }
    }

    if (!user) {
      const [first, ...rest] = personName(spec.fullName).split(' ');
      await api('/users', {
        method: 'POST',
        body: {
          username: spec.username,
          email: spec.email,
          firstName: first,
          lastName: rest.join(' ') || personName(spec.persona),
          enabled: true,
          emailVerified: true,
          attributes: { [GDB_EID_CLAIM]: [spec.eid] },
          credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
        },
      });
      user = await findUser(spec.username);
      log(`  ${spec.persona.padEnd(22)} e-ID ${spec.eid} — created`);
    } else {
      log(`  ${spec.persona.padEnd(22)} e-ID ${spec.eid} — present`);
    }
    if (!user) continue;

    // Converge the e-ID attribute even on an account that already exists: a
    // realm seeded before the 3-4-4 correction still carries the old 3-4-3
    // value, which `security/eid.is_valid` now refuses. Without this the
    // account authenticates and then scopes to nothing.
    const attributes = user.attributes || {};
    if ((attributes[GDB_EID_CLAIM] || [])[0] !== spec.eid) {
      await api(`/users/${user.id}`, {
        method: 'PUT',
        raw: true,
        body: { ...user, attributes: { ...attributes, [GDB_EID_CLAIM]: [spec.eid] } },
      });
      log(`    ~ e-ID attribute corrected to ${spec.eid}`);
    }

    const assigned = new Set((await api(`/users/${user.id}/role-mappings/realm`)).map((r) => r.name));
    const missing = spec.realmRoles.filter((r) => !assigned.has(r) && roleByName.has(r));
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

// Before the accounts: an e-ID written to a user before the attribute is
// declared is discarded, and the discard is silent.
log('[setup-gdb] user-profile attributes');
await ensureEidAttribute();

log('[setup-gdb] gdb-portal client');
await ensurePortalClient();

log('[setup-gdb] login theme');
await ensureLoginTheme();

log('[setup-gdb] persona test accounts');
await ensureUsers();

log('[setup-gdb] done');
