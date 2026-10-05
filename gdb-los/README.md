# gdb-los Helm chart

Deploys the GDB Loan Origination System to the NKP production cluster,
namespace `gdb-los`.

```
 Internet ─▶ Traefik (kommander-traefik, TLS by cert-manager)
              ├─ loans.<domain> ─▶ gdb-frontend (2)  ── /api ─┐
              └─ erp.<domain>   ─▶ gdb-backend-web (2-3, HPA) ◀┘   ERPNext desk + API
                                    gdb-backend-worker (2)       bench worker
                                    gdb-backend-scheduler (1)    bench schedule
                                    gdb-backend-backup (CronJob) bench backup --with-files
                                         │  shared "sites" volume
                                         ├─▶ gdb-mariadb (3: primary + 2 replicas, auto-failover)
                                         ├─▶ gdb-redis-cache (volatile) / gdb-redis-queue (AOF)
                                         └─▶ gdb-keycloak (2, internal only) ─▶ MariaDB "keycloak" DB
```

| File | Purpose |
| --- | --- |
| `values.yaml` | All settings, documented defaults |
| `values-prod.yaml` | Production overrides (hosts, storage, sizing) |
| `templates/backend/` | web / worker / scheduler / backup, sites PVC, config |
| `templates/frontend/` | React portal |
| `templates/keycloak/` | Keycloak in production mode, clustered |
| `templates/data/` | MariaDB (operator CRs), Redis cache + queue |
| `files/keycloak/` | Realm JSONs to import (you add them - see its README) |

## Resource footprint (requests)

| Component | Pods | CPU | Memory | Storage |
| --- | --- | --- | --- | --- |
| backend-web | 2-3 | 1 each | 2Gi each | sites 100Gi (shared) |
| backend-worker | 2 | 0.5 each | 1Gi each | |
| backend-scheduler | 1 | 0.1 | 256Mi | |
| frontend | 2 | 0.1 each | 128Mi each | |
| keycloak | 2 | 0.5 each | 1.5Gi each | (in MariaDB) |
| mariadb | 3 | 1.5 each | 8Gi each | 200Gi each |
| redis cache / queue | 1 + 1 | 0.25 each | 1Gi each | queue 10Gi |
| **Total** | | **~9.5-10.5 vCPU** | **~36-38 GiB** | **~710Gi** |

Fits the `gdb-los` quota (16 vCPU / 64 GiB) and survives one of the 4 workers failing.

---

## Install - first time

### 1. Cluster prerequisites (once)

```bash
export KUBECONFIG=~/.kube/gdb-prod.yaml
cd gdb-los-bootstrap
kubectl get pods -A | grep -i traefik          # confirm namespace = kommander
kubectl apply -f 01-namespace.yaml
./02-storageclass-retain.sh
./04-label-nodes.sh                            # app runs ONLY on the 4 md-0 workers
```

### 2. Images, pull secret, mariadb-operator

All images live in per-service Docker Hub repos under `ravinadh/`
(`gdb-frontend`, `gdb-backend`, `gdb-keycloak`, `gdb-redis`, `gdb-mariadb`,
`gdb-mariadb-operator`). From the repo root:

```bash
export DOCKERHUB_TOKEN=<read-write token>        # creates repos, builds, mirrors, pushes
./gdb-los-bootstrap/05-push-images.sh v1         # prints the exact operator install command

export DOCKERHUB_PULL_TOKEN=<read-only token>    # what the cluster uses to pull
./gdb-los-bootstrap/06-pull-secret.sh
```

Then run the two `helm install mariadb-operator...` commands that `05-push-images.sh`
printed: the operator runs in `gdb-los`, watches only `gdb-los`, and is pulled from
`ravinadh/gdb-mariadb-operator`. (Only its CRDs are cluster-wide - Kubernetes requires that.)

```bash
kubectl -n gdb-los rollout status deploy/mariadb-operator
kubectl api-resources | grep k8s.mariadb.com
```

### 3. Secrets

```bash
PLATFORM_ADMIN_PASSWORD='<first one-time password>' ./03-create-secrets.sh
```

**SMS codes (Twilio Verify).** Until these three keys are in `gdb-secrets`, every
sign-up and sign-in code is the fixed `123456` — do not open the portal to the
public without them. Add (or change) them at any time, then restart the web pods:

```bash
kubectl -n gdb-los patch secret gdb-secrets --type merge -p "{\"stringData\": {
  \"twilio-account-sid\": \"AC...\",
  \"twilio-auth-token\": \"...\",
  \"twilio-verify-service-sid\": \"VA...\",
  \"twilio-messaging-service-sid\": \"MG...\"}}"
kubectl -n gdb-los rollout restart deploy/gdb-backend-web
```

### 4. Keycloak realms

Follow `files/keycloak/README.md` (copy realm JSONs, replace dev secrets with placeholders).

### 5. Fill values-prod.yaml

