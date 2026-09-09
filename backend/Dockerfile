# gdb-backend: ERPNext + the official frappe/lending app + the gdb_bank
# custom app, self-contained: one container runs site bootstrap, gunicorn,
# worker, scheduler and the image's nginx (:8080 — desk UI assets + API).
# MariaDB and Redis are the only external dependencies.
FROM frappe/erpnext:v16.34.2

ARG LENDING_TAG=v16.5.0

COPY --chown=frappe:frappe apps/gdb_bank /home/frappe/frappe-bench/apps/gdb_bank
COPY --chown=frappe:frappe --chmod=755 scripts/create-site.sh /usr/local/bin/create-site
COPY --chown=frappe:frappe --chmod=755 scripts/start-backend.sh /usr/local/bin/start-backend

USER frappe
WORKDIR /home/frappe/frappe-bench

# apps.txt is regenerated at runtime by create-site (sites/ is a volume), but
# keep the baked copy correct for image-only usage too.
RUN git clone --depth 1 --branch ${LENDING_TAG} https://github.com/frappe/lending apps/lending \
	&& env/bin/pip install --no-cache-dir -e apps/lending \
	&& env/bin/pip install --no-cache-dir -e apps/gdb_bank \
	&& ls -1 apps > sites/apps.txt \
	&& bench build --app lending

EXPOSE 8080
CMD ["start-backend"]
