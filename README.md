# Guyana Development Bank — Citizen Loan Portal

Citizens apply for GDB loans and track their history online; GDB underwriters
review, approve or reject every application. **ERPNext + the official Frappe
lending module is the backend**, **React is the citizen portal** — shipped as
**two Docker images** running in a **four-service** stack.

## What's built — component inventory

### 1. Backend — `gdb-backend` image ([backend/](backend))

Built on `frappe/erpnext:v16.34.2`, self-contained (one container = whole
ERPNext):

| Piece | What it does |
| --- | --- |
| **[frappe/lending](https://github.com/frappe/lending) v16.5.0** | Baked into the image; loans are its official `Loan Application` doctype (`ACC-LOAP-…`) with real amortization from the seeded loan product (e.g. 8% on 2.5M/36mo → GYD 78,341/mo) |
| **`gdb_bank` custom app** | Roles (Citizen, Loan Underwriter), 7 portal REST endpoints (`signup, whoami, apply_loan, my_loans, loan_detail, all_loans, review_loan`), `gdb_*` custom fields (purpose, income, remarks, reviewer, portal-user link), frappe-native INFO logging to `logs/gdb_bank.log` |
| **Seeding (idempotent)** | Headless setup-wizard completion (company "Guyana Development Bank", GYD), "GDB Standard Loan" product + demand offset order, demo users |
| **`start-backend.sh`** | On start: lock-guarded site create/migrate → gunicorn + worker + scheduler → the image's nginx on **:8080** (serves the ERPNext desk UI + API) |

### 2. Frontend — `gdb-frontend` image ([frontend/](frontend))

React 18 + Vite + Tailwind SPA on nginx (proxies `/api` to the backend — no
CORS):

- **Citizen:** login/self-signup, apply-for-loan form, application history
  with status badges, detail view
- **Underwriter:** role-gated Review Queue (All/Submitted/Approved/Rejected
  tabs), approve/reject with remarks

### 3. Infrastructure & operations

- **[docker-compose.yml](docker-compose.yml)** — exactly 4 services:
  `mariadb` (11.8), `redis` (cache DB /0, queue DB /1), `backend`, `frontend`;
  fully automatic cold start
- **[k8s/](k8s)** — reference manifests for namespace `gdb-dev`:
  `gdb-backend` + `gdb-frontend` at 2 replicas each, MariaDB, Redis, shared
  RWX sites PVC
- **[CI](.github/workflows/ci.yml)** — builds & pushes
  `ravinadh/ksquarenis:gdb<N>`/`gdb-latest` and
  `gdb-backend<N>`/`gdb-backend-latest` (MPS convention), plus a manual
  deploy job

### 4. Documentation

- [docs/openapi.yaml](docs/openapi.yaml) — full API spec ·
  [docs/postman/](docs/postman) — runnable collection
- This README, [CLAUDE.md](CLAUDE.md), [k8s/README.md](k8s/README.md) —
  architecture, run instructions, demo credentials, the RWX-volume caveat

**Verified end-to-end** (cold start from empty volumes): signup → apply →
underwriter queue → approve → citizen history → 403 authz checks → desk
visibility of the same application under Lending.

## Architecture — four services, total

```
                 ┌──────────────────────────────┐
 browser ──────▶ │ gdb-frontend (nginx)         │ :3000
                 │  • React SPA (citizen portal)│
                 │  • /api → proxied to backend │
                 └───────────────┬──────────────┘
                 ┌───────────────▼──────────────┐
                 │ gdb-backend (self-contained) │ :8080 (nginx: desk UI + API)
                 │  ERPNext v16 + frappe/lending│──▶ MariaDB 11.8
                 │  + gdb_bank custom app       │──▶ Redis (cache /0, queue /1)
                 │  gunicorn+worker+scheduler   │
                 └──────────────────────────────┘
```

- **`backend/`** — one image, one container, everything ERPNext: on start it
  bootstraps/migrates the site (lock-guarded, replica-safe), then runs
  gunicorn + background worker + scheduler behind the image's own nginx
  (:8080), which also serves the **ERPNext desk UI**. Apps baked in:
  - **[frappe/lending](https://github.com/frappe/lending)** (v16.5.0) — loans
    live in its official **Loan Application** doctype (`ACC-LOAP-…`); the
    seeded **GDB Standard Loan** product carries the terms.
  - **`gdb_bank`** — Citizen/Loan Underwriter roles, portal REST endpoints
    (`signup`, `whoami`, `apply_loan`, `my_loans`, `loan_detail`, `all_loans`,
    `review_loan`) mapping a stable portal contract onto lending, headless
    setup-wizard completion, and lending master seeding. Auth = standard
    Frappe session cookie via `/api/method/login`.
- **`frontend/`** — React 18 + Vite + Tailwind SPA served by nginx, which
  proxies `/api` to the backend (same origin — no CORS). Underwriters see an
  extra **Review Queue** with approve/reject actions. Statuses:
  `Submitted → Approved/Rejected` (lending's Open maps to Submitted).
- **ERPNext needs MariaDB, not Postgres** — the framework's Postgres support
  does not extend to ERPNext. One MariaDB + one Redis complete the stack.

## Run locally

```bash
docker compose up -d --build
```

First boot takes several minutes — the backend creates the Frappe site,
installs ERPNext + lending + gdb_bank, completes the setup wizard, and seeds
demo users and the loan product. Watch it: `docker compose logs -f backend`.

Then open the **portal at http://localhost:3000** and the **ERPNext desk at
http://localhost:8080**. Demo logins (password = `ADMIN_PASSWORD` env, default
`admin`):

| user | role |
| --- | --- |
| `citizen@example.gy` | Citizen (portal) |
| `underwriter@gdb.gov.gy` | Loan Underwriter + Loan Manager (portal + desk) |
| `Administrator` | System Manager (desk) |

Citizens can also self-register from the portal's **Create an account** page.
Heads-up: `localhost` cookies are shared across ports — log out of the portal
before logging into the desk (or use a second browser profile).

Frontend dev loop: keep the compose stack up, then `cd frontend && npm install
&& npm run dev` → vite on :5173 proxies `/api` to the backend on :8080.

## API documentation

- **OpenAPI spec**: [docs/openapi.yaml](docs/openapi.yaml) — every portal
  endpoint with schemas; paste into https://editor.swagger.io to browse.
- **Postman collection**: [docs/postman/gdb.postman_collection.json](docs/postman/gdb.postman_collection.json)
  — import, run a Login request, Postman keeps the session cookie for the rest.

Logging is Frappe-native: `frappe.logger("gdb_bank")` writes rotating logs to
the bench's `logs/` (and container stdout); unexpected errors also appear in
the **Error Log** doctype in the ERPNext desk. No extra logging library
(loguru etc.) is needed or wanted inside a Frappe app.

## Images / CI

Push to `main` (or `development`) builds and pushes both images to Docker Hub
via `.github/workflows/ci.yml` (requires the `DOCKERHUB_TOKEN` repo secret,
same as MPS-Guyana):

| image | tag |
| --- | --- |
| `ravinadh/ksquarenis` | `gdb<run>` and `gdb-latest` (frontend) |
| `ravinadh/ksquarenis` | `gdb-backend<run>` and `gdb-backend-latest` (backend) |

Manual local push:

```bash
docker login -u ravinadh
docker build -t ravinadh/ksquarenis:gdb-latest frontend
docker build -t ravinadh/ksquarenis:gdb-backend-latest backend
docker push ravinadh/ksquarenis:gdb-latest
docker push ravinadh/ksquarenis:gdb-backend-latest
```

## Kubernetes (`gdb-dev`)

Target layout: namespace `gdb-dev`, deployments `gdb-frontend` and
`gdb-backend` (2 pods each — each backend pod is self-contained: bootstrap +
gunicorn + worker + scheduler + nginx), plus MariaDB and Redis. No separate
Job/worker/scheduler/websocket deployments. Reference manifests and the
**RWX volume caveat** are in [k8s/README.md](k8s/README.md).

## Where things stand

- **[docs/developer/implementation_record.md](docs/developer/implementation_record.md)** —
  what is built, what is not, and the open decisions. Read this first.
- **[docs/developer/personas.md](docs/developer/personas.md)** — the role model
  and how to add a role.

Roles are declared once in `backend/apps/gdb_bank/gdb_bank/rbac/personas.py` and
projected onto Frappe, Keycloak and the SPA. To add one: edit that file, run
`cd backend && python scripts/export_rbac.py`, then `bench migrate`.
