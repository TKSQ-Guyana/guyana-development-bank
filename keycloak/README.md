# Keycloak — e-ID sign-in for the local stack

`gdb-realm.json` is imported on every `docker compose up` (`start-dev
--import-realm`). Keycloak **only imports a realm that does not exist yet** —
editing this file and re-upping does nothing to a realm already in the volume.
To pick up a change: `docker compose rm -sf keycloak && docker volume rm
guyana-development-bank_keycloak-data`, then up again.

Admin console: <http://localhost:8086> (`admin` / `admin`).

## Seeded e-ID accounts

All of them use password **`ChangeMe@123`** (the portal's own demo users keep
`ADMIN_PASSWORD`, default `admin` — two different credential stores, two
different passwords, deliberately).

| e-ID | Email | What it proves on first sign-in |
| --- | --- | --- |
| `592-1111-0001` | `citizen@example.gy` | **Links** to the Frappe user the stack already seeds — no duplicate account |
| `592-2222-0002` | `underwriter@gdb.gov.gy` | Links to the underwriter and keeps its **Frappe** roles — Keycloak grants none |
| `592-3333-0003` | `asha.persaud@example.gy` | **Provisions** a new Website User with the `Citizen` role |
| `592-5555-0005` | `finance@gdb.gov.gy` | Links to the finance officer — the persona who releases funds, which the underwriter cannot |

## Four settings that are load-bearing

JSON takes no comments, so they are recorded here.

1. **Every user needs an `email`.** Frappe keys `User` on email and cannot mint
   a session without one; Keycloak separately refuses the password grant for an
   account it considers incomplete, answering the misleading "Account is not
   fully set up".
2. **`credentials[].temporary` must be `false`.** A temporary password sets the
   `UPDATE_PASSWORD` required action, and a required action makes the password
   grant fail — with that same misleading message. `requiredActions: []` is
   spelled out on each user for the same reason.
3. **`directAccessGrantsEnabled: true` on the client.** This is the password
   grant itself, and Keycloak leaves it **off** for new clients. Without it the
   token endpoint answers `unauthorized_client`.
4. **`loginWithEmailAllowed: false`.** The e-ID is the username and must be the
   only way in — otherwise `citizen@example.gy` would also be accepted as a
   login, and the portal would have two spellings of one identity.

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
