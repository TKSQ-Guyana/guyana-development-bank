# One-click deploy - GDB Loan Origination System

Unzip into the **repo root** (next to `backend/`, `frontend/`, `keycloak/`).

## From your machine - one command

```bash
cp deploy.env.example deploy.env        # once: hosts, issuer, admin email, VERSION
export DOCKERHUB_TOKEN=<read-write token>
export DOCKERHUB_PULL_TOKEN=<read-only token>
./deploy.sh
```

## From GitHub - one button

Actions -> **Deploy GDB LOS** -> Run workflow -> version `v1` -> Run.
Setup (once): a self-hosted runner labelled `gdb-prod` inside the bank network,
plus the secrets/variables listed at the top of
`.github/workflows/deploy-gdb-los.yml`.

## What `deploy.sh` does (every step is skipped if already done)

1. Pre-flight: tools, cluster, storage class, ingress class, ClusterIssuer, metrics-server
2. Namespace `gdb-los` with quota, limits, network policies; retain storage class
3. `gdb-secrets` - generated once, never overwritten
4. Images: build/mirror/push `ravinadh/gdb-*` (existing tags reused)
5. Docker Hub pull secret
6. Keycloak realm files with dev secrets replaced
7. mariadb-operator (pinned version, mirrored image, inside `gdb-los`)
8. `helm lint` + server-side dry run
9. Pre-upgrade backup (upgrades only), then `helm upgrade --install`
10. Waits for MariaDB, Redis, Keycloak, backend, workers, scheduler, frontend
11. Smoke test + prints URLs

Upgrade = change `VERSION` in `deploy.env` (or the workflow input) and run again.
Commit `gdb-los-bootstrap/.operator-version` after the first run so the
operator version stays pinned.
