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
frontend nginx :3000; desk at :8080. Frontend dev loop: `npm run dev` in
`frontend/` → vite :5173 proxying `/api` to :8080. After backend app changes:
`docker compose up -d --build backend` (restart runs migrate + seeds again).
`localhost` cookies are shared across ports 3000/8080 — log out of one before
logging into the other.

## After every task

Frontend gates: `npm run typecheck && npm run build` in `frontend/`.
Backend sanity: `docker compose up -d --build backend`, wait for
`Site … ready`, then exercise an endpoint (login + `gdb_bank.api.whoami`).
