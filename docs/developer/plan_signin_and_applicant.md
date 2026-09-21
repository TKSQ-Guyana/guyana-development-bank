# Plan — e-ID sign-in and the applicant dashboard

**Status:** proposed, awaiting review
**Written:** 2026-09-21
**Audience:** whoever implements or reviews this slice — the GDB developers and
the AI agents picking the repo up cold.

Read [`implementation_record.md`](implementation_record.md) first: it says what
Phase 1 already built. This plan covers the next slice only.

---

## 0. What this slice delivers

Two screens and the identity path that reaches them:

1. **Sign-in** — a citizen authenticates with their national e-ID and lands in
   the portal with a Frappe session.
2. **The applicant dashboard** — screenshot 1: sidebar chrome, greeting,
   programme facts, a live application tracker, facilities panel, ways to apply.

Explicitly **not** in this slice: the application wizard, documents, offers,
payments, statements, clusters, "My details". Those come after.

---

## 1. Decisions taken (2026-09-21)

Three questions were open. All three are now answered, and the rest of this
document follows from them.

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | How does e-ID sign-in authenticate? | **OIDC Authorization Code + PKCE, redirecting to Keycloak** | The credential page is Keycloak's, not React's. The three-box e-ID control therefore has to be a Keycloak login *theme* — see §3. Honours `CLAUDE.md` §4 as written. |
| 2 | Where does the loan case file live? (record §7) | **Option B — the `GDB Loan Application` DocType built here.** lending's `Loan` is created only at booking, for amortisation and GL. | The §7 open decision is now **closed**. The legacy `api.py` endpoints (`my_loans`, `apply_loan`, …) become migration debt, not the forward path. |
| 3 | How much of the applicant side now? | **Sign-in + shell + dashboard.** | "My details" and the applications list are deliberately deferred. |

Decision 2 should be written back into `implementation_record.md` §7 as
*resolved* when this plan is approved.

---

## 2. Three defects this slice must fix first

Found while reading. Each one breaks sign-in outright, so they are prerequisites
rather than cleanups.

### 2.1 `exchange_token` creates the session twice

`api/v1_identity.py` does:

```python
frappe.local.login_manager.login_as(user)
frappe.local.login_manager.post_login()
```

Frappe v16's `auth.py` defines `login_as(user, ...)` as *set `self.user`, then
call `self.post_login(...)`*. So `post_login` runs twice: `on_login` triggers
fire twice, `make_session` builds two sessions, `set_user_info` writes the
cookies twice. Our own `keycloak.on_session_creation` hook — the kill switch —
is one of the triggers that double-fires.

**Fix:** drop the second line.

### 2.2 `verify_token` rejects every token Keycloak will actually issue

```python
jwt.decode(token, ..., audience=KEYCLOAK_CLIENT_ID)
```

Keycloak does not put a public client's own id in `aud`. `aud` is populated by
the **Audience Resolve** mapper (from *client roles* the user holds) or by an
explicit **Audience** mapper (`oidc-audience-mapper`). `gdb-portal` has neither
and defines no client roles, so its access tokens carry `aud: ["account"]` and
name the client in **`azp`** instead. Every `exchange_token` call would fail
`InvalidAudienceError`, and — because `verify_token` deliberately swallows the
library message — the citizen would see "Your sign-in could not be verified."
with nothing in the log to say why.

**Fix, both halves:**

- Seeder adds an `oidc-audience-mapper` on `gdb-portal`'s dedicated scope with
  `included.client.audience: gdb-portal`, so `aud` really does contain it.
- `verify_token` additionally asserts `claims["azp"] == KEYCLOAK_CLIENT_ID`, so
  a token minted for a *different* client in the same realm is refused even if
  someone later removes the mapper.

### 2.3 The dev proxy points at a stack that isn't running

`frontend/vite.config.ts` proxies `/api` to `localhost:8080` with
`X-Frappe-Site-Name: gdb.localhost`. `.env` runs this project on
`BACKEND_PORT=8081`, `SITE_NAME=gdb2.localhost`. `npm run dev` therefore talks
to the *sibling* project's backend if it happens to be up, and to nothing if it
is not.

