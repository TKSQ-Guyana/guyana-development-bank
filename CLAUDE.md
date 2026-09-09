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

- `backend/apps/gdb_bank` is a standard Frappe app; the image layers it on
  `frappe/erpnext:v16.34.2` (`backend/Dockerfile`). Any doctype/API change ships
  by rebuilding the image and re-running `create-site` (which migrates).
- All portal APIs are whitelisted methods in `gdb_bank/api.py`
  (`/api/method/gdb_bank.api.*`); auth is the Frappe session cookie from
  `/api/method/login`. The site runs with `ignore_csrf: 1` because the SPA
  never receives a Frappe-rendered CSRF token — nginx keeps `/api` same-origin.
- Site resolution is by the `X-Frappe-Site-Name` header (nginx sets it;
  the vite dev proxy sets it too). Site name: `gdb.localhost`.
- Roles: `Citizen` (website user; sees own Loan Applications only) and
  `Loan Underwriter` (+ System Manager) — enforcement is server-side in
  `api.py`, mirrored in the SPA (`is_underwriter` from `whoami`).
- Status transitions live ONLY in `review_loan`:
  Submitted → Under Review → Approved/Rejected.
- ERPNext does not run on Postgres. MariaDB 11.8 + two Redis instances are
  part of every environment.

## Local stack

`docker compose up -d --build` → mariadb, redis ×2, one-shot `create-site`
(first boot takes minutes; seeds demo users `citizen@example.gy` /
`underwriter@gdb.gov.gy`, password = `ADMIN_PASSWORD`, default `admin`),
backend gunicorn :8000, worker, scheduler, frontend nginx :3000.
Frontend dev loop: `npm run dev` in `frontend/` → vite :5173 proxying `/api`
to :8000. Rebuild only the backend after app changes:
`docker compose up -d --build backend create-site worker scheduler`.

## After every task

Frontend gates: `npm run typecheck && npm run build` in `frontend/`.
Backend sanity: `docker compose up -d --build create-site` (runs migrate) then
exercise an endpoint, e.g. login + `gdb_bank.api.whoami`.
