# e-ID login: migrate ROPC → Authorization Code + PKCE

Status: proposed, not started. Written for an implementing agent with no
prior context on this conversation — it is self-contained. Cross-check
every file:line reference against the current tree before acting on it;
this was accurate as of 2026-09-20 but the tree moves.

## 1. Why

A security review of `gdb_bank/identity.py` (the e-ID sign-in path) found
the login mechanism itself sound — `password_login` has no way to
authenticate without a correct password — but the surrounding design has
release blockers for a production bank portal:

1. **Resource Owner Password Credentials (ROPC) grant.** The citizen types
   their password into GDB's own React form; the GDB backend then relays it
   to Keycloak (`identity.py:279-284`, `grant_type: "password"`). OAuth
   current best practice (RFC 9700) says clients should not handle
   end-user passwords directly. It also makes it structurally impossible to
   add Keycloak-side MFA/WebAuthn later without changing the flow, and it
   is *not* what the project's own target architecture describes —
   `docs/architecture/identity-and-auth.md` already assumes a browser-redirect
   broker (My Guyana) sits in front of Keycloak.
2. **Keycloak runs in dev mode.** `docker-compose.yml:123` is
   `start-dev --import-realm`; `keycloak/gdb-realm.json:5` sets
   `"sslRequired": "none"`; admin credentials default to `admin`/`admin`.
   This is a separate, parallel fix (§5) — do it alongside the flow change,
   not instead of it.

The module docstring in `identity.py` already says this ROPC path "is NOT
sufficient for open citizen self-service lending" — this document is the
follow-through on that.

## 2. Current flow (ROPC) — as it exists today

```
frontend/src/pages/Login.tsx          e-ID box + password <input>, one <form>
  → onEidSubmit(eid, eidPassword)
frontend/src/auth.tsx :58             loginWithEid(eid, password)
frontend/src/api.ts :66-67            eidLogin(eid, pwd)
  --POST /api/method/gdb_bank.identity.password_login-->
backend/apps/gdb_bank/gdb_bank/identity.py
  password_login(eid, password)                              line 152
    ├─ normalize_eid(eid) / EID_SHAPE.match                   line 159-163
    ├─ keycloak_settings(STAFF) / keycloak_settings(CITIZEN)  line 167-168
    ├─ _request_token(settings, eid, password)                line 269
    │    POST {token_url} grant_type=password, username=eid,  ← the ROPC call
    │    password=password
    ├─ _userinfo(settings, token)                              line 333
    ├─ _resolve_staff_user(eid, info)  [staff realm]           line 359
    │  or _resolve_user(eid, info)     [citizen realm]         line 401
    └─ _establish(eid, user, ...)                              line 219
         frappe.local.login_manager.login_as(user) → sets sid
```

Rate limiting today: `@rate_limit(key="eid", limit=8, seconds=60)` on
`password_login` (identity.py:150-151). Frappe's rate limiter buckets by
the **value** of the named kwarg (`eid`), not by caller IP — this caps
guessing many passwords against *one* e-ID, but does **not** cap spraying
one common password across many different e-IDs from a single source.
Keycloak's `bruteForceProtected` (gdb-realm.json) is also per-username for
the same reason. Not this document's job to fix, but don't let the new
flow accidentally lose even this partial protection — see §6.

## 3. Target flow (Authorization Code + PKCE, backend-driven / BFF)

Keep the existing invariant intact: **the backend mints `sid`; nothing
downstream of `whoami` knows or cares how the session was created**
(CLAUDE.md, identity-and-auth.md). Only *how the token is obtained*
changes — the browser talks to Keycloak's own hosted login page instead of
typing the password into GDB's form.

