#!/usr/bin/env bash
# =============================================================================
# GDB Loan Origination System - ONE-CLICK DEPLOY to namespace gdb-los
#
#   cp deploy.env.example deploy.env      # once: set hosts, issuer, version
#   export DOCKERHUB_TOKEN=<rw token>  DOCKERHUB_PULL_TOKEN=<ro token>
#   ./deploy.sh
#
# Safe to re-run any time: every step checks what already exists and only
# does what is missing. Re-run with a new VERSION in deploy.env to upgrade.
# Run from the repo root (backend/ frontend/ keycloak/ gdb-los/ gdb-los-bootstrap/).
# =============================================================================
set -Eeuo pipefail
cd "$(dirname "$0")"

NS=gdb-los
RELEASE=gdb
CHART=./gdb-los
BOOT=./gdb-los-bootstrap
START=$(date +%s)

# ---------- output helpers ---------------------------------------------------
STEP=0; TOTAL=11
step() { STEP=$((STEP+1)); printf '\n\033[1;34m[%d/%d] %s\033[0m\n' "$STEP" "$TOTAL" "$*"; }
ok()   { printf '\033[32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ✘ %s\033[0m\n' "$*"; exit 1; }

on_error() {
  printf '\n\033[31mDeploy FAILED at step %d. Diagnostics:\033[0m\n' "$STEP"
  kubectl -n "$NS" get pods -o wide 2>/dev/null || true
  echo "--- recent events ---"
  kubectl -n "$NS" get events --sort-by=.lastTimestamp 2>/dev/null | tail -20 || true
  echo "Fix the cause and re-run ./deploy.sh - completed steps are skipped."
}
trap on_error ERR

# ---------- config -------------------------------------------------------------
[[ -f deploy.env ]] || die "deploy.env missing:  cp deploy.env.example deploy.env  and edit it"
set -a; source deploy.env; set +a
export KUBECONFIG="${KUBECONFIG/#\~/$HOME}"

for v in VERSION DESK_HOST PORTAL_HOST PLATFORM_ADMIN_EMAIL; do
  [[ -n "${!v:-}" ]] || die "$v is empty in deploy.env"
done
[[ "$DESK_HOST$PORTAL_HOST$PLATFORM_ADMIN_EMAIL" != *example* ]] || die "deploy.env still has example.* values - set the real hosts/email"
[[ "$VERSION" != *latest* ]] || die "VERSION must be a release tag like v1, not latest"

# ============================================================================
step "Pre-flight checks"
for bin in kubectl helm openssl curl python3; do command -v "$bin" >/dev/null || die "$bin not installed"; done
[[ "${BUILD_IMAGES:-true}" == "true" ]] && { command -v docker >/dev/null || die "docker not installed (or set BUILD_IMAGES=false)"; }
[[ -d backend && -d frontend && -d keycloak && -d "$CHART" && -d "$BOOT" ]] \
  || die "run from the repo root containing backend/ frontend/ keycloak/ gdb-los/ gdb-los-bootstrap/"
kubectl version >/dev/null 2>&1 || die "cannot reach the cluster with KUBECONFIG=$KUBECONFIG"
ok "cluster: $(kubectl config current-context)"
kubectl get storageclass nutanix-volume >/dev/null || die "storage class nutanix-volume not found"
kubectl get ingressclass kommander-traefik >/dev/null || die "ingress class kommander-traefik not found"
if [[ -n "${CLUSTER_ISSUER:-}" ]]; then
  kubectl get clusterissuer "$CLUSTER_ISSUER" >/dev/null 2>&1 || die "ClusterIssuer $CLUSTER_ISSUER not found (kubectl get clusterissuer)"
fi
kubectl top nodes >/dev/null 2>&1 && ok "metrics-server present (autoscaling works)" || warn "metrics-server missing - autoscalers will not scale"

# ============================================================================
step "Namespace $NS (quota, limits, network policies) + retain storage class"
kubectl apply -f "$BOOT/01-namespace.yaml" >/dev/null
bash "$BOOT/02-storageclass-retain.sh" >/dev/null
ok "namespace and storage class ready"

# ============================================================================
step "Application secrets"
if kubectl -n "$NS" get secret gdb-secrets >/dev/null 2>&1; then
  ok "gdb-secrets exists - kept (never regenerated: it holds the DB passwords)"
