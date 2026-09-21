// Put a mobile number on every portal account, so the MFA approval link can be
// TEXTED rather than displayed (backend/src/mfa/identity.ts reads it).
//
// PROVISIONING NOW CAPTURES THIS PER PERSON — the IT admin's Users screen has a
// Mobile field and writes this same attribute (frontend/src/features/users/
// account.js, MOBILE_ATTRIBUTE). So this script is no longer how numbers get
// onto NEW accounts; it exists for the SEEDED ones, which were created before
// the field did and would otherwise fall back to the on-screen copy link.
// Every account it touches gets the same test number, which is fine for a
// local realm and would not be for anything else.
//
//   node keycloak-local/set-phone-numbers.mjs                 # the default number below
//   node keycloak-local/set-phone-numbers.mjs +5921234567     # a different one
//   PHONE=+592... node keycloak-local/set-phone-numbers.mjs
//
// Env, same as setup-mps.mjs:
//   KC=http://localhost:8085  REALM=Guyana-Gov  KC_ADMIN=admin  KC_ADMIN_PASSWORD=admin
//
// THE ATTRIBUTE NAME IS THE CONTRACT. The backend reads MFA_PHONE_ATTRIBUTE
// (default `mobile`); change one and change the other. `mobile` is already
// declared in this realm's user profile, which is load-bearing: Keycloak 26
// DROPS any attribute the profile does not declare — silently, on write — so
// an undeclared name round-trips as absent and reads as a broken feature
// (measured with `phoneNumber`, 2026-08-28). The value is stored E.164 — a leading + and digits — because that is
// what the SMS gateway takes and what backend/src/services/sms.ts validates.
//
// SERVICE ACCOUNTS ARE SKIPPED. They are not people and have no phone; giving
// one a number would only make a stray SMS possible.
//
// Idempotent: re-running overwrites the same attribute and leaves every other
// attribute on the account (agency_id and friends) untouched.

const KC = (process.env.KC || 'http://localhost:8085').replace(/\/+$/, '');
const REALM = process.env.REALM || 'Guyana-Gov';
const ADMIN = process.env.KC_ADMIN || 'admin';
const ADMIN_PW = process.env.KC_ADMIN_PASSWORD || 'admin';
const ATTRIBUTE = process.env.PHONE_ATTRIBUTE || 'mobile';

const PHONE = (process.argv[2] || process.env.PHONE || '+5927126852').trim();

if (!/^\+\d{8,15}$/.test(PHONE)) {
  console.error(`Not an E.164 number: "${PHONE}". Expected a leading + and 8-15 digits.`);
  process.exit(1);
}

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  if (raw || res.status === 204) return null;
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

async function main() {
  await authenticate();
  log(`Realm ${REALM} at ${KC}`);
  log(`Setting ${ATTRIBUTE} = ${PHONE}\n`);

  // EVERY PAGE, not the first 500. This used to ask for `max=500` and take
  // whatever came back, which is a silent cap: on a realm with more accounts
  // than that it would report success having skipped the rest, and the people
  // it skipped would fall back to the on-screen link with nothing to say why.
  // A dev realm is usually well under the cap — which is exactly what makes the
  // bug invisible until it is not.
  //
  // briefRepresentation=false so `attributes` comes back and the PUT below does
  // not wipe the ones already on the account.
  const PAGE = 100;
  const users = [];
  for (let first = 0; ; first += PAGE) {
    const batch = await api(`/users?briefRepresentation=false&first=${first}&max=${PAGE}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    users.push(...batch);
    if (batch.length < PAGE) break;
  }
  log(`${users.length} account${users.length === 1 ? '' : 's'} in the realm`);

  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.serviceAccountClientId || user.username?.startsWith('service-account-')) {
      skipped++;
      continue;
    }

    const attributes = { ...(user.attributes || {}), [ATTRIBUTE]: [PHONE] };
    // The full representation back, with attributes merged — Keycloak's user
    // update replaces the object it is given.
    await api(`/users/${user.id}`, { method: 'PUT', body: { ...user, attributes }, raw: true });
    updated++;
    log(`  + ${user.username}`);
  }

  log(`\nDone. ${updated} account${updated === 1 ? '' : 's'} updated, ${skipped} service account${skipped === 1 ? '' : 's'} skipped.`);
  log('Sign in again to pick it up — the backend reads the attribute per challenge (60s cache).');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