```
frontend/src/pages/Login.tsx          e-ID box ONLY. No password <input>.
                                       "Sign in with e-ID" is a navigation,
                                       not a form submit.
  → window.location.assign(
      `/api/method/gdb_bank.identity.login_redirect?eid=${eid}`)

backend/apps/gdb_bank/gdb_bank/identity.py
  login_redirect(eid)  [NEW, allow_guest=True]
    ├─ normalize_eid(eid) / EID_SHAPE.match   (reuse, unchanged)
    ├─ generate code_verifier + code_challenge (S256), state, nonce
    ├─ stash {verifier, eid, staff_attempted:false} server-side, keyed by
    │  `state` (Redis/frappe.cache, short TTL — e.g. 5 min; see §4 for why
    │  not a signed cookie)
    └─ 302 → {keycloak_authorize_url}
              ?response_type=code&client_id=...&redirect_uri={callback}
              &code_challenge=...&code_challenge_method=S256
              &state=...&login_hint={eid}&scope=openid profile email

  [browser now talks directly to Keycloak — this is the actual fix]

  ⇢ Keycloak authenticates, 302s to the registered redirect_uri:
    login_callback(code, state)  [NEW, allow_guest=True]
      ├─ look up stashed {verifier, eid} by state; reject/expire if missing
      ├─ POST {token_url} grant_type=authorization_code, code=..,
      │        code_verifier=.., redirect_uri=.., client_secret=.. 
      │        (The backend acts as a Confidential Client for maximum security)
      ├─ _userinfo(settings, token)                    UNCHANGED (line 333)
      ├─ _resolve_staff_user / _resolve_user            UNCHANGED (359/401)
      └─ _establish(eid, user, ...)                     UNCHANGED (line 219)
      → 302 to the SPA's post-login route (sid cookie already set by
        _establish, so this is a plain redirect, not a JSON response —
        the frontend never sees code or token)
```

The **staff-realm-first** logic (identity.py:172-216, "STAFF FIRST" comment)
has no direct equivalent in a single authorize redirect — you can only
redirect to one realm's `/auth` endpoint per attempt. Two realistic options,
in order of preference; **confirm with the user before picking one**:

- **(a)** Two buttons/links on the login page ("Sign in with e-ID" for
  citizens vs a staff-only URL/subdomain that redirects to the staff
  realm), matching the "separate realms → separate SSO sessions" design
  already sketched in identity-and-auth.md §7. This is the cleaner match
  for the target architecture (`apply.gdb.gov.gy` vs `staff.gdb.gov.gy`).
- **(b)** Keep a single button, redirect to the citizen realm by default,
  and rely on Keycloak identity brokering (citizen realm brokers the staff
  realm as an IdP) instead of the backend trying both. Bigger Keycloak
  config change, not just an app change.

Do not silently collapse this to "try citizen realm only" — that would
regress staff login without anyone deciding to.

## 4. Why server-side state storage, not a cookie, for the PKCE verifier

The `code_verifier` must survive the round trip to Keycloak and back. Two
options:
- Server-side (Redis via `frappe.cache()`, keyed by `state`, TTL ~5 min):
  preferred — nothing sensitive rides in the browser between redirects,
  and it composes with the existing "staff realm down must not affect
  citizen realm" resilience pattern already in `_request_token`
  (`_Unreachable`, identity.py:260-266) if you want to add a timeout guard
  around the callback's token exchange too.
- Signed, `HttpOnly`, `SameSite=Lax`, short-TTL cookie holding
  `{state, verifier}`: works without Redis but ties the flow to one
  browser session across the redirect, which is normally fine but is one
  more thing to get right (cookie scope, `Secure` flag once TLS is real
  per §5).

Pick one and document the choice in the code — the module docstring style
already used in `identity.py` (explaining *why*, not just *what*) should be
followed here.

## 5. Separate but parallel fix: Keycloak production hardening

