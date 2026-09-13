# Guyana Development Bank citizen loan portal — project instructions

ERPNext (v16, MariaDB + Redis) is the backend via the `gdb_bank` custom Frappe
app; a React SPA (`frontend/`) is the citizen portal with a role-gated
underwriter review queue. The official name everywhere is
**Guyana Development Bank (GDB)**.

## Working agreements

- Commit at every working logic state; conventional-commit subjects.
- Never `git push` unless explicitly asked.
- Docker Hub images follow the MPS-Guyana convention: one repo
  `ravinadh/ksquarenis`, tags `gdb<run>`/`gdb-latest` (frontend) and
  `gdb-backend<run>`/`gdb-backend-latest` (backend), pushed by CI using the
  `DOCKERHUB_TOKEN` repo secret.

## Architecture facts

- **Four services total**: mariadb, redis (cache `/0`, queue `/1`), backend,
  frontend. The backend container is self-contained: `start-backend.sh`
  bootstraps the site under a flock on the shared sites volume (replica-safe),
  then runs gunicorn (loopback :8000) + worker + scheduler behind the image's
  own nginx on **:8080**, which also serves the ERPNext desk UI.
- Loans are the **official frappe/lending app's Loan Application** doctype
  (`ACC-LOAP-…`), pinned at v16.5.0 in `backend/Dockerfile`. gdb_bank has NO
  doctype of its own — portal-only facts ride gdb_* Custom Fields
  (install.CUSTOM_FIELDS) and `gdb_bank/api.py` maps the stable portal
  contract (purpose/term_months/status Submitted|Approved|Rejected) onto it;
  lending's `Open` = portal `Submitted`. Status changes happen ONLY in
  `review_loan` via `db_set` (docs are submitted; status is permlevel 1).
- Seeded lending masters (`install.ensure_lending_defaults`): Loan Product
  "GDB Standard Loan" (GDB-STD, 8% term loan) + "GDB Standard Offset Order"
  demand offset order wired into the Company. Loan accounting stays DISABLED
  on the company — enabling it makes ~16 GL accounts mandatory on the product.
- All portal APIs are whitelisted methods in `gdb_bank/api.py`
  (`/api/method/gdb_bank.api.*`); auth is the Frappe session cookie from
  `/api/method/login`. The site runs with `ignore_csrf: 1` because the SPA
  never receives a Frappe-rendered CSRF token — nginx keeps `/api` same-origin.
- **TWO WAYS IN, both ending in the same `sid` session** — so nothing
  downstream of `whoami` knows or cares which was used:
  - **e-ID + password** → `gdb_bank/identity.py`: the Keycloak password grant
    with the e-ID AS the username, confirmed against Keycloak's `userinfo`,
    then `login_manager.login_as()`. The e-ID shape (3-4-4, eleven digits,
    dashes included) is stated in exactly two places that must agree —
    `identity.py` and `frontend/src/eid.ts`. Tokens are used once and dropped;
    Keycloak logout does NOT kill `sid`.
    First sign-in **links** the e-ID to an existing User with the same email,
    or **provisions** a Website User with `Citizen`. **Roles never come from
    Keycloak** — staff access stays a manual Frappe grant. Disabling the
    Frappe User is the kill switch and works even while Keycloak still
    authenticates. Rate-limited 8/min per e-ID (Frappe's own
    `track_login_attempts` guards `/api/method/login`, which this never hits).
  - **email + password** → Frappe's own login, untouched and still the path
    the seeded demo users take. Retiring it (`disable_user_pass_login`) is a
    later, separate decision — and Frappe refuses that switch until a Social
    Login Key or LDAP exists, which this ROPC path is not.
  - ⚠️ This authenticates an e-ID somebody **provisioned**; it does not prove
    the person typing it is the person it names. An e-ID is an identifier, not
    a secret. Real proofing is the My Guyana broker in
    `docs/architecture/identity-and-auth.md`, which supersedes this path.
- Roles: `Citizen` (website user; sees own applications only) and
  `Loan Underwriter` (+ System Manager) — enforcement is server-side in
  `api.py`, mirrored in the SPA (`is_underwriter` from `whoami`). The demo
  underwriter also holds lending's `Loan Manager` for desk visibility.
- ERPNext does not run on Postgres. MariaDB 11.8 + one Redis are part of
  every environment.

## Local stack

`docker compose up -d --build` → mariadb, redis, backend (first boot takes
minutes: new-site + erpnext + lending + gdb_bank + wizard + seeds; watch
`logs -f backend`; seeds demo users `citizen@example.gy` /
`underwriter@gdb.gov.gy`, password = `ADMIN_PASSWORD`, default `admin`),
keycloak :8086, frontend nginx :3000; desk at :8080. Frontend dev loop:
`npm run dev` in `frontend/` → vite :5173 proxying `/api` to :8080. After
backend app changes: `docker compose up -d --build backend` (restart runs
migrate + seeds again). `localhost` cookies are shared across ports 3000/8080
— log out of one before logging into the other.

**Keycloak :8086** (admin/admin, realm `gdb-citizen`, auto-imported from
`keycloak/gdb-realm.json`). e-ID accounts, password `ChangeMe@123`:
`592-1111-0001` (links to the seeded citizen), `592-2222-0002` (links to the
underwriter), `592-3333-0003` (provisions a new citizen). **8086, not 8085** —
the sibling MPS-Guyana stack holds 8085 and both run on this machine.
Keycloak imports a realm ONLY if it does not already exist, so editing the
realm JSON needs `docker compose rm -sf keycloak && docker volume rm
guyana-development-bank_keycloak-data` first — see `keycloak/README.md`, which
also records the four settings that are load-bearing (every user needs an
email; `temporary: false` on credentials; `directAccessGrantsEnabled`;
`loginWithEmailAllowed: false`).

## After every task

Frontend gates: `npm run typecheck && npm run build` in `frontend/`.
Backend sanity: `docker compose up -d --build backend`, wait for
`Site … ready`, then exercise an endpoint (login + `gdb_bank.api.whoami`).
