#!/usr/bin/env python3
"""Make Keycloak realm exports production-ready: dev secrets -> ${...} placeholders,
localhost redirect URIs / origins / logout URIs -> https://<portal-host>."""
import argparse, json, pathlib, sys

SECRETS = {
    "gdb-citizen-admin-dev-secret": "${GDB_CITIZEN_ADMIN_SECRET}",
    "gdb-portal-admin-dev-secret": "${GDB_PORTAL_ADMIN_SECRET}",
}
ap = argparse.ArgumentParser()
ap.add_argument("host"); ap.add_argument("files", nargs="+"); ap.add_argument("--out", required=True)
a = ap.parse_args()
host = a.host.strip().replace("https://", "").replace("http://", "").rstrip("/")
if not host or "localhost" in host or "example" in host:
    sys.exit(f"portal host '{a.host}' is not a real production hostname")
out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
for f in a.files:
    text = pathlib.Path(f).read_text(encoding="utf-8")
    for dev, ph in SECRETS.items():
        text = text.replace(dev, ph)
    realm = json.loads(text)
    for c in realm.get("clients", []):
        if not any("localhost" in u for u in c.get("redirectUris", []) + c.get("webOrigins", [])):
            continue
        c["redirectUris"] = [f"https://{host}/*"]
        c["webOrigins"] = [f"https://{host}"]
        attrs = c.setdefault("attributes", {})
        if "post.logout.redirect.uris" in attrs:
            attrs["post.logout.redirect.uris"] = f"https://{host}/*"
        print(f"  {pathlib.Path(f).name}: client '{c.get('clientId')}' -> https://{host}")
    result = json.dumps(realm, indent=2, ensure_ascii=False)
    for bad in ("localhost", "dev-secret"):
        if bad in result:
            sys.exit(f"{f}: still contains '{bad}' - check it by hand")
    dest = out / pathlib.Path(f).name
    dest.write_text(result + "\n", encoding="utf-8")
    print(f"  wrote {dest}")
