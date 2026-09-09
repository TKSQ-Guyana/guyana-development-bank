# Reference manifests — namespace `gdb-dev`

These are **reference** manifests for the target layout (you said you'd manage
the instances — adapt storage classes, secrets and ingress to your cluster):

| file | what |
| --- | --- |
| `00-namespace.yaml` | `gdb-dev` namespace + `gdb-secrets` (CHANGE the passwords) |
| `10-mariadb.yaml` | single-replica MariaDB 11.8 + PVC + service |
| `11-redis.yaml` | `redis-cache` and `redis-queue` |
| `20-sites-pvc.yaml` | shared Frappe `sites/` volume — **must be RWX** (see below) |
| `30-create-site-job.yaml` | one-shot Job: creates the site, installs ERPNext + gdb_bank, seeds demo users |
| `40-gdb-backend.yaml` | `gdb-backend` deployment (2 replicas) + service, plus worker & scheduler |
| `50-gdb-frontend.yaml` | `gdb-frontend` deployment (2 replicas) + service |

Apply in numeric order; wait for the `create-site` Job to complete before
expecting the backend to answer.

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-mariadb.yaml -f k8s/11-redis.yaml -f k8s/20-sites-pvc.yaml
kubectl apply -f k8s/30-create-site-job.yaml
kubectl -n gdb-dev wait --for=condition=complete job/gdb-create-site --timeout=15m
kubectl apply -f k8s/40-gdb-backend.yaml -f k8s/50-gdb-frontend.yaml
```

## The one real constraint: the sites volume

Every gdb-backend pod (and the worker/scheduler/Job) mounts the same Frappe
`sites/` directory. With **2 backend replicas** the PVC must support
**ReadWriteMany** (NFS, CephFS, Longhorn RWX, EFS…). If your cluster only has
RWO storage, run gdb-backend with `replicas: 1` (the frontend can still run 2).

## Exposure

`gdb-frontend` is the only thing that needs an ingress/route; it serves the SPA
and proxies `/api` to `gdb-backend:8000` in-cluster. The ERPNext desk UI
(`/app`) is not exposed through this nginx — port-forward `gdb-backend` if an
admin needs it: `kubectl -n gdb-dev port-forward svc/gdb-backend 8000:8000`
(then http://localhost:8000 with the `Administrator` login; assets are limited
because gunicorn serves no static files — the React portal is the primary UI).