**Fix:** read both from Vite env (`VITE_BACKEND_URL`, `VITE_SITE_NAME`) with the
`.env` values as defaults.

---

## 3. Keycloak — the credential page

Under PKCE the citizen types their e-ID **on Keycloak's page**. If that page is
stock Keycloak asking for a "Username", the e-ID sign-in does not exist in any
sense a citizen would recognise. So the theme is part of the feature, not
decoration.

### 3.1 Custom login theme

Keycloak 26 reads a *directory* theme from `/opt/keycloak/themes/<name>` with no
JAR and no `build` step (the `build` command applies to provider JARs). New
tree:

```
keycloak-local/themes/gdb/login/
  theme.properties              parent=keycloak.v2, styles=css/gdb.css
  login.ftl                     overrides the username field with three boxes
  resources/css/gdb.css         GDB branding
  resources/js/eid-boxes.js     the three-box behaviour
  messages/messages_en.properties   "Username" -> "e-ID Number"
```

`docker-compose.yml` mounts it into the keycloak service.

The three boxes are **presentation over the real `username` input**: they write
`123-4567-8901` into the hidden field Keycloak posts. Behaviour matches the
control the sibling proved — auto-advance on a full box, backspace steps back
out of an empty one, pasting eleven digits fills all three, focus selects. Each
box carries its own `aria-label`; the group is labelled once.

**Failure mode to watch:** with JS disabled the boxes do not exist and the plain
`username` field must still work. The override degrades to the stock field
rather than hiding it.

### 3.2 Seeder changes (`keycloak-local/setup-gdb.mjs`)

| Today | Change | Why |
|---|---|---|
| `username: 'citizen@gdb.gov.gy'` | `username` is the **e-ID**; email stays as `email` | Under PKCE the user types their e-ID into Keycloak's username field. If username is an email, there is no e-ID sign-in. |
| e-ID `999-1001-001` (3-4-**3**) | `999-1001-0001` (3-4-4) | The card, the screenshots (`592-1111-0001`) and `EID_SHAPE` are all 3-4-4. The seeded values do not match their own format. |
| no audience mapper | `oidc-audience-mapper` on `gdb-portal` | §2.2. |
| realm login theme unset | `loginTheme: 'gdb'` | §3.1. |
| no post-logout URIs | `post.logout.redirect.uris` attribute | So `sign_out` can return the citizen to the portal. |

`gdb-portal` stays `publicClient: true`, `directAccessGrantsEnabled: false`.
Nothing here weakens it.

---

## 4. Backend

### 4.1 `security/eid.py`

`is_valid()` currently accepts `^[A-Z0-9]{2,6}(-[A-Z0-9]{2,6}){2}$` — that
passes `AB-CD-EF`, and the value goes on to become a row-scoping filter.

- `EID_PART_LENGTHS = (3, 4, 4)`; `_SHAPE = ^\d{3}-\d{4}-\d{4}$`.
- `normalize()` stays *lenient about input* — spaces, en/em dashes, eleven bare
  digits all canonicalise — and *strict about output*.
- `for_user` / `user_for_eid` / `bind_to_user` unchanged.

Tightening this is what makes the 3-4-3 seeded e-IDs invalid, which is why §3.2
regenerates them in the same change. Doing one without the other locks every
demo account out.

### 4.2 `api/v1_identity.py`

| Endpoint | Guest? | Purpose |
|---|---|---|
| `sign_in_config()` | yes | `{configured, issuer, client_id, authorize_url, token_url, end_session_url}`. **The SPA must not hardcode a Keycloak URL** — same rule as policy figures in `project_overview.md` §6. An unconfigured site answers `configured: false` and the login page says so rather than bouncing the citizen to a dead redirect. |
| `exchange_token()` | yes | Existing. Double-`post_login` removed (§2.1); a `session.established` audit event added. |
| `whoami()` | no | Unchanged. |
| `sign_out()` | no | Clears the Frappe session and returns Keycloak's end-session URL so the SPA can complete RP-initiated logout. Today `logout` leaves the Keycloak session alive, so "Log out" then "Sign in" silently re-authenticates with no prompt — which looks like the logout failed. |
| `registry()` | no | Unchanged. |

### 4.3 `domain/events.py`

