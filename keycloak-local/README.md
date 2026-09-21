# Keycloak for local MPS development

Signing into MPS against `https://keycloak.ksquare.local` fails in the browser with
`NET::ERR_CERT_AUTHORITY_INVALID` — the server is reachable on the VPN, but its internal CA
is not trusted, so the token request never completes and the screen says *"Sign-in failed."*

This runs the same realm locally over plain HTTP. Browsers exempt `localhost` from the
secure-context rule, so there is no certificate in the picture at all.

## Start it

```powershell
cd keycloak-local
docker compose up -d
node setup-mps.mjs
```

Keycloak comes up on **http://localhost:8080** (admin console `admin` / `admin`).

Then point the portal at it — already done in `frontend/.env.development.local`:

```env
KC_URL=http://localhost:8080
DATA_SOURCE=seed
```

and restart `npm run dev` in `frontend/`.

## Accounts

Every account uses the password **`ChangeMe@123`** — deliberately the same string as
`DEFAULT_PASSWORD` in `src/features/users/account.js`, which is what the portal assigns to
every account it provisions itself. So one password covers every local account however it was
created. (The realm enforces `length(10) and specialChars(1) and notUsername`; `ChangeMe@123`
satisfies it, `Passw0rd!` does not.)

| Username | Realm role | Portal persona |
| --- | --- | --- |
| `ps@mps.gov.gy` | MPS_PS | Permanent Secretary |
| `cpo@mps.gov.gy` | MPS_CPO | Chief Personnel Officer |
| `sec@mps.gov.gy` | MPS_Conf_Secretary | Confidential Secretary |
| `off@mps.gov.gy` | MPS_HR_Officer | Personnel Officer |
| `min@mps.gov.gy` | MPS_Minister | Minister |
| `clerk@mps.gov.gy` | MPS_Data_Clerk | Data Entry Clerk (signed-memo scan & upload) |
| `adm@mps.gov.gy` | MPS_IT_Admin (+ realm-management) | IT Administrator |
| `agency@moh.gov.gy` | MPS_Agency_Originator, `/MPS-Agencies/AG-MOH` | Agency Originator |

### e-ID accounts — the only ones the sign-in form can type

**The table above cannot be used at http://localhost:5173.** The sign-in form takes an e-ID
as three boxes of 3, 4 and 4 **digits** (`src/pages/SignIn/EidInput.jsx`), so there is no way
to enter an `@` — those accounts are reachable only from Postman, the admin console, or the
backend's `/auth/login` directly. Every persona therefore has a second account under an e-ID.

The repeated digit *is* the persona, so nothing has to be looked up. Same password.

| e-ID | Realm role | Portal persona |
| --- | --- | --- |
| `111-1111-1111` | MPS_PS | Permanent Secretary |
| `222-2222-2222` | MPS_CPO | Chief Personnel Officer |
| `333-3333-3333` | MPS_Conf_Secretary | Confidential Secretary |
| `444-4444-4444` | MPS_HR_Officer | Personnel Officer |
| `555-5555-5555` | MPS_Minister | Minister |
| `666-6666-6666` | MPS_Data_Clerk | Data Entry Clerk |
| `777-7777-7777` | MPS_IT_Admin (+ realm-management) | IT Administrator |
| `333-4444-4444` | MPS_Agency_Originator, `/MPS-Agencies/AG-MOH` | Agency Originator — Health |
| `888-8888-8888` | MPS_Agency_Originator, `/MPS-Agencies/AG-MOE` | Agency Originator — Education |
| `999-9999-9999` | MPS_Agency_Originator, `/MPS-Agencies/AG-MOA` | Agency Originator — Agriculture |

`333-4444-4444` is the odd one out because it predates the rest — it was made by hand while
the e-ID field was being built. The script now carries it verbatim rather than changing it.

The three originators sit in three different agencies deliberately: that is what makes the
per-agency grants visible from inside the portal.

**If one of these ever answers `invalid_grant: "Account is not fully set up"`, it is missing
its email.** The realm's declarative user profile marks email required for the `user` role,
and Keycloak validates the profile during authentication — so an account with no email is
created without complaint, shows no required actions in the console, and then fails the
password grant with a message that points at neither. Re-running `setup-mps.mjs` backfills it.

`psc` and `gra` have no realm role — as noted in `src/auth/claims.js`, nobody can sign in as
either yet, here or in production.

The 2026-08 realm export ships no human accounts (only service accounts), names the
`/MPS-Agencies` children by agency id (`AG-MOH`, …) with `agency_id`/`agency_name`
attributes already in place, and adds the `MPS_Data_Clerk` realm role. The old
`ps-health` account is gone with it.

## Live data: works against the local Node backend, not the MuleSoft gateway

`src/services/apiClient.js` puts the Keycloak token on every gateway call, and the server
re-validates it against ITS Keycloak's signing keys. So the pairing matters:

- **`backend/` (local Node backend)** validates against this local realm — point the
  frontend's `API_UPSTREAM` at `http://localhost:8081` and `DATA_SOURCE=live` works with
  locally-issued tokens. This is the default in `.env.development.local` now.
- **MuleSoft gateway** validates against the **real** Keycloak, so a locally-issued token is
  rejected — running against it needs `DATA_SOURCE=seed`, or the real Keycloak (which means
  trusting the internal CA in your browser).

## What setup-mps.mjs does, and why

`realm-export.json` is a genuine export of Guyana-Gov, so the clients and roles are already
right: both MPS clients are public, have Direct Access Grants on (the ROPC grant the sign-in
form needs), list `http://localhost:5173` in Web Origins, and carry their own protocol mappers
for `mps_roles`, `agency_id`, `agency_name` and the `mule-api` audience.

The script fills the three gaps:

1. **Agencies.** Ensures the `/MPS-Agencies` children exist. The current export already
   ships them (named by agency id, attributes included), so this is a no-op on a fresh
   import; an older export gets them created.
2. **Users.** Creates the table above, and resets every one of them to the known password on
   each run.
3. **Group attribute aggregation.** The exported `agency_id`/`agency_name` mappers have
   `aggregate.attrs: false`, so they read the attribute from the *user record* only. But MPS
   provisions agency users by **group membership alone** — `toUserRepresentation` in
   `src/features/users/account.js` sends `groups` and no attributes. As exported, such a user's
   token carries no `agency_id`, and `keycloakAdapter.js` then hands them an **empty agency
   scope** — they would see none of their own agency's records. The script flips aggregation on.

   **This mismatch is probably in the shared realm too, and is worth raising with whoever owns
   it.** Nothing in the portal can work around it; the claim simply is not in the token.

Do **not** add an `mps-claims` client scope on top of the clients' own mappers — the claims are
then emitted twice and `mps_roles` comes back with every role duplicated. The script deletes
that scope if it finds it.

The script is idempotent; re-run it any time.

## Lifecycle

`start-dev` keeps its H2 database inside the container layer:

- `docker compose restart` — keeps users and anything you changed in the console
- `docker compose down` — discards it and re-imports `realm-export.json` fresh, so
  **re-run `node setup-mps.mjs` afterwards**

## Ports

8080 (Keycloak) and 9000 (health). MPS is on 5173 and the WebAuthn POC on 5273/4100, so
nothing collides.

This container may already exist from an earlier local checkout — same name
(`guyana-keycloak`), same image, same realm file. Run it from one place or the other, not both.