Independent of the flow change, needed before any production deploy
(verified against Keycloak's own docs):

| File | Current | Change to |
|---|---|---|
| `docker-compose.yml:123` | `command: ['start-dev', '--import-realm']` | `start --optimized --hostname=<real-hostname>` behind TLS |
| `docker-compose.yml:125-126` | `KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD` default to `admin`/`admin` | real secret, no compose default |
| `keycloak/gdb-realm.json:5` | `"sslRequired": "none"` | `"EXTERNAL"` minimum (HTTPS for any non-local caller), `"ALL"` if the backend↔Keycloak hop is also to be forced over TLS |
| `keycloak/gdb-realm.json` client config | `directAccessGrantsEnabled: true` | `false` — turns off ROPC at the IdP itself, so nothing (not even a stray script) can use the old grant once the app stops calling it |
| `keycloak/gdb-realm.json` client config | no PKCE requirement | add `"pkce.code.challenge.method": "S256"` (required, not optional) |
| `keycloak/gdb-realm.json` client `redirectUris` | only `http://localhost:3000/*`, `http://localhost:5173/*` | add the backend's `login_callback` URL (this is the redirect target now, not the SPA origin) |
| seeded e-ID passwords (`ChangeMe@123`) | fine for local dev | must not exist in any shared/staging/prod realm |

## 6. Files touched vs untouched (verified with SocratiCode's dependency graph, not assumed)

**Change:**
- `frontend/src/pages/Login.tsx` — remove `eidPassword` state and the
  password `<input>` in the e-ID form; submit becomes a redirect.
- `frontend/src/auth.tsx` — `loginWithEid(eid, password)` →
  `loginWithEid(eid)`, which navigates instead of awaiting a fetch.
- `frontend/src/api.ts` — `eidLogin` (lines 66-67) no longer posts a
  password; becomes a URL builder or is deleted if `Login.tsx` navigates
  directly.
- `backend/apps/gdb_bank/gdb_bank/identity.py` — remove the ROPC call
  inside `_request_token` (or repurpose it into the new authorization-code
  token exchange); add `login_redirect` and `login_callback`; decide the
  staff-realm question in §3.
- `keycloak/gdb-realm.json` — per §5 table, plus PKCE + redirect URI.
- `docs/openapi.yaml` **and** `frontend/public/openapi.yaml` — both copies;
  CLAUDE.md already notes these two must agree. Replace the
  `password_login` request/response docs with `login_redirect` /
  `login_callback`.
- `docs/postman/gdb.postman_collection.json` — the e-ID login requests
  there currently post `eid`+`password` directly; a redirect-based flow
  isn't really Postman-testable the same way — replace with a note, or a
  request against `login_redirect` that just documents the 302.

**Do not need to change** (confirmed via `codebase_impact`/`codebase_symbol`
on the shared helpers — nothing else references identity internals):
- `_userinfo`, `_resolve_user`, `_resolve_staff_user`, `_establish`,
  `normalize_eid`, `EID_SHAPE` — reused as-is by the new callback handler.
- `profiles.record_identity_claims`, `api.link_pending_invitations` — both
  called from inside `_establish`, which is unchanged.
- Every other whitelisted method in `gdb_bank/api.py` (`whoami`,
  `review_loan`, disbursement, cluster endpoints, etc.) — they only trust
  the `sid` cookie, minted identically before and after this change.
- `frontend/src/eid.ts`, `frontend/src/components/EidBoxes.tsx` — keep
  using these to collect the e-ID up front (to pass as `login_hint`); no
  forced removal.

## 7. Rollout / acceptance checklist for whoever implements this

- [ ] Decide the staff-realm approach (§3) with the user before coding —
      don't default to dropping staff e-ID login silently.
- [ ] Decide verifier storage (§4) and document the choice inline.
- [ ] `directAccessGrantsEnabled: false` only goes in *after* the new flow
      is confirmed working end-to-end — flipping it first breaks the old
      path with nothing yet to replace it.
- [ ] Confirm the 401/417/429 error semantics citizens currently see
      (`docs/openapi.yaml` lines ~91-144: same message for unknown e-ID vs
      wrong password; 429 at 8 attempts/min) are preserved or intentionally
      changed — Keycloak's own hosted login page will show its own error
      copy, which may already satisfy the non-enumeration goal, but check.
- [ ] `npm run typecheck && npm run build` in `frontend/`, per the
      project's own "after every task" gate in CLAUDE.md.
- [ ] `docker compose up -d --build backend`, confirm `Site … ready`, then
      exercise the full redirect round trip manually (Keycloak dev-mode
      login page → callback → `whoami`) before calling this done.
- [ ] Re-run the horizontal-spray / rate-limit question (§2) against the
      new flow — Keycloak's `bruteForceProtected` still applies once the
      browser is talking to Keycloak directly, which is arguably a net
      improvement, but confirm it wasn't accidentally weakened.