Add `SESSION_ESTABLISHED` and `SESSION_ENDED`. Append-only vocabulary, per the
module's own rule.

### 4.4 The case file — `GDB Loan Application` (decision 2)

Fields appended to the skeleton, in the marked `section_break_detail`:

| Field | Type | Note |
|---|---|---|
| `product` | Link | The lending product the request is against. |
| `requested_amount` | Currency (GYD) | What the applicant asked for. |
| `term_months` | Int | |
| `purpose` | Small Text | The one line the dashboard card shows. |
| `approved_amount` | Currency (GYD) | Set by the Underwriter. **May be lower than requested, never higher** — features.md. Enforced in the service, not the form. |
| `decision_reason` | Small Text | Required on decline — features.md: "cannot be left blank". |
| `decided_by` / `decided_on` | Link / Datetime | |

Only what the dashboard and the eventual decision need. Sections B–H of the
wizard are a later change, as agreed ("first create the personas, we will keep
on adding the fields").

### 4.5 `domain/journey.py` — new

The tracker in the screenshots has **five** stages. The lifecycle has
**eighteen** states. The mapping lives here, server-side, and the SPA renders
what it is handed.

```
Started · Under review · Decision · Signing · Funds released
```

Why server-side: the SPA is an untrusted client, and — more practically — a
nineteenth state added to `statuses.py` must not be able to silently fall off a
`switch` in a React component. One table, one place, one test.

Also carries the plain-language line under the tracker ("GDB is reviewing your
application", "Payment is being arranged"), because that wording is policy, not
styling.

**Test:** every member of `ALL_STATUSES` maps to exactly one stage. A new status
with no mapping fails the build.

### 4.6 Reads

- `repositories/applications.py` — `frappe.get_list` only. `get_all` does
  **not** apply permissions (record §3.2), and the whole point of the row-scope
  work is that the query layer enforces it.
- `services/applications.py` — `my_applications()`, guarded
  `@require(cap.APPLICATION_VIEW_OWN)`. Returns journey stage, not raw status.
- `api/v1_applications.py` — thin controller. No `if role ==`.
- `tests/test_api_surface.py` — extend `EXPECTED` with the new dotted paths.
  A dotted path in the frontend is type-checked by nothing (record §1.7).

### 4.7 Demo data

`install.py` seeds two or three applications for the demo citizen across
different stages, so the dashboard shows a real tracker on a cold start rather
than an empty state nobody has looked at.

---

## 5. Frontend

### 5.1 PKCE, hand-rolled

`shared/identity/pkce.ts` + `shared/identity/oidc.ts`, roughly 120 lines, rather
than `oidc-client-ts`.

**Reasoning, so it can be argued with:** we discard the Keycloak token the
moment `exchange_token` returns a `sid`. Silent renew, token storage, session
monitoring and the refresh-token lifecycle — the reasons that library exists —
are all dead weight here, and its token-store abstraction is an active
invitation to put tokens in `localStorage`, which `CLAUDE.md` §1 forbids. What
we need is `code_verifier` → S256 challenge via WebCrypto, `state`, `nonce`, and
one redirect.

The verifier and state go in `sessionStorage` for the duration of the redirect
only. They are not PII and they are useless after the exchange; the callback
clears them in a `finally`.

### 5.2 Screens

| File | What |
|---|---|
| `pages/Login.tsx` | Rebranded. Primary: **Sign in with e-ID** → `beginSignIn()`. The email/password form is demoted into a collapsed "Staff and demo sign-in" disclosure — it stays because every seeded account and verification step still uses it, and retiring it is a separate decision. If `sign_in_config().configured` is false, the e-ID button is replaced by a plain explanation. |
| `pages/AuthCallback.tsx` | New. Validates `state`, exchanges the code at Keycloak's token endpoint with the verifier, posts the access token to `exchange_token`, refreshes the identity, redirects to `portal_home`. Renders an error with a retry link rather than a blank screen — a failed callback is the single most likely thing to go wrong here. |
| `widgets/layout/ApplicantLayout.tsx` | New. Sidebar rail, module-title header, gold "e-ID verified" chip, account block, log out. |
| `pages/Dashboard.tsx` | New. Screenshot 1. |

### 5.3 Navigation stays capability-driven

`nav-registry.ts` gains the citizen destinations (Dashboard, My applications,
Payments, Statements, Training *(soon)*, My details, My cluster) with icons.

The sibling's `ApplicantLayout` branches on `user.is_underwriter`,
`user.is_finance`, `user.is_disbursement`. **We do not copy that.** It is
precisely the coupling the persona registry exists to remove — a new persona
would mean editing the layout. Staff destinations come from `visibleNav()` like
everything else, grouped under a "Bank" heading.

Deferred nav entries point at routes that do not exist yet. They render
disabled with a "soon" chip, as Training already does in the screenshots, rather
than linking into a 404.

### 5.4 Theme

The screenshots use an indigo/violet brand ramp; `index.css` currently defines
`--color-gdb-green`. Adopting the screenshot palette as `--color-brand*`, and
keeping `--color-gdb-gold` **reserved for the verified-agency stamp** — the spec
gives that colour a meaning, so it should not also be decoration.

### 5.5 UI primitives

`shared/ui/`: `Card`, `Button`, `Badge`, `SegmentedControl`, `Stepper`, `icons`.
Generic only — anything that knows what a loan is belongs in `features/`.

---

## 6. Verification

Everything below should pass before this is called done.

```bash
# Registry, API surface and journey invariants — no site needed
cd backend/apps/gdb_bank && python -m unittest discover -s gdb_bank/tests -t . -v

# Generated files still in step with the registry
cd backend && python scripts/export_rbac.py --check

cd frontend && npm run typecheck && npm run build
```

New tests this slice adds:

- every `ALL_STATUSES` member maps to exactly one journey stage;
- `is_valid()` accepts the seeded demo e-IDs and rejects 3-4-3 and `AB-CD-EF`;
- the new dotted API paths resolve (`test_api_surface.py`).

Manual, on a cold `docker compose up -d --build`:

1. `/login` → **Sign in with e-ID** → Keycloak shows the **GDB-branded** page
   with three e-ID boxes.
2. `999-1001-0001` + password → back on `/auth/callback` → dashboard.
3. `whoami` returns the citizen's `eid`, capabilities and `portal_home`.
4. The header chip shows the e-ID; the dashboard tracker shows a real stage.
5. Log out → Keycloak session ends → **Sign in with e-ID** prompts for
   credentials again rather than signing straight back in.
6. Disable the Keycloak user → next request kills the Frappe session.

---

## 7. Known gaps this slice does *not* close

Stated so nobody mistakes the screen for the guarantee.

- **An e-ID is an identifier, not a secret.** This path trusts whoever
  provisioned the Keycloak account. Identity proofing belongs upstream
  (MyGuyana / the approved provider, `project_overview.md` §7). Defensible for
  provisioned accounts; **not** sufficient for open citizen self-service.
- **Consent is not captured.** `project_overview.md` §7 requires versioned
  consent before any registry, tax or credit check, with a banner and an
  eventual blocking modal on a new text version. The `GDB Consent` DocType
  exists; nothing writes it. No external check is made in this slice, so
  nothing is being done without consent yet — but the consent gate must land
  before the first verification call does.
- **Idempotency and optimistic concurrency** remain unimplemented
  (`CLAUDE.md` §3). No financial state transition ships in this slice, so
  nothing here needs them; the wizard will.
- **Declared vs government-verified** is not built. Keycloak claims are the only
  verified half available, and there is no DocType to hold them yet.
- **Logging out of the portal does not end other Frappe sessions** on the same
  browser (the desk cookie is shared on `localhost`). Pre-existing.

---

## 8. Order of work

1. §2 defects + §4.1 e-ID shape + §3.2 seeder — *sign-in cannot work until all
   three land together.*
2. §3.1 Keycloak theme.
3. §4.2–4.3 identity endpoints.
4. §5.1–5.2 PKCE and the two auth screens. **Checkpoint: sign in end to end.**
5. §4.4–4.7 case-file fields, journey map, reads, demo data.
6. §5.3–5.5 shell, theme, primitives, dashboard.
7. §6 verification; update `implementation_record.md` (§7 resolved, §5 shortened).

Steps 1–4 are independently reviewable and worth landing before 5–6 start.
