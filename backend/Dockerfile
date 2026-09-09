# gdb-backend: ERPNext with the gdb_bank custom app baked in.
# The image serves the Frappe/ERPNext HTTP API via gunicorn (port 8000).
# MariaDB and Redis are EXTERNAL services; a site must be created once against
# them — see scripts/create-site.sh (baked in as /usr/local/bin/create-site).
FROM frappe/erpnext:v16.34.2

COPY --chown=frappe:frappe apps/gdb_bank /home/frappe/frappe-bench/apps/gdb_bank
COPY --chown=frappe:frappe --chmod=755 scripts/create-site.sh /usr/local/bin/create-site

USER frappe
WORKDIR /home/frappe/frappe-bench

# Editable install so the bench sees the app the normal way; apps.txt is
# regenerated at runtime by create-site (the sites/ dir is a mounted volume),
# but keep the baked copy correct for imageonly usage too.
RUN env/bin/pip install --no-cache-dir -e apps/gdb_bank \
	&& echo "gdb_bank" >> sites/apps.txt

EXPOSE 8000
