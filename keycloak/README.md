# Keycloak — all sign-in for the local stack

Keycloak authenticates everybody, through two realms:

| Realm | File | Who | Username |
| --- | --- | --- | --- |
| `gdb-citizen` | `gdb-realm.json` | citizens | the national e-ID, `123-4567-8901` |
| `gdb-staff` | `gdb-staff-realm.json` | GDB staff and the platform administrator | the work email |

Both files are imported on every `docker compose up` (`start-dev
--import-realm`). Keycloak **only imports a realm that does not exist yet** —
editing a file and re-upping does nothing to a realm already in the volume, but
a NEW realm file (as `gdb-staff` was) is picked up on the next start without
touching the other. To pick up an edit to an existing realm:
`docker compose rm -sf keycloak && docker volume rm
guyana-development-bank_keycloak-data`, then up again.

Admin console: <http://localhost:8086> (`admin` / `admin`). Neither realm sends
email: a new staff member's first password is a one-time password the portal
shows the administrator (below).

## No accounts are seeded

Both realm files carry **no users** — only the clients, and in `gdb-staff` the
service account of the `gdb-portal-admin` client. Nothing in this repository
holds a password anybody can sign in with.

**A citizen** is created in the admin console, in realm `gdb-citizen`:
username = the national e-ID (`123-4567-8901`), an email, and a password with
*Temporary* switched **off**. On first sign-in the portal links that e-ID to
the Frappe user with the same email, or provisions a new Website User with the
`Citizen` role. An e-ID whose email is a staff mailbox is **refused** — the
e-ID door never opens a staff account (`security/sign_in_policy.py`).

**The first platform administrator** is the one staff account made by hand —
see "First administrator" in the top-level `README.md`. Roles always come from
Frappe, never from Keycloak.

**Every other staff account** is created in the portal by the platform
administrator, and that creates it here too.

A staff account the platform administrator creates in the portal is created
here too, by the confidential client **`gdb-portal-admin`** (service account
with realm-management `manage-users`, `view-users`, `query-users`; dev secret
`gdb-portal-admin-dev-secret`). It is given a **temporary** one-time password
(`reset-password` with `temporary: true`, which adds the `UPDATE_PASSWORD`
required action), and the portal shows that password to the administrator
once. At the person's first sign-in the password grant answers "not fully set
up"; the portal then asks them to choose their own
(`identity.staff_set_password`), saves it with `temporary: false` — which
clears the required action — and signs them in. The one-time password is
never stored or logged on GDB's side, and the password they sign in with from
then on is one nobody at GDB has seen. **Reset password** in the portal does
the same again for a staff member who has lost theirs.

## Four settings that are load-bearing

JSON takes no comments, so they are recorded here.

1. **Every user needs an `email`.** Frappe keys `User` on email and cannot mint
   a session without one; Keycloak separately refuses the password grant for an
   account it considers incomplete, answering the misleading "Account is not
   fully set up".
2. **`credentials[].temporary` must be `false`.** A temporary password sets the
   `UPDATE_PASSWORD` required action, and a required action makes the password
   grant fail — with that same misleading message. This is why a citizen
   account made in the console needs *Temporary* switched off.
3. **`directAccessGrantsEnabled: true` on the client.** This is the password
   grant itself, and Keycloak leaves it **off** for new clients. Without it the
   token endpoint answers `unauthorized_client`.
4. **`loginWithEmailAllowed: false` in `gdb-citizen`.** The e-ID is the
   username and must be the only way in — otherwise a citizen's email would
   also be accepted as a login, and the portal would have two spellings of one
   identity. (`gdb-staff` is the opposite: the email IS the username.)

The staff realm adds one more: **a one-time password is meant to fail the
password grant**, because it carries the `UPDATE_PASSWORD` required action.
The portal reads that one answer as "choose your own password" and opens no
session until they have.

## Troubleshooting: "Could not reach the sign-in service"

The portal shows this when the backend's password-grant call to Keycloak
cannot connect — not a credentials problem, a networking one. Confirm with:

```
docker inspect guyana-development-bank-keycloak-1 --format '{{json .NetworkSettings.Networks}}'
```

If that prints `{}`, the keycloak container is attached to **no Docker
network** — it drifted off `guyana-development-bank_default` without being
removed, so `docker compose ps` still lists it as `Up` and its logs show it
serving fine, but `backend` can't resolve the `keycloak` DNS name and
`docker port` shows no published `8086` either. Compose does not reattach a
running container's network on `up` unless the container is recreated, so a
stale container silently breaks e-ID login while everything else looks
healthy. Fix: `docker compose up -d keycloak` (recreates it, does not touch
the realm data in the `keycloak-data` volume). Confirmed working again when
the network list is non-empty and this returns `200`:

```
docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}\n' \
  http://keycloak:8080/realms/gdb-citizen/.well-known/openid-configuration
```

## What this is not

This realm authenticates an e-ID **that somebody provisioned**; it does not
prove the person typing it is the person that e-ID names. An e-ID number is an
identifier, not a secret. Real proofing is the My Guyana broker described in
`docs/architecture/identity-and-auth.md`, and this realm is shaped so that the
broker can be added in front of it later without the portal changing.