Every `CHANGE-ME`: `siteName` / `ingress.desk.host` (same value),
`ingress.portal.host`, `ingress.clusterIssuer`, `backend.platformAdmin.email`.

### 6. Validate, then install

```bash
cd ..   # repo root containing gdb-los/
TAGS=""   # tags come from values-prod.yaml (v1); override with --set images.backend.tag=v2 ...

helm lint gdb-los -f gdb-los/values-prod.yaml $TAGS
helm template gdb gdb-los -n gdb-los -f gdb-los/values-prod.yaml $TAGS > /tmp/gdb-rendered.yaml
kubectl apply --dry-run=server -n gdb-los -f /tmp/gdb-rendered.yaml

helm upgrade --install gdb gdb-los -n gdb-los -f gdb-los/values-prod.yaml $TAGS
```

Use the release name `gdb` - resource names (`gdb-secrets`, `gdb-mariadb-primary`, ...) derive from it.

### 7. Watch the first boot

```bash
kubectl -n gdb-los get mariadb -w                 # wait for Ready
kubectl -n gdb-los get pods -w
kubectl -n gdb-los logs -f deploy/gdb-backend-web -c backend
```

Workers and the scheduler wait (by design) until the web pods have created the site.

### 8. First administrator and smoke test

As in the repo README "First administrator", using the desk URL and the
Administrator password from `gdb-secrets`; Keycloak admin console via
`kubectl -n gdb-los port-forward svc/gdb-keycloak 8086:8080`.
Then run the end-to-end flow: signup -> apply -> review queue -> approve -> history.

---

## Upgrades

Build and push the new release first (app images only):

```bash
SKIP_MIRRORS=1 ./gdb-los-bootstrap/05-push-images.sh v2
```

```bash
helm upgrade gdb gdb-los -n gdb-los -f gdb-los/values-prod.yaml \
  --set images.backend.tag=v2 --set images.frontend.tag=v2    # after 05-push-images.sh v2
helm history gdb -n gdb-los
helm rollback gdb <REVISION> -n gdb-los     # app rollback; DB migrations are NOT reversed
```

Web pods roll one at a time; the first new pod runs the migration. Take a backup first:
`kubectl -n gdb-los create job --from=cronjob/gdb-backend-backup pre-upgrade-$(date +%s)`.

## Switching the sites volume to RWX (Nutanix Files)

Interim mode (`ReadWriteOnce`) pins all backend pods to one node. Once a Files
storage class exists (e.g. `nutanix-files`):

```bash
# 1. stop everything that writes to sites
kubectl -n gdb-los scale deploy gdb-backend-web gdb-backend-worker gdb-backend-scheduler --replicas=0
kubectl -n gdb-los delete hpa gdb-backend-web
# 2. new RWX claim
kubectl -n gdb-los apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: gdb-sites-rwx, namespace: gdb-los}
spec:
  accessModes: [ReadWriteMany]
  storageClassName: nutanix-files
  resources: {requests: {storage: 100Gi}}
EOF
# 3. copy old -> new
kubectl -n gdb-los run sites-copy --restart=Never --image=busybox:1.36 \
  --overrides='{"spec":{"containers":[{"name":"c","image":"busybox:1.36","command":["sh","-c","cp -a /old/. /new/ && echo done"],"volumeMounts":[{"name":"o","mountPath":"/old"},{"name":"n","mountPath":"/new"}]}],"volumes":[{"name":"o","persistentVolumeClaim":{"claimName":"gdb-sites"}},{"name":"n","persistentVolumeClaim":{"claimName":"gdb-sites-rwx"}}]}}'
kubectl -n gdb-los logs -f sites-copy
# 4. point the chart at it
helm upgrade gdb gdb-los -n gdb-los -f gdb-los/values-prod.yaml $TAGS \
  --set backend.sites.accessMode=ReadWriteMany \
  --set backend.sites.existingClaim=gdb-sites-rwx \
  --set backend.web.autoscaling.maxReplicas=4
```

Keep the old `gdb-sites` volume until the new one is verified (its PV is `Retain`).

## Known limits - verify before go-live

- **Web role relies on `start-backend.sh` honouring `WITH_WORKER=0` / `WITH_SCHEDULER=0`**
  (process flags only, not `bench disable-scheduler`). Check after install:
  `kubectl -n gdb-los exec deploy/gdb-backend-web -c backend -- ps aux` - no `rq`/`schedule` processes.
- **Web role needs the DB root password** because the image creates the site on start.
  Moving bootstrap into a one-off Job removes it from long-running pods (next iteration).
- **Redis is one pod per role.** Kubernetes restarts it in seconds; the cache refills,
  queued jobs survive (AOF). Sentinel is a follow-up once Frappe v16's support is confirmed.
- **Socket.IO (realtime desk updates) is off**, as in docker-compose.
- **Static OTP**: the chart refuses to deploy one. Citizen sign-up needs SMS wired first.
- **No DR**: one cluster, one site. Off-cluster backups (`mariadb.backup`) are the minimum.
