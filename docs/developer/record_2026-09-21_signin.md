# Work record — e-ID sign-in, and four bugs that had never run

**Date:** 2026-09-21
**Plan this implements:** [`plan_signin_and_applicant.md`](plan_signin_and_applicant.md)
**Status:** steps 1–4 done and verified end to end in a browser. Steps 5–6 partly done.

Read [`implementation_record.md`](implementation_record.md) for what the build
is overall. This records one slice: what changed, what it cost, and the four
defects found on the way — because every one of them was invisible from
reading the code, and three of them had been on disk since Phase 1.

---

## 1. Decisions taken

Three questions were open at the start of this slice. All are now closed.

| Question | Decision | Consequence |
|---|---|---|
| How does e-ID sign-in authenticate? | **OIDC Authorization Code + PKCE**, redirecting to Keycloak | The credential page is Keycloak's. The three-box e-ID control therefore had to become a Keycloak *login theme* — see §4. Honours `CLAUDE.md` §4 as written. |
| Where does the loan case file live? (record §7) | **Option B — the `GDB Loan Application` DocType built here** | **§7 of `implementation_record.md` is now RESOLVED.** lending's `Loan` will be created only at booking, for amortisation and GL. The legacy `api.py` endpoints become migration debt, not the forward path. |
| Scope of this slice | Sign-in + applicant shell + dashboard | "My details" and the applications list are deliberately deferred. |

Two further judgement calls, recorded so they can be argued with:

- **PKCE is hand-written (`shared/identity/pkce.ts`, ~120 lines) rather than
  `oidc-client-ts`.** We discard the Keycloak token the moment
  `exchange_token` returns a `sid`. Silent renew, token storage, refresh
  rotation and session monitoring — the reasons that library exists — are dead
  weight here, and its token-store abstraction is a standing invitation to put
  tokens in `localStorage`, which `CLAUDE.md` §1 forbids.
- **The Keycloak theme adds no `login.ftl`.** It is a stylesheet, a script and
  a message bundle layered on `keycloak.v2`. Overriding the FreeMarker template
  would mean owning a copy of PatternFly markup and re-checking it on every
  Keycloak upgrade, to change one field. The cost of this choice: with
  JavaScript off, the citizen gets the stock single field — which still signs
  them in. There is no state in which the page is broken, only one in which it
  is plainer.

---

## 2. THE FOUR BUGS — read this section if you read nothing else

All four were pre-existing except where noted. They were only reachable in
sequence: each fix exposed the next, because `provisioning.py` had **never once
run to completion** since it was written.

### 2.1 `remove_permission` does not exist in Frappe v16

`rbac/provisioning.py` imported `remove_permission` from `frappe.permissions`.
That function is not part of the module — `add_permission`,
`update_permission_property` and `setup_custom_perms` are; there is no remove.

So importing `rbac.provisioning` raised `ImportError`. Every path that reaches
it goes through `install.py`, which means **`after_migrate` had never run**.
`bench migrate` printed the traceback and carried on, exit code 0.

**What that actually meant:** the entire persona registry — seven Roles, seven
Role Profiles, every Custom DocPerm row — existed only in Python and had never
reached the database. The Phase 1 RBAC layer the whole build rests on was not
installed on any site.

**How we know:** after the fix, the migrate log read

```
Executing `after_migrate` hooks...
[gdb_bank.rbac] created Role GDB Citizen
[gdb_bank.rbac] created Role GDB Underwriter
...
```

`created`, not `present`, on a site that had existed for hours.

**Fix:** `_remove_permission()` written against Frappe's actual API — delete the
Custom DocPerm rows, then `validate_permissions_for_doctype` so Frappe rebuilds
its permission cache. Mirrors what `add_permission` does in reverse.

> The revoke half of convergence is the half that matters for security: it is
> what withdraws a permission after a capability is taken off a persona in the
> registry. Until now, a role that should have lost access would have kept it.

### 2.2 A Role Profile deadlock that crash-looped the container 33 times

Frappe's `RoleProfile.on_update` ends with

```python
self.queue_action("update_all_users",
                  now=frappe.in_test or frappe.flags.in_install, ...)
```

and `queue_action` calls `self.lock()` before enqueuing. During `after_migrate`
neither flag is set, so `now` is False: saving a Role Profile **locks it** and
hands the work to a background worker.

That worker does not exist yet. `start-backend.sh` runs `bench migrate` first
and starts gunicorn and the worker only once it *succeeds*. So:

