# Realm files go here

Copy the two realm exports from the repo, replacing the dev client secrets with
placeholders. Keycloak fills `${...}` from the pod's environment at import time,
and the chart supplies those variables from the `gdb-secrets` Secret.

```bash
cd gdb-los/files/keycloak
sed 's/gdb-citizen-admin-dev-secret/${GDB_CITIZEN_ADMIN_SECRET}/g' \
    ../../../keycloak/gdb-realm.json        > gdb-realm.json
sed 's/gdb-portal-admin-dev-secret/${GDB_PORTAL_ADMIN_SECRET}/g' \
    ../../../keycloak/gdb-staff-realm.json  > gdb-staff-realm.json

# must print nothing:
grep -n "dev-secret" *.json
```

Also check both files for anything else dev-only (redirect URIs to
`localhost`, test users, weak password policies) before the first install.
A realm is imported only if it does not exist yet; later changes are made in
the Keycloak admin console (or by deleting the realm and restarting).
