# AI Agent Context: Guyana Development Bank (GDB)

## Start Here

| Document | What it answers |
| --- | --- |
| [`implementation_record.md`](implementation_record.md) | What is built, what is not, open decisions, verification commands |
| [`personas.md`](personas.md) | The role model, the four enforcement layers, how to add a role |
| [`implementation_plan.md`](implementation_plan.md) | The five phases still to build |
| `../../CLAUDE.md` | Non-negotiable architecture and coding standards |

Authorization is registry-driven: `backend/apps/gdb_bank/gdb_bank/rbac/personas.py`
is the single source of truth for roles, and Frappe roles, DocType permissions,
row-level SQL scoping, Keycloak realm roles and the SPA's capability constants
are all derived from it. Never hand-wire a role.

## Project Overview
This repository contains the Guyana Development Bank application. The architecture is a full-stack containerized application consisting of:
- **Backend**: ERPNext / Frappe framework (Python/MariaDB/Redis)
- **Frontend**: React-based portal
- **Identity/Auth**: Keycloak (Integrated directly from the MPS-Guyana reference architecture)

## Isolated Development Environment
This project is configured to run side-by-side with other similar projects (like MPS-Guyana) on the same host machine without interference.

**Isolation Mechanisms Used:**
1. **Docker Compose Project Name**: The `.env` file specifies `COMPOSE_PROJECT_NAME=gdb_v2`. This ensures all Docker networks and volumes (e.g., `gdb_v2_mariadb-data`, `gdb_v2_keycloak-data`) are strongly isolated from other instances.
2. **Custom Port Mapping**:
   - Frontend Portal: `3001` (Default is 3000)
   - ERPNext Backend: `8081` (Default is 8080)
   - Keycloak: `8086` (Default is 8085, shifted to avoid collision with MPS-Guyana)

## Keycloak Integration Details
Keycloak was implemented by directly mirroring the configuration from the `MPS-Guyana` project to ensure absolute parity:
- The `keycloak-local/` directory contains the `realm-export.json` and bootstrap scripts.
- The `backend/scripts/kc-realm-structure.mjs` script handles dynamic seeding of users, roles, and agency groups.
- A `kc-bootstrap` container in `docker-compose.yml` runs automatically on startup to seed the `Guyana-Gov` realm if the database is fresh.
- `KC_HOSTNAME` in `docker-compose.yml` is dynamically bound to `http://localhost:${KEYCLOAK_PORT:-8085}` to guarantee that token issuers match the isolated port (8086).

## Environment Variables (.env)
When modifying this environment, always refer to the local `.env` file which overrides default values:
```env
COMPOSE_PROJECT_NAME=gdb_v2
FRONTEND_PORT=3001
BACKEND_PORT=8081
SITE_NAME=gdb2.localhost
DB_ROOT_PASSWORD=DbPassword@2024
ADMIN_PASSWORD=Admin@12345!
KEYCLOAK_PORT=8086
```

## Running the Stack
To build and run the completely isolated stack:
```bash
docker compose up -d --build
```
To view Frappe/ERPNext bootstrapping logs:
```bash
docker compose logs -f backend
```