> job never runs → lock never released → next migrate hits `check_if_locked()`
> → `DocumentLockedError` → migrate fails → entrypoint exits → container
> restarts → migrate again.

`RestartCount` reached 33. From the outside this looked like a slow migration,
because all anyone ever saw was a progress bar.

**Fix, two parts, both needed:**

- `frappe.flags.in_install = True` around the reconcile. It does **not** stop
  the lock being taken — `queue_action` locks unconditionally, before it looks
  at `now`. What it changes is that `enqueue` runs inline, and
  `frappe.model.document.execute_action` begins with `doc.unlock()`. So the
  lock is taken and released within the same call.
- Clearing the lock **before either branch** of the create/update fork.

### 2.3 …and why clearing the lock on the update branch was not enough

The first attempt at 2.2 cleared the lock only where the profile already
existed. It still looped.

`Document.get_signature()` is `sha224("<doctype>:<name>")` — the lock is a
**file** on the sites volume, keyed on the name and nothing else. When the
failed migrate rolled back, the Role Profile *row* vanished but the lock *file*
survived. The next run therefore took the `new_doc` branch, where the unlock
never ran, and the profile names are deterministic so the stale file matched
the brand-new document exactly.

The evidence was seven `.lock` files, one per persona, all stamped `11:19`:

```
/sites/gdb2.localhost/locks/
  040e01d8….lock  07df4c7d….lock  26db74c6….lock  89b1d97d….lock
  9d021933….lock  ce8202c7….lock  e9c25322….lock
```

**Fix:** `_clear_document_lock(doctype, name)`, called before either branch. It
takes the signature from an unsaved document with the name set, so Frappe's
hashing formula stays the single definition of it rather than a `sha224` copied
here to drift later. `delete_lock` is a no-op when no lock exists.

### 2.4 `set_user_permissions` is not a column on v16's `Custom DocPerm`

```
MySQLdb.OperationalError: (1054, "Unknown column 'set_user_permissions' in 'SELECT'")
```

`provisioning.py` iterated a hardcoded tuple of 15 permission flags. v16's
`Custom DocPerm` has no `set_user_permissions` field — it was dropped.

**Fix, deliberately not "delete the bad name".** The flag list is now derived
from `frappe.get_meta("Custom DocPerm")` — the intersection of what the
registry can express and what this Frappe actually has. A version that adds or
drops a flag cannot break migrate again.

With one exception: `_assert_flags_storable()` raises if a persona *grants* a
flag this Frappe cannot store. Silently skipping is right for
`set_user_permissions` (no GDB persona should hold it) and wrong in general —
the registry would claim a permission the database does not have, and the two
would disagree with nothing reporting it.

### 2.5 Guest cannot write the User it is about to become

Found in the browser, not by reading.

`exchange_token` is `allow_guest` **by necessity**: the caller has no Frappe
session yet and the verified token *is* the credential. But `sync_roles` then
saved the Frappe `User` document while `frappe.session.user` was still
`"Guest"`:

```
User Guest does not have doctype access via role permission for document User
```

Every sign-in by a new or role-changed account died there.

**Fix:** `doc.flags.ignore_permissions = True` in `sync_roles`, with the reason
stated in the docstring. The authority for that write is not the session —
which is anonymous by construction — it is the token, already verified against
Keycloak's JWKS before the function is reachable. The roles written still come
only from `frappe_roles_for()`, so it cannot grant anything a realm role does
not map to, and the change is audited.

---

## 3. Frappe and Keycloak facts verified this session

Add these to `implementation_record.md` §3's list. **Do not re-derive them.**

1. **`login_as()` already calls `post_login()`.** `exchange_token` called both,
   so every sign-in ran the whole login twice — `on_login` and
   `on_session_creation` triggers fired twice (including our own Keycloak kill
   switch), and `make_session` built a second session the first one's cookie no
   longer pointed at.
2. **`frappe.permissions` has no `remove_permission`.** See §2.1.
3. **`Custom DocPerm` has no `set_user_permissions` in v16.** See §2.4.
4. **`Document.get_signature()` is `sha224("<doctype>:<name>")`** and the lock
   is a file under `sites/<site>/locks/`. It survives a transaction rollback.
5. **`queue_action` locks unconditionally**, before it considers `now`.
   `execute_action` unlocks at its start, so an inline run self-releases.
6. **Keycloak does not put a public client's own id in `aud`.** That claim is
   filled by the Audience Resolve mapper from the *client roles* a user holds,
   and `gdb-portal` defines none. Its tokens carry `aud: ["account"]` and name
   the client only in `azp`.