else
  bash "$BOOT/03-create-secrets.sh"
  ok "gdb-secrets created - back up its values to the bank vault"
fi

# ============================================================================
step "Images in Docker Hub (ravinadh/gdb-*)"
if [[ "${BUILD_IMAGES:-true}" == "true" ]]; then
  SKIP_EXISTING=1 bash "$BOOT/05-push-images.sh" "$VERSION"
else
  ok "BUILD_IMAGES=false - using existing ravinadh/gdb-*:$VERSION"
fi
[[ -f "$BOOT/.operator-version" ]] || die "$BOOT/.operator-version missing - run once with BUILD_IMAGES=true"
source "$BOOT/.operator-version"

# ============================================================================
step "Image pull secret (optional for public repos)"
PULL_SECRET=""
if [[ -n "${DOCKERHUB_PULL_TOKEN:-}" ]]; then
  bash "$BOOT/06-pull-secret.sh" >/dev/null
  PULL_SECRET=dockerhub-ravinadh; ok "dockerhub-ravinadh created/refreshed"
elif kubectl -n "$NS" get secret dockerhub-ravinadh >/dev/null 2>&1; then
  PULL_SECRET=dockerhub-ravinadh; ok "dockerhub-ravinadh exists - kept"
else
  warn "no pull secret: public images pulled anonymously (Docker Hub per-IP rate limits apply)"
fi

# ============================================================================
step "Keycloak realm files (dev secrets -> placeholders, localhost -> $PORTAL_HOST)"
python3 "$BOOT/prepare-realms.py" "$PORTAL_HOST" keycloak/gdb-realm.json keycloak/gdb-staff-realm.json \
  --out "$CHART/files/keycloak"
ok "realms prepared"

# ============================================================================
step "mariadb-operator $OP_VER (in $NS, watching $NS only)"
helm repo add mariadb-operator https://helm.mariadb.com/mariadb-operator >/dev/null 2>&1 || true
helm repo update mariadb-operator >/dev/null
helm upgrade --install mariadb-operator-crds mariadb-operator/mariadb-operator-crds \
  -n "$NS" --version "$OP_CHART_VER" >/dev/null
IMG=ravinadh/gdb-mariadb-operator
OP_PULL=()
[[ -n "$PULL_SECRET" ]] && OP_PULL=(--set "imagePullSecrets[0].name=$PULL_SECRET" \
  --set "webhook.imagePullSecrets[0].name=$PULL_SECRET" --set "certController.imagePullSecrets[0].name=$PULL_SECRET")
helm upgrade --install mariadb-operator mariadb-operator/mariadb-operator \
  -n "$NS" --version "$OP_CHART_VER" \
  --set currentNamespaceOnly=true \
  --set image.repository=$IMG --set image.tag="$OP_VER" \
  --set webhook.image.repository=$IMG --set webhook.image.tag="$OP_VER" \
  --set certController.image.repository=$IMG --set certController.image.tag="$OP_VER" \
  "${OP_PULL[@]}" \
  --wait --timeout 10m >/dev/null
ok "operator running"

# ============================================================================
step "Validate chart"
HELM_ARGS=(
  -n "$NS" -f "$CHART/values-prod.yaml"
  --set images.backend.tag="$VERSION"
  --set images.frontend.tag="$VERSION"
  --set siteName="$DESK_HOST"
  --set ingress.desk.host="$DESK_HOST"
  --set ingress.portal.host="$PORTAL_HOST"
  --set ingress.clusterIssuer="${CLUSTER_ISSUER:-}"
  --set backend.platformAdmin.email="$PLATFORM_ADMIN_EMAIL"
)
[[ -n "$PULL_SECRET" ]] && HELM_ARGS+=(--set "imagePullSecrets[0].name=$PULL_SECRET")
[[ -n "${DESK_ALLOWED_RANGES:-}" ]] && HELM_ARGS+=(--set "ingress.desk.allowedSourceRanges={${DESK_ALLOWED_RANGES}}")
helm lint "$CHART" "${HELM_ARGS[@]}" >/dev/null
helm template "$RELEASE" "$CHART" "${HELM_ARGS[@]}" | kubectl apply --dry-run=server -n "$NS" -f - >/dev/null
ok "chart renders and the cluster accepts every object"

