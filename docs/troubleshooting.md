# Troubleshooting the local stack

Recovery procedures for a stack that will not come up. Each entry is a real
incident: the symptom as it actually presents, the cause, and the fix that
worked.

Smaller traps that cost an afternoon but do **not** stop the stack live in
[testing.md §8](testing.md#8-gotchas-that-waste-an-afternoon).

## 1. Backend crash-loops on an app that does not exist

Verified against the running stack on 2026-09-15.

### Symptom

```bash
docker compose ps
# backend    Restarting (1) 23 seconds ago
# frontend   Up 2 minutes    0.0.0.0:3000->80/tcp
# mariadb    Up 2 minutes (healthy)
```

The portal looks *half* alive, which is what makes this confusing. nginx on
:3000 is its own container and serves the SPA perfectly — the login page
renders, the form works. Every request it then makes fails:

| Request | Result |
| --- | --- |
| `GET localhost:3000/login` | `200` — SPA loads |
| `POST localhost:3000/api/method/login` | `502 Bad Gateway` from nginx |
| `GET localhost:8080/api/method/ping` | connection refused — nothing listening |

So the first instinct is to blame credentials or the login code. Neither is
involved. Check `docker compose ps` before anything else.

### Cause

```
ModuleNotFoundError: No module named 'api_explorer'
```

`bench migrate` walks the site's installed-app list and imports each app's
`hooks.py` (`frappe/migrate.py` → `get_hooks("before_migrate", app_name=app)`
→ `importlib.import_module("api_explorer.hooks")`). The site claimed an app
the image does not carry, so migrate raised, `start-backend.sh` treats a failed
migrate as fatal, the container exited 1, and `restart: unless-stopped` began
the loop.

Nothing in the repo ever asked for that app:

```bash
grep -rni "api_explorer" . --exclude-dir=node_modules --exclude-dir=.git   # nothing
git log --all -S"api_explorer"                                             # nothing
```

It had been installed **by hand** into the running site at some point. This is
the shape of the bug worth remembering: the `sites` and `mariadb` volumes
outlive `docker compose down`, so an app installed into a live site persists in
both while the image is rebuilt without it. The site and the image drift apart
and only migrate notices.

### The part that matters: it is recorded in two places

| Where | What it said | Authoritative in v16? |
| --- | --- | --- |
| `sites/apps.txt` | `erpnext frappe gdb_bank lending` | No — bench-level list of what is on disk. Was already correct, which is why it misleads. |
| `sites/gdb.localhost/site_config.json` → `installed_apps` | included `api_explorer` | No — legacy, but Frappe keeps it in step. |
| DB table `tabInstalled Application` | row `api_explorer / 0.0.1` | **Yes.** This is the list v16 actually reads. |

Editing `site_config.json` alone and restarting reproduces the identical
traceback — confirmed by doing exactly that. Fix both, or use the command
below, which fixes both for you.

### Fix

Use Frappe's own command rather than a SQL `DELETE` — it updates the DB table
and `site_config.json` together and leaves the table consistent:

```bash
docker compose run --rm --no-deps --entrypoint bench backend \
  --site gdb.localhost remove-from-installed-apps api_explorer

docker compose up -d backend
```

`run --rm --no-deps` is not incidental: the `backend` *service* container is
crash-looping, so `docker compose exec backend …` has nothing to attach to. A
one-off container off the same image, with deps skipped because mariadb and
redis are already up, is the way in.

The command prints nothing on success. Verify against the DB:

```bash
docker compose exec -T mariadb mariadb -uroot -padmin \
  -e "SELECT app_name FROM \`_9cf592596414d344\`.\`tabInstalled Application\`;"
# want exactly: frappe, erpnext, lending, gdb_bank
```

The site's database name (`_9cf592596414d344` here) is per-site and is read
from `sites/gdb.localhost/site_config.json` → `db_name`. It differs on a site
created from scratch.

### Verify recovery

Boot takes ~35s before the API answers; migrate and the seeds run first.

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/api/method/ping   # 200

curl -s -c /tmp/gdb.jar -X POST localhost:3000/api/method/login \
  -H "Content-Type: application/json" \
  -d '{"usr":"citizen@example.gy","pwd":"admin"}'
# {"message":"No App","home_page":"/me","full_name":"Demo Citizen"}

curl -s -b /tmp/gdb.jar localhost:3000/api/method/gdb_bank.api.whoami
# {"user":"citizen@example.gy","eid":"592-1111-0001",
#  "roles":["Citizen","All","Guest"],"is_underwriter":false}
```

`whoami` through :3000 is the real check — it proves the nginx proxy, the
session cookie and `gdb_bank` are all working, not just that a port is open.

### Prevention

- **Install apps in `backend/Dockerfile`, never into a running site.** The
  image is the artefact; a `bench install-app` against the live site creates
  state no rebuild reproduces and no teammate gets.
- When the backend will not boot, diff the three lists above before anything
  else. Disagreement between them *is* the diagnosis.
- A stack that has drifted past repair resets with
  `docker compose down -v` (drops `sites` **and** the database — full re-seed,
  several minutes).
