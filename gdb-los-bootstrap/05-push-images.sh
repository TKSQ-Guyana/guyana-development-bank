#!/usr/bin/env bash
# =============================================================================
# One Docker Hub repo per microservice under ravinadh/, then build or mirror
# and push every image the gdb-los deployment uses.
#
#   ravinadh/gdb-frontend:<VERSION>        built from ./frontend
#   ravinadh/gdb-backend:<VERSION>         built from ./backend
#   ravinadh/gdb-keycloak:26.0             mirror of quay.io/keycloak/keycloak:26.0
#   ravinadh/gdb-redis:7.2-alpine          mirror of redis:7.2-alpine
#   ravinadh/gdb-mariadb:11.8              mirror of mariadb:11.8
#   ravinadh/gdb-mariadb-operator:<ver>    mirror of the operator image (helm chart's appVersion)
#
# Usage (from the REPO ROOT, the folder with backend/ and frontend/):
#   export DOCKERHUB_TOKEN=<personal access token, Read & Write>   # hub.docker.com -> Account settings -> Personal access tokens
#   ./gdb-los-bootstrap/05-push-images.sh v1
#
# Options (env):
#   HUB_USER=ravinadh     Docker Hub namespace
#   PRIVATE=true          create repos as private (free plans allow only 1 private repo!)
#   FORCE=1               allow overwriting an existing tag (default: refuse - tags are immutable releases)
#   SKIP_EXISTING=1       if a tag already exists, keep it and skip the build (used by deploy.sh)
#   SKIP_MIRRORS=1        only build+push frontend/backend (e.g. for v2, v3 ...)
# =============================================================================
set -euo pipefail

VERSION="${1:?usage: $0 <version>   e.g. $0 v1}"
HUB_USER="${HUB_USER:-ravinadh}"
PRIVATE="${PRIVATE:-true}"
PLATFORM="linux/amd64"            # NKP workers are x86_64

[[ -d backend && -d frontend ]] || { echo "Run from the repo root (needs ./backend and ./frontend)"; exit 1; }
case "$VERSION" in *latest*) echo "Refusing tag '$VERSION' - use v1, v2 ..."; exit 1;; esac