7. **Keycloak 26 drops unmanaged user attributes by default.**
   `unmanagedAttributePolicy` is unset, which means DISABLED. Writing
   `attributes: {eid: [...]}` returns success and stores nothing.
8. **Keycloak stamps `iss` with its *frontend* hostname** (`KC_HOSTNAME`), not
   the URL the backend reaches it on. Validating `iss` against the internal
   docker name rejects every genuine token.
9. **Keycloak rejects `/` in a person's name**
   (`error-person-name-invalid-character`) — the `Board / CEO` persona title.
10. **A Keycloak directory theme needs no JAR and no `build`.** The `build`
    command in the docs applies to provider JARs. `start-dev` also disables
    theme caching.
11. **`keycloak.v2` sets `styles=css/styles.css`**; overriding `styles`
    REPLACES it rather than appending. `stylesCommon` is a separate key.
12. **keycloak.v2 colours `#kc-header-wrapper` white with `!important`**, so no
    selector wins without matching it.
13. **Keycloak 26's field error container is `input-error-<field>`**, not
    `input-error`.

---

## 4. What was built

### 4.1 Backend

| File | Change |
|---|---|
| `domain/eid_format.py` | **NEW.** The 3-4-4 shape, frappe-free. Lenient in (spaces, en/em dashes, eleven bare digits), strict out. Was `[A-Z0-9]{2,6}` × 3, which accepted `AB-CD-EF` and let it become a row-scoping filter. |
| `domain/journey.py` | **NEW.** Maps the 18 lifecycle states onto the 5 citizen-facing tracker steps, server-side, with the plain-language sentence for each. `assert_total()` fails the build if a status maps to no step. |
| `domain/events.py` | `SESSION_ESTABLISHED`, `SESSION_ENDED`. |
| `rbac/demo.py` | **NEW.** One demo identity per persona — the single formula `install.py` and the Keycloak seeder both derive from. Username **is** the e-ID. |
| `rbac/provisioning.py` | §2.1, §2.2, §2.3, §2.4. |
| `security/eid.py` | Delegates the shape to `domain/eid_format`; refuses to bind a malformed e-ID (it would scope the user to nothing, silently). |
| `security/keycloak.py` | `internal_realm_url()` vs `issuer()` split (§3.8); `azp` assertion; named branches for `InvalidIssuerError` and `InvalidAudienceError`; `public_config()`; §2.5. |
| `api/v1_identity.py` | Double `post_login` removed; `sign_in_config()`; `sign_out()`; `session.established` audit event. |
| `scripts/export_rbac.py` | Emits `GDB_DEMO_IDENTITIES`, `GDB_AUDIENCE_MAPPER`, `GDB_LOGIN_THEME`, post-logout URIs. Calls `demo.assert_well_formed()` before writing. |

### 4.2 Keycloak

| File | Change |
|---|---|
| `keycloak-local/themes/gdb/login/` | **NEW.** `theme.properties`, `resources/css/gdb.css`, `resources/js/eid-boxes.js`, `messages/messages_en.properties`. The three-box control, GDB branding, "e-ID Number" for "Username". |
| `keycloak-local/setup-gdb.mjs` | Declares the `eid` user-profile attribute (§2.7); audience mapper; login theme; demo accounts keyed on the e-ID; renames legacy email-username accounts in place; sanitises person names (§3.9). |
| `docker-compose.yml` | Theme mount; `KEYCLOAK_URL` vs `KEYCLOAK_PUBLIC_URL`; **dev bind-mount of `gdb_bank`** — see §6. |

### 4.3 Frontend

| File | Change |
|---|---|
| `shared/identity/pkce.ts` | **NEW.** Verifier, S256 challenge, state; `sessionStorage` for the redirect only. |
| `shared/identity/oidc.ts` | **NEW.** `beginSignIn`, `completeSignIn`, `endKeycloakSession`. No hardcoded Keycloak URL. |
| `shared/identity/eid.ts` | **NEW.** Display formatting only — the SPA never collects an e-ID under PKCE. |
| `pages/Login.tsx` | Rewritten. e-ID primary; email demoted to a "Staff and demo sign-in" disclosure. |
| `pages/AuthCallback.tsx` | **NEW.** `state` check, code exchange, error screen with a retry rather than a blank page. StrictMode double-mount guarded — an authorization code is single-use. |
| `auth.tsx` | `signIn` config, `adopt()`, logout that ends the Keycloak session too. |
| `index.css` | Brand ramp matching the Keycloak theme. `gdb-gold` reserved for the verified-agency stamp. |
| `vite.config.ts` | Proxy target read from env — it pointed at `8080`/`gdb.localhost` while `.env` runs `8081`/`gdb2.localhost`. |

