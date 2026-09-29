#!/bin/bash
# All-in-one gdb-backend entrypoint: bootstrap the site once (lock lives on
# the shared sites volume so replicas don't race), then run every ERPNext
# process in this one container:
#   gunicorn (HTTP :8000, loopback) + worker + scheduler [+ socketio]
#   fronted by the image's own nginx on :8080 (desk assets + API).
# Toggles: WITH_WORKER=1 WITH_SCHEDULER=1 WITH_SOCKETIO=0
set -e
cd /home/frappe/frappe-bench

(
  flock 9
  create-site
) 9> sites/.gdb-bootstrap.lock

if [ "${WITH_WORKER:-1}" = "1" ]; then
  bench worker --queue short,default,long &
fi
if [ "${WITH_SCHEDULER:-1}" = "1" ]; then
  bench schedule &
fi
if [ "${WITH_SOCKETIO:-0}" = "1" ]; then
  node apps/frappe/socketio.js &
fi

GUNICORN_THREADS=${GUNICORN_THREADS:-4}
GUNICORN_WORKERS=${GUNICORN_WORKERS:-2}
GUNICORN_TIMEOUT=${GUNICORN_TIMEOUT:-120}
/home/frappe/frappe-bench/env/bin/gunicorn \
  --chdir=/home/frappe/frappe-bench/sites \
  --bind=127.0.0.1:8000 \
  --threads="$GUNICORN_THREADS" \
  --workers="$GUNICORN_WORKERS" \
  --worker-class=gthread \
  --worker-tmp-dir=/dev/shm \
  --timeout="$GUNICORN_TIMEOUT" \
  --preload \
  frappe.app:application &

export BACKEND=${BACKEND:-127.0.0.1:8000}
export SOCKETIO=${SOCKETIO:-127.0.0.1:9000}
export FRAPPE_SITE_NAME_HEADER=${FRAPPE_SITE_NAME_HEADER:-${SITE_NAME:-gdb.localhost}}
exec nginx-entrypoint.sh