# ============================================================================
step "Deploy release '$RELEASE' ($VERSION)"
WEB_UP="$(kubectl -n "$NS" get deploy gdb-backend-web -o jsonpath='{.status.availableReplicas}' 2>/dev/null)"
if helm -n "$NS" status "$RELEASE" >/dev/null 2>&1 && [[ "${WEB_UP:-0}" -ge 1 ]]; then
  BACKUP_JOB="pre-upgrade-$(date +%Y%m%d%H%M%S)"
  if kubectl -n "$NS" create job --from=cronjob/gdb-backend-backup "$BACKUP_JOB" >/dev/null \
     && kubectl -n "$NS" wait --for=condition=complete "job/$BACKUP_JOB" --timeout=30m >/dev/null; then
    ok "pre-upgrade backup $BACKUP_JOB done"
  else
    die "pre-upgrade backup failed - not upgrading without a backup (kubectl -n $NS logs job/$BACKUP_JOB)"
  fi
fi
helm upgrade --install "$RELEASE" "$CHART" "${HELM_ARGS[@]}" --timeout 10m >/dev/null
ok "release applied (revision $(helm -n "$NS" history "$RELEASE" --max 1 -o json | sed -n 's/.*"revision":\([0-9]*\).*/\1/p'))"

# ============================================================================
step "Waiting for everything to become ready (first install: site creation takes several minutes)"
kubectl -n "$NS" wait mariadb/gdb-mariadb --for=condition=Ready --timeout=20m >/dev/null; ok "MariaDB (3 pods, replication)"
kubectl -n "$NS" rollout status statefulset/gdb-redis-cache --timeout=5m >/dev/null;    ok "Redis cache"
kubectl -n "$NS" rollout status statefulset/gdb-redis-queue --timeout=5m >/dev/null;    ok "Redis queue"
kubectl -n "$NS" rollout status deploy/gdb-keycloak --timeout=15m >/dev/null;           ok "Keycloak"
kubectl -n "$NS" rollout status deploy/gdb-backend-web --timeout=45m >/dev/null;        ok "Backend web (site ready)"
kubectl -n "$NS" rollout status deploy/gdb-backend-worker --timeout=10m >/dev/null;     ok "Backend workers"
kubectl -n "$NS" rollout status deploy/gdb-backend-scheduler --timeout=10m >/dev/null;  ok "Scheduler"
kubectl -n "$NS" rollout status deploy/gdb-frontend --timeout=10m >/dev/null;           ok "Frontend"

# ============================================================================
step "Smoke test"
kubectl -n "$NS" port-forward svc/gdb-backend-web 18080:8080 >/dev/null 2>&1 & PF=$!
sleep 4
if curl -fsS -H "Host: $DESK_HOST" http://127.0.0.1:18080/api/method/ping | grep -q pong; then
  ok "backend answers /api/method/ping"
else
  warn "backend ping failed - check: kubectl -n $NS logs deploy/gdb-backend-web -c backend"
fi
kill $PF 2>/dev/null || true
curl -fsS -o /dev/null --max-time 10 "https://$PORTAL_HOST" 2>/dev/null \
  && ok "https://$PORTAL_HOST reachable" \
  || warn "https://$PORTAL_HOST not reachable yet (DNS / certificate may still be propagating)"

# ============================================================================
trap - ERR
MIN=$(( ($(date +%s) - START) / 60 ))
cat <<EOF

$(printf '\033[1;32m')DEPLOYED $VERSION to $NS in ${MIN} min$(printf '\033[0m')

  Citizen portal : https://$PORTAL_HOST
  ERPNext desk   : https://$DESK_HOST
  Keycloak admin : kubectl -n $NS port-forward svc/gdb-keycloak 8086:8080   ->  http://localhost:8086

  Administrator (break-glass) password:
    kubectl -n $NS get secret gdb-secrets -o jsonpath='{.data.admin-password}' | base64 -d; echo

  Status:  kubectl -n $NS get pods,hpa,pvc
  Upgrade: set VERSION=v2 in deploy.env and run ./deploy.sh again
EOF