### 4.4 The e-IDs changed

Demo e-IDs were `999-1001-001` — 3-4-**3**, which the card's shape rejects.
They are now `999-1001-0001` … `999-1007-0007`, and the Keycloak **username is
the e-ID** rather than the email. Any note with the old values is stale.

---

## 5. Verification

Static, all passing:

```bash
cd backend/apps/gdb_bank && python -m unittest discover -s gdb_bank/tests -t .   # 51 tests
cd backend && python scripts/export_rbac.py --check
cd frontend && npm run typecheck && npm run build
```

New tests: `test_eid.py` (shape, lenient normalisation, demo identities valid
and unique, username is the e-ID), `test_journey.py` (every status maps to
exactly one step, every step reachable, terminal agrees with `statuses.py`).

**Driven end to end in a browser** (Chrome DevTools MCP), as the citizen:

| Step | Result |
|---|---|
| `/login` → Sign in with e-ID | PKCE redirect, real S256 challenge, random state |
| Keycloak page | GDB-branded; auto-advance, backspace-back and paste all verified |
| Callback | code exchanged, session established, landed on `/` |
| `whoami` | `eid: 999-1001-0001`, `personas: [citizen]`, `row_scope: own_eid`, 22 capabilities, **no** `credit.approve` |
| Audit | `identity.session_established` + `admin.roles_changed`, the latter attributed to `identity-provider` |
| Log out | Keycloak session genuinely ended — next sign-in re-prompts |
| Wrong password | "Incorrect e-ID or password.", e-ID preserved, boxes `aria-invalid`, focus on password |

**Only the citizen persona was driven end to end.** The other six are seeded
and should authenticate, but their portal destinations are largely unbuilt.

---

## 6. The dev loop changed

`gdb_bank` is baked into the backend image, so every one-line Python change
cost a full image rebuild **and** a full `bench migrate` — minutes, repeatedly.
`docker-compose.yml` now bind-mounts the package:

```yaml
- ./backend/apps/gdb_bank/gdb_bank:/home/frappe/frappe-bench/apps/gdb_bank/gdb_bank
```

**Only the package directory, not the app root** — `pyproject.toml` and the
`.egg-info` pip wrote at build time live one level up, and shadowing those
un-installs the app from the bench virtualenv.

A backend change is now: edit, then

```bash
docker exec gdb_v2-backend-1 sh -c 'kill -HUP <gunicorn-master-pid>'
```

~6 seconds instead of ~5 minutes. Remove the mount for a production-shaped
build, where the image should be the only source of code.

---

## 7. Known gaps and open findings

- **Logout shows a Keycloak confirmation page.** RP-initiated logout without
  `id_token_hint` asks "Do you want to log out?". Skipping it means keeping the
  ID token, which carries name, email and e-ID — browser storage for that is
  what `CLAUDE.md` §1 forbids. The clean fix is holding it server-side against
  the session and returning a logout URL with the hint. **Not done; your call.**
- **An e-ID is an identifier, not a secret.** This path trusts whoever
  provisioned the Keycloak account. Proofing belongs upstream (MyGuyana,
  `project_overview.md` §7). Defensible for provisioned accounts; **not**
  sufficient for open citizen self-service lending.
- **Consent is not captured.** `project_overview.md` §7 requires versioned
  consent before any registry, tax or credit check. `GDB Consent` exists;
  nothing writes it. No external check ships in this slice, so nothing happens
  without consent yet — but the consent gate must land before the first
  verification call does.
- **`restart: unless-stopped` + an entrypoint that exits on migrate failure**
  turns any migrate error into a multi-minute loop that hides the error. It is
  what made §2.2 look like slowness. Worth a retry/backoff or a hard stop.
- **Idempotency and optimistic concurrency** remain unimplemented
  (`CLAUDE.md` §3). No financial state transition ships here; the wizard needs
  them.
- **Steps 5–6 of the plan are incomplete.** `domain/journey.py` and its tests
  exist. The case-file business fields, `repositories/applications.py`,
  `services/applications.py`, `api/v1_applications.py`, the applicant shell and
  the dashboard are **not built**.
