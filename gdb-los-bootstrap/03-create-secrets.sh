#!/usr/bin/env bash
# Creates the "gdb-secrets" Secret in gdb-los with strong random values.
# Nothing is written to disk or git. Run ONCE, before the first helm install.
#
# Optional (export before running, otherwise left empty / "off"):
#   PLATFORM_ADMIN_PASSWORD  first Platform Admin's one-time password
#   DCRA_API_KEY, BANK_REGISTRY_API_KEY
#   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   (MariaDB off-cluster backups)
set -euo pipefail
NS=gdb-los
NAME=gdb-secrets

if kubectl -n "$NS" get secret "$NAME" >/dev/null 2>&1; then
  echo "Secret $NS/$NAME already exists - not overwriting (rotating DB passwords breaks a running site)."
  exit 1
fi

rnd() { openssl rand -base64 32 | tr -d '/+=' | cut -c1-32; }

kubectl -n "$NS" create secret generic "$NAME" \
  --from-literal=db-root-password="$(rnd)" \
  --from-literal=admin-password="$(rnd)" \
  --from-literal=keycloak-admin-password="$(rnd)" \
  --from-literal=keycloak-db-password="$(rnd)" \
  --from-literal=keycloak-admin-client-secret="$(rnd)" \
  --from-literal=keycloak-citizen-admin-client-secret="$(rnd)" \
  --from-literal=platform-admin-password="${PLATFORM_ADMIN_PASSWORD:-}" \
  --from-literal=dcra-api-key="${DCRA_API_KEY:-}" \
  --from-literal=bank-registry-api-key="${BANK_REGISTRY_API_KEY:-}" \
  --from-literal=s3-access-key-id="${S3_ACCESS_KEY_ID:-}" \
  --from-literal=s3-secret-access-key="${S3_SECRET_ACCESS_KEY:-}"

kubectl -n "$NS" label secret "$NAME" app.kubernetes.io/part-of=gdb-los

cat <<EOF

Created $NS/$NAME. Read a value when needed (e.g. break-glass Administrator):
  kubectl -n $NS get secret $NAME -o jsonpath='{.data.admin-password}' | base64 -d; echo

Store a copy in the bank's password vault NOW - if this Secret is lost,
the database root and Administrator passwords go with it.
EOF
