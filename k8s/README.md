# Reference manifests — namespace `gdb-dev`

Four moving parts, matching the compose file (adapt storage classes, secrets
and ingress to your cluster — you manage the instances):

| file | what |
| --- | --- |
| `00-namespace.yaml` | `gdb-dev` namespace + `gdb-secrets` (CHANGE the passwords) |
| `10-mariadb.yaml` | single-replica MariaDB 11.8 + PVC + service |
| `11-redis.yaml` | one Redis — cache uses DB `/0`, queue uses DB `/1` |
| `20-sites-pvc.yaml` | shared Frappe `sites/` volume — **must be RWX** (see below) |
| `40-gdb-backend.yaml` | `gdb-backend` deployment (2 replicas) + service :8080 |
| `50-gdb-frontend.yaml` | `gdb-frontend` deployment (2 replicas) + service :80 |

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-mariadb.yaml -f k8s/11-redis.yaml -f k8s/20-sites-pvc.yaml
kubectl apply -f k8s/40-gdb-backend.yaml -f k8s/50-gdb-frontend.yaml
```

There is no separate create-site Job, worker, scheduler or websocket
deployment: **each gdb-backend pod is self-contained** — on start it
bootstraps/migrates the site (a `flock` on the shared sites volume serializes
replicas; the first pod's first boot takes several minutes — the readiness
probe allows for it), then runs gunicorn + background worker + scheduler
behind the image's own nginx on :8080, which also serves the ERPNext desk UI.
Frappe's job dedup and scheduler lock make duplicate worker/scheduler
processes across 2 replicas safe.

## The one real constraint: the sites volume

Every gdb-backend pod mounts the same Frappe `sites/` directory. With
**2 replicas** the PVC must support **ReadWriteMany** (NFS, CephFS, Longhorn
RWX, EFS…). If your cluster only has RWO storage, run gdb-backend with
`replicas: 1` (the frontend can still run 2).

## Exposure

`gdb-frontend` is the citizen portal (serves the SPA, proxies `/api` to
`gdb-backend:8080` in-cluster) — expose it via your ingress. The ERPNext desk
is the backend service itself: expose `gdb-backend:8080` (or port-forward
`kubectl -n gdb-dev port-forward svc/gdb-backend 8080:8080`) and log in as
`Administrator` / the underwriter.
