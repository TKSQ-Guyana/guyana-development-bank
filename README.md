# Guyana Development Bank — Citizen Loan Portal

Citizens apply for GDB loans and track their history online; GDB underwriters
review, approve or reject every application. **ERPNext is the backend** (with a
custom Frappe app), **React is the citizen portal**.

## Architecture

```
                 ┌──────────────────────────────┐
 browser ──────▶ │ gdb-frontend (nginx)         │
                 │  • React SPA (citizen portal)│
                 │  • /api → proxied to backend │
                 └───────────────┬──────────────┘
                                 │  X-Frappe-Site-Name: gdb.localhost
                 ┌───────────────▼──────────────┐
                 │ gdb-backend (ERPNext v16)    │──▶ MariaDB 11.8
                 │  + gdb_bank custom app       │──▶ Redis (cache, queue)
                 │  /api/method/gdb_bank.api.*  │
                 └──────────────────────────────┘
```

- **`backend/`** — `gdb_bank` Frappe app layered on `frappe/erpnext:v16.34.2`:
  - **Loan Application** doctype: amount, purpose, term, income, phone; status
    `Submitted → Under Review → Approved/Rejected`.
  - Roles: **Citizen** (website user, own applications only) and
    **Loan Underwriter** (the GDB persona, sees everything).
  - REST endpoints (`POST /api/method/gdb_bank.api.<name>`): `signup`,
    `whoami`, `apply_loan`, `my_loans`, `loan_detail`, `all_loans`,
    `review_loan`. Auth = standard Frappe session cookie via
    `/api/method/login`.
- **`frontend/`** — React 18 + Vite + Tailwind SPA served by nginx, which
  proxies `/api` to the backend (same origin — no CORS). Underwriters see an
  extra **Review Queue** with approve/reject actions.
- **ERPNext needs MariaDB, not Postgres** — the framework's Postgres support
  does not extend to ERPNext. MariaDB + Redis are part of this stack.

## Run locally

```bash
docker compose up -d --build
```

First boot takes several minutes — the one-shot `create-site` service creates
the Frappe site, installs ERPNext + gdb_bank, and seeds demo users. Watch it:
`docker compose logs -f create-site`.

Then open **http://localhost:3000**. Demo logins (password = `ADMIN_PASSWORD`
env, default `admin`):

| user | role |
| --- | --- |
| `citizen@example.gy` | Citizen |
| `underwriter@gdb.gov.gy` | Loan Underwriter |
| `Administrator` | System Manager (ERPNext admin) |

Citizens can also self-register from the portal's **Create an account** page.

Frontend dev loop: keep the compose stack up, then `cd frontend && npm install
&& npm run dev` → vite on :5173 proxies `/api` to the backend on :8000.

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
`gdb-backend`, 2 pods each, plus MariaDB/Redis/worker/scheduler and a one-shot
site-creation Job. Reference manifests and the **RWX volume caveat** are in
[k8s/README.md](k8s/README.md).
