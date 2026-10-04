#!/usr/bin/env bash
# Lets the cluster pull ravinadh/gdb-* images (required for private repos,
# and avoids Docker Hub anonymous pull rate limits for public ones).
#
# Use a SEPARATE Docker Hub access token with "Read-only" permission -
# the cluster never needs to push.
#   export DOCKERHUB_PULL_TOKEN=<read-only personal access token>
#   ./06-pull-secret.sh
set -euo pipefail
NS=gdb-los
NAME=dockerhub-ravinadh
HUB_USER="${HUB_USER:-ravinadh}"
: "${DOCKERHUB_PULL_TOKEN:?export DOCKERHUB_PULL_TOKEN=<read-only Docker Hub token>}"

kubectl -n "$NS" create secret docker-registry "$NAME" \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username="$HUB_USER" \
  --docker-password="$DOCKERHUB_PULL_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" label secret "$NAME" app.kubernetes.io/part-of=gdb-los --overwrite
echo "Pull secret $NS/$NAME ready (referenced by values-prod.yaml imagePullSecrets)."