# ---- upstream sources of the mirrored images --------------------------------
KEYCLOAK_SRC="quay.io/keycloak/keycloak:26.0"
REDIS_SRC="redis:7.2-alpine"
MARIADB_SRC="mariadb:11.8"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# ---- 1. login (docker CLI + Hub API for repo creation) ----------------------
JWT=""
if [[ -n "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "$DOCKERHUB_TOKEN" | docker login -u "$HUB_USER" --password-stdin
else
  log "No DOCKERHUB_TOKEN - using your existing docker login session (public repos)"
fi

create_repo() {   # name description
  local name="$1" desc="$2" code
  [[ -n "$JWT" ]] || return 0
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $JWT" \
    "https://hub.docker.com/v2/repositories/$HUB_USER/$name/")"
  if [[ "$code" == "200" ]]; then echo "repo $HUB_USER/$name exists"; return 0; fi
  if curl -fsS -o /dev/null -X POST -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
      -d "{\"namespace\":\"$HUB_USER\",\"name\":\"$name\",\"is_private\":$PRIVATE,\"description\":\"$desc\"}" \
      https://hub.docker.com/v2/repositories/; then
    echo "created repo $HUB_USER/$name (private=$PRIVATE)"
  else
    echo "WARN: could not create $HUB_USER/$name (private-repo limit on free plan?) - push will try anyway"
  fi
}

guard_tag() {     # image:tag -> 0 = build it, 1 = already released, skip
  [[ "${FORCE:-0}" == "1" ]] && return 0
  docker manifest inspect "$1" >/dev/null 2>&1 || return 0
  if [[ "${SKIP_EXISTING:-0}" == "1" ]]; then echo "$1 already in Docker Hub - reusing it"; return 1; fi
  echo "ERROR: $1 already exists. Releases are immutable - use a new version, or FORCE=1."; exit 1
}

build_push() {    # repo context
  local img="$HUB_USER/$1:$VERSION"
  create_repo "$1" "GDB Loan Origination System - $1"
  guard_tag "$img" || return 0
  log "Building $img from ./$2"
  docker build --platform "$PLATFORM" \
    --label org.opencontainers.image.version="$VERSION" \
    --label org.opencontainers.image.revision="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    -t "$img" "$2"
  docker push "$img"
}

mirror() {        # source target-repo target-tag
  local src="$1" dst="$HUB_USER/$2:$3"
  create_repo "$2" "GDB LOS mirror of $src"
  if docker manifest inspect "$dst" >/dev/null 2>&1 && [[ "${FORCE:-0}" != "1" ]]; then
    echo "$dst already mirrored - skipping"; return 0
  fi
  log "Mirroring $src -> $dst"
  docker pull --platform "$PLATFORM" "$src"
  docker tag "$src" "$dst"
  docker push "$dst"
}

# ---- 2. application images ---------------------------------------------------
build_push gdb-frontend frontend
build_push gdb-backend  backend

# ---- 3. third-party images (mirrored once per upstream version) ------------
OP_CHART_VER="" OP_VER=""
if [[ "${SKIP_MIRRORS:-0}" != "1" ]]; then
  mirror "$KEYCLOAK_SRC" gdb-keycloak "${KEYCLOAK_SRC##*:}"
  mirror "$REDIS_SRC"    gdb-redis    "${REDIS_SRC##*:}"
  mirror "$MARIADB_SRC"  gdb-mariadb  "${MARIADB_SRC##*:}"

  # mariadb-operator: take the exact image the chart would deploy
  helm repo add mariadb-operator https://helm.mariadb.com/mariadb-operator >/dev/null 2>&1 || true
  helm repo update mariadb-operator >/dev/null
  # Pinned after the first run (.operator-version, commit it to git) so re-runs
  # never silently upgrade the operator. Delete the file to move to a newer one.
  PIN_FILE="$(dirname "$0")/.operator-version"
  VERARG=()
  if [[ -f "$PIN_FILE" ]]; then source "$PIN_FILE"; VERARG=(--version "$OP_CHART_VER"); fi
  OP_CHART_VER="$(helm show chart mariadb-operator/mariadb-operator "${VERARG[@]}" | awk '/^version:/{print $2}' | tr -d '"')"
  OP_VER="$(helm show chart mariadb-operator/mariadb-operator "${VERARG[@]}" | awk '/^appVersion:/{print $2}' | tr -d '"')"
  OP_SRC_REPO="$(helm show values mariadb-operator/mariadb-operator "${VERARG[@]}" \
    | awk '/^image:/{f=1} f && /repository:/{print $2; exit}' | tr -d '"')"
  mirror "$OP_SRC_REPO:$OP_VER" gdb-mariadb-operator "$OP_VER"
  # remembered for deploy.sh, so the operator installs exactly what was mirrored
  printf 'OP_CHART_VER=%s\nOP_VER=%s\n' "$OP_CHART_VER" "$OP_VER" \
    > "$PIN_FILE"
fi

# ---- 4. summary ---------------------------------------------------------------
log "Done. Images in Docker Hub:"
cat <<EOF
  $HUB_USER/gdb-frontend:$VERSION
  $HUB_USER/gdb-backend:$VERSION
EOF
if [[ "${SKIP_MIRRORS:-0}" != "1" ]]; then
cat <<EOF
  $HUB_USER/gdb-keycloak:${KEYCLOAK_SRC##*:}
  $HUB_USER/gdb-redis:${REDIS_SRC##*:}
  $HUB_USER/gdb-mariadb:${MARIADB_SRC##*:}
  $HUB_USER/gdb-mariadb-operator:$OP_VER

Install the operator FROM THE MIRROR (pinned chart $OP_CHART_VER):

  helm install mariadb-operator-crds mariadb-operator/mariadb-operator-crds -n gdb-los --version $OP_CHART_VER
  helm install mariadb-operator mariadb-operator/mariadb-operator -n gdb-los --version $OP_CHART_VER \\
    --set currentNamespaceOnly=true \\
    --set image.repository=$HUB_USER/gdb-mariadb-operator --set image.tag=$OP_VER \\
    --set webhook.image.repository=$HUB_USER/gdb-mariadb-operator --set webhook.image.tag=$OP_VER \\
    --set certController.image.repository=$HUB_USER/gdb-mariadb-operator --set certController.image.tag=$OP_VER \\
    --set 'imagePullSecrets[0].name=dockerhub-ravinadh' \\
    --set 'webhook.imagePullSecrets[0].name=dockerhub-ravinadh' \\
    --set 'certController.imagePullSecrets[0].name=dockerhub-ravinadh'
EOF
fi
echo
echo "Chart values-prod.yaml uses images.backend.tag / images.frontend.tag = $VERSION"
