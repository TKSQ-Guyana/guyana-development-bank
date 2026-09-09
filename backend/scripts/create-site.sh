#!/bin/bash
# One-shot site bootstrap for gdb-backend. Run inside the gdb-backend image
# (docker compose service `create-site`, or a Kubernetes Job) with the sites
# volume mounted. Idempotent: creates the site on first run, migrates after.
#
# Env: SITE_NAME, DB_HOST, DB_PORT, DB_ROOT_PASSWORD, ADMIN_PASSWORD,
#      REDIS_CACHE, REDIS_QUEUE, GDB_DEMO_PASSWORD (optional)
set -euo pipefail

SITE="${SITE_NAME:-gdb.localhost}"
cd /home/frappe/frappe-bench

bench set-config -g db_host "${DB_HOST:-mariadb}"
bench set-config -gp db_port "${DB_PORT:-3306}"
bench set-config -g redis_cache "redis://${REDIS_CACHE:-redis-cache:6379}"
bench set-config -g redis_queue "redis://${REDIS_QUEUE:-redis-queue:6379}"
bench set-config -g redis_socketio "redis://${REDIS_QUEUE:-redis-queue:6379}"
bench set-config -gp socketio_port 9000

# sites/ is a volume: regenerate apps.txt from the apps actually in the image.
ls -1 apps > sites/apps.txt

if [ ! -d "sites/$SITE" ]; then
  echo "Creating site $SITE ..."
  bench new-site "$SITE" \
    --mariadb-user-host-login-scope='%' \
    --db-root-username root \
    --db-root-password "${DB_ROOT_PASSWORD:?set DB_ROOT_PASSWORD}" \
    --admin-password "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}" \
    --install-app erpnext \
    --install-app gdb_bank \
    --set-default
  bench --site "$SITE" execute gdb_bank.install.make_demo_users
else
  echo "Site $SITE exists — migrating ..."
  bench --site "$SITE" migrate
fi

# The React portal is a separate origin proxied through nginx; the classic
# frappe CSRF token is not available to it, so disable CSRF for this API-only
# deployment (cookies are SameSite; nginx keeps /api same-origin).
bench --site "$SITE" set-config ignore_csrf 1
bench --site "$SITE" set-config mute_emails 1
# Complete the ERPNext first-boot wizard headlessly so the desk (:8080) is
# usable right away. Idempotent.
bench --site "$SITE" execute gdb_bank.install.complete_setup_wizard

echo "Site $SITE ready."
