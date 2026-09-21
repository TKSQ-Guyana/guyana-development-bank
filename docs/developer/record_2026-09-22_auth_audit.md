# Work record — the auth flow, verified against a running browser

**Date:** 2026-09-22
**Plan this relates to:** [`plan_signin_and_applicant.md`](plan_signin_and_applicant.md)
**Previous record:** [`record_2026-09-21_signin.md`](record_2026-09-21_signin.md)
**Status:** all findings below are fixed and re-verified live. Three items are
deliberately left open and named in §8.

Read [`implementation_record.md`](implementation_record.md) for what the build
is overall. This records one slice: two code-review defects, then an end-to-end
audit of the sign-in flow driven through Chrome DevTools against the running
stack — which found three more defects that reading the code had not.

**The lesson of this session, if you read nothing else:** every defect in §3
was invisible from the source. The code said 401; the wire said 417. The
logout was correct except for one absent parameter. The seeder was written,
correct, and called by nothing. None of that shows up in a diff review, and
none of it would have failed a test. It took driving a real browser at a real
server to see any of it.

---

## 1. The two defects this session started from

Both were raised in review of the previous slice.

### 1.1 `read_only: 1` on the decision fields was a UI lock pretending to be a control

`gdb_loan_application.json` carried `"read_only": 1` on `approved_amount` and
`decision_reason`. The field descriptions next to them already said "Enforced
in services, not here", and [`plan_signin_and_applicant.md`
§4.4](plan_signin_and_applicant.md) asks for the rule "enforced in the service,
not the form" — so the schema and its own documentation disagreed.

Why the flag was wrong, not merely redundant:

- It locks the field in the desk form for **everyone**, the Underwriter
  included — the one person the feature exists for.
- It stops nothing else. `db_set`, a patch, a data import and
  `frappe.client.set_value` all walk straight past it.

So it disabled the only legitimate author and blocked none of the paths a
control needs to block. What features.md actually states is a *value* rule —
"Approve — for the amount asked or less, never more" — which is a comparison,
not a field lock.

**Fixed.** `read_only` removed from both fields, and the invariants given a
home in `GDBLoanApplication.validate()`, which every write path runs through:

- `approved_amount > requested_amount` → `ValidationFailed`. A falsy
  `approved_amount` returns early: Currency defaults to `0`, so an undecided
  case would otherwise fail a comparison against a request of `0`.
- `status == Declined` with a blank `decision_reason` → `ValidationFailed`.
  Keyed on status rather than on who is saving, so a decline written by a patch
  or an import is caught too.

`decided_by`, `decided_on`, `doc_version`, `submitted_on`, `subject_eid`,
`facilitator_eid` and `status` **keep** `read_only`. Nobody types those — they
are stamps the server writes, which is what the flag is actually for.

`validate()` answers "is this document coherent". The decision *service*
(Phase 2) will answer "may you do this now". Two different questions; the
greyed-out input was conflating them.

### 1.2 `verify_token` failed open on a missing `azp`

```python
if claims.get("azp") and claims["azp"] != KEYCLOAK_CLIENT_ID:   # before
```

Reads as "check it when it is there", which is the shape of a control that
fails open: a token carrying no `azp` at all skipped the check entirely.

That check exists for the realm whose audience mapper has been edited away —
precisely the case where `aud` can no longer distinguish `gdb-portal` from any
other client. A token that also omitted `azp` would have been trusted on
nothing.

**Fixed.** The assertion is now unconditional:

```python
azp = claims.get("azp")
if azp != KEYCLOAK_CLIENT_ID:
```

Absent and wrong both reject. The citizen-facing message is identical for
both; the log line distinguishes them, because a missing claim means "look at
the realm" and a wrong one means "somebody presented another client's token".

---

## 2. The flow as it actually runs

Traced with Chrome DevTools against the live stack. Ports come from `.env`
(`KEYCLOAK_PORT=8086`, `FRONTEND_PORT=3001`, `BACKEND_PORT=8081`), not the
compose defaults.

| # | Event | What it proves |
|---|---|---|
| 1 | `whoami` → 403, `sign_in_config` → 200 | the two calls `AuthProvider` fires on mount |
| 2 | config returns `issuer: http://localhost:8086/realms/Guyana-Gov` | nothing Keycloak-shaped is baked into the bundle |
| 3 | redirect carries `code_challenge` + `S256` + `state`, **no secret** | public client, PKCE |
| 4 | password typed on `localhost:8086` | the portal origin never sees a credential |
| 5 | callback `state` identical to step 3 | the CSRF check in `completeSignIn` |
| 6 | `POST /token` carries `code_verifier`, no `client_secret` | the verifier is the proof |
| 7 | `POST exchange_token` sent with cookie `sid=Guest` | why `allow_guest` is load-bearing, not lax |
| 8 | `Set-Cookie: sid=…; HttpOnly; SameSite=Lax` | the handover to Frappe's permission stack |

### 2.1 The PKCE binding, arithmetically

```
verifier  (from the token POST body)   OzsS8sslGBsARSYf8OOrgcrrjpadFE2IRUkhBTsLgMo   (43 chars)
challenge (from the authorize URL)     UgK-O41Oyb2ifMSOBkhTURA3k-9FcyH_03Mn50otvC0
SHA256(verifier) → base64url           UgK-O41Oyb2ifMSOBkhTURA3k-9FcyH_03Mn50otvC0   MATCH
```

The challenge went out *before* authentication and the verifier came back
*after*. Only the browser that began the flow holds it — which is why a stolen
authorization code is useless. 43 characters is exactly `createVerifier()`:
32 random bytes, base64url.

### 2.2 The token the backend verified

```
iss                  http://localhost:8086/realms/Guyana-Gov
aud                  ['gdb-portal', 'account']      <- the audience mapper working
azp                  gdb-portal
eid                  999-1001-0001
realm_access.roles   [..., 'GDB_Citizen', 'Citizen', ...]
lifetime             300s
```

`aud` containing `gdb-portal` is `GDB_AUDIENCE_MAPPER` doing its job. Without
it this reads `['account']` and `verify_token` rejects every genuine sign-in —
the failure the generated realm structure module already warns about. The
300-second lifetime is what makes the kill-switch reasoning hold.

### 2.3 Nothing is retained

After the callback:

```json
{"sessionStorage":{}, "localStorage":{},
 "documentCookie_visibleToJS":"...no sid...", "pageContainsAccessToken":false}
```

`sessionStorage` cleared by the `finally` in `completeSignIn`; `sid` absent
from `document.cookie` because it is `HttpOnly`; the access token appears
nowhere in the DOM.

### 2.4 Adversarial probes

Five forged tokens against `exchange_token`. All five rejected, identical
message, no library internals leaked:

| Attack | Result |
|---|---|
| garbage string | rejected |
| valid token, signature bytes flipped | rejected |
| payload rewritten to `GDB_Underwriter` + `GDB_Platform_Admin`, original signature | rejected |
| `alg: none`, signature stripped | rejected |
| `azp` deleted | rejected |

The third matters most: it is a privilege-escalation attempt, and it proves
claims are *verified* rather than merely decoded. The fifth is §1.2's fix,
confirmed against a live server.

With a real citizen session cookie, every staff endpoint refused:
`all_loans`, `review_loan`, `v1_admin.users`, `v1_admin.grant`,
`v1_admin.rbac_status`. `whoami` and `my_loans` answered 200.

---

## 3. THE THREE DEFECTS THE LIVE TRACE FOUND

### 3.1 The error taxonomy's HTTP statuses never reached the client

`errors.py` declares `AuthenticationRequired.http_status = 401` and
`NotAuthorized = 403`. **Every one of those responses arrived as 417.**

`errors.throw()` sets `frappe.local.response["http_status_code"]`, which looks
like it should work and does not:

- Frappe reads the status **off the exception class** —
  `frappe/app.py:388`, `http_status_code = getattr(e, "http_status_code", 500)`
  in `handle_exception`.
- `frappe.local.response["http_status_code"]` is only consulted on the
  **success** path (`frappe/utils/response.py:150`), and a raise never reaches
  it.
- `GdbError` subclasses `frappe.ValidationError`, whose `http_status_code` is
  **417**. Verified directly: `ValidationError → 417`,
  `PermissionError → 403`, `AuthenticationError → 401`.

So the taxonomy was inert on the wire, and setting the response dict again
would have changed nothing.

**Why it was not cosmetic.** `auth.tsx` branches on
`err.status === 401 || err.status === 403` to tell "not signed in" from a real
fault. That condition could never be true, so every ordinary logged-out state
was `console.error`'d as a failure. Note the irony: the *legacy* `v0_legacy`
endpoints returned a correct 403 via Frappe's own `PermissionError`, so the
newer taxonomy was less HTTP-accurate than the code it replaced.

**Fixed.** `GdbError` now carries `http_status_code`, and
`__init_subclass__` mirrors `http_status` onto it so a new subclass cannot
forget and silently inherit 417:

```python
class GdbError(frappe.ValidationError):
	code = "GDB_ERROR"
	http_status = 400
	http_status_code = 400

	def __init_subclass__(cls, **kwargs) -> None:
		super().__init_subclass__(**kwargs)
		cls.http_status_code = cls.http_status
```

`http_status` is kept as the readable name the module is written in.

### 3.2 Logout asked a question, because `id_token_hint` was missing

Clicking "Log out" landed the citizen on Keycloak's **"Do you want to log
out?"** interstitial. Per the OIDC RP-Initiated Logout spec that page appears
precisely when the request carries no `id_token_hint`: Keycloak cannot tell
which session the request means.

`endKeycloakSession` sent only `client_id` and `post_logout_redirect_uri`,
because `redeem()` kept only `access_token` and dropped the `id_token` the same
response contained.

**Why it mattered.** A citizen who closes the tab at that interstitial instead
of clicking through **keeps their Keycloak session** — which is the exact
failure `sign_out`'s own docstring exists to prevent, on the exact shared
machine it is worried about.

**Fixed, with the token held server-side.** An id_token carries `name`,
`email` and `eid` — PII, which `CLAUDE.md` §1 bars from `localStorage`,
`sessionStorage` and `IndexedDB` outright. So the SPA cannot keep it between
sign-in and sign-out, and does not:

- `keycloak.remember_id_token(sid, id_token)` / `forget_id_token(sid)` — cache,
  keyed on the Frappe session `sid`, 12-hour TTL backstop. Read-and-delete, so
  no copy of anyone's claims outlives the session it belongs to.
- `exchange_token(access_token, id_token=None)` verifies the id_token too. It
  is not a second credential and nothing is decided from it, but there is no
  reason to store an unverified blob that will later be echoed into a redirect
  URL. A bad id_token logs a warning and does **not** fail a sign-in the access
  token already authorised — the cost is one confirmation page.
- It is stashed **after** `login_as`, because that is when `frappe.session.sid`
  becomes the session `sign_out` will look under.
- `sign_out` reads the hint **before** `logout()`, which discards that `sid`.

Verified: `sign_out` returned a 1137-char hint with `typ: ID`,
`azp: gdb-portal`, and `sid` matching that login's `session_state` exactly —
the id_token belonging to *that* Keycloak session, which is what makes the
interstitial unnecessary. `sessionStorage` and `localStorage` stayed empty.

### 3.3 CSRF: there is no token, and `SameSite=Lax` is the whole defence

A form-encoded, token-less `POST /api/method/...` carrying a valid session
cookie was **accepted** (`whoami` → 200, no CSRF rejection). Form-encoded is
what a cross-site form can actually send; JSON would trigger a preflight.

Nothing in the repo configures CSRF either way — no token in `api.ts`, no
`ignore_csrf` in any config. What stops this being a forgery is the single
attribute `SameSite=Lax` on the Frappe `sid` cookie, which withholds it from
cross-site POSTs.

That is a legitimate defence. The problem was that it was **implicit**: nothing
recorded that the attribute was load-bearing, so a future change for an iframe
embed, a cross-domain portal or a payment callback could set
`SameSite=None` and remove the only control, with no test failing.

**Documented** in `claude.md` §4 as a named control, with the warning and the
instruction that a real CSRF token must land in the same commit if it ever has
to change.

---

## 4. The nav showed two links to one screen

Symptom: the citizen sidebar listed both **"My applications"** and
**"My Applications (Legacy)"**, the second under a **BANK** heading, alongside
**Apply**.

Two independent causes.

**The duplicate.** `{ to: '/', label: 'My Applications (Legacy)' }` was the old
index entry. Before the §5.3 citizen destinations existed it was
`{ to: '/', label: 'My Applications' }` and it *was* the applications list.
When `/loans` took that job the entry was relabelled "(Legacy)" and moved under
the "Staff / Internal" comment instead of deleted. It still required
`APPLICATION_VIEW_OWN`, so every citizen saw it. And since `/` and `/dashboard`
both render `PortalHome → <Dashboard />`, it was a second link to the Dashboard
wearing the name of a list it no longer pointed at.

**The grouping.** `ApplicantLayout` decided citizen-vs-bank by testing `to`
against a hardcoded array of citizen paths. Anything absent from that literal
fell into `bankNav` — which is why `Apply`, a citizen action gated on
`application.create`, sat under a Bank heading. The component's own comment
admitted the heuristic was a guess.

That is the defect worth naming: the layout duplicated knowledge that belongs
in the registry, whose docstring promises "adding a *screen* is one entry
here". With a path list in the layout it was two edits, and the one you forgot
failed silently.

**Fixed.**

- Duplicate `/` entry deleted. The index route stays; it does not need a
  sidebar link.
- `NavEntry` gains a **required** `group: 'citizen' | 'bank'`. Required on
  purpose — TypeScript now refuses an entry that does not say where it belongs,
  so the forgotten-second-edit failure cannot recur.
- `groupedNav(identity)` returns the two blocks; `ApplicantLayout` renders what
  it is handed and decides nothing.
- `Apply` moved to the `citizen` group, where it always belonged.

Verified both personas: the citizen sees one block ending in Apply, no
"(Legacy)", and no stray BANK heading (holding no bank-group capability, that
block is empty and the heading does not render). The underwriter sees only
**BANK → Review Queue, Lending Rules** and no citizen entries — correct, since
they hold no `application.view_own`, which is features.md's "cannot review
their own application" showing up in the navigation.

---

## 5. The demo applications were never going to appear

The previous session's note was that `make_demo_applications` existed and just
needed `bench migrate`. It needed two fixes first.

**It was called by nothing.** Defined at `install.py:283`, absent from
`after_migrate`, `after_install` and `hooks.py`. `bench migrate` ran clean and
seeded nothing — and a seeder nobody invokes is indistinguishable from one that
ran and found nothing to do, which is why this went unnoticed.

**It wrote the DocType no screen reads.** It inserted `GDB Loan Application`
rows. The dashboard calls `gdb_bank.api.my_loans`, which re-exports
`v0_legacy.my_loans`, which reads lending's **`Loan Application`** filtered on
the `gdb_owner` custom field. It also set `app.gdb_owner` — a custom field that
exists only on lending's DocType, so on a `GDB Loan Application` that line was
a silent no-op, because Frappe drops unknown fields on insert rather than
complaining.

**Fixed.** Called from `after_migrate`, and writing both DocTypes:

- 3 rows in `GDB Loan Application` (Draft, Submitted, Approved)
- 2 rows in lending's `Loan Application` — Draft has no counterpart on purpose,
  since a draft has not been submitted to the Bank and there is nothing for
  `Loan Application` to represent. Hence three case files and two visible rows.
- The approved one carries `approved_amount` at 90% of the request, so the demo
  exercises §1.1's never-higher rule instead of only asserting it.

The dual write is **scaffolding, not architecture**. When §4.6's
`api/v1_applications.py` read path lands on `repositories/applications.py`,
delete the lending half and the `legacy_status` column of `DEMO_APPLICATIONS`
with it.

### 5.1 It is gated, and production leaves it off

`install.demo_data_enabled()` requires `GDB_SEED_DEMO_DATA`.
`docker-compose.yml` sets it for the local stack; a real deployment does not,
and `after_migrate` skips the seeder.

These rows are indistinguishable from real credit applications once they are in
the table — one is an **approved two-million-dollar facility against a
citizen's e-ID**. In a production database that is not test data, it is a fake
loan book: it reaches the portfolio aggregate the Board reads, any
reconciliation Finance runs, and the audit trail, with nothing marking it
synthetic.

The gate is an explicit environment variable rather than:

- `developer_mode` — unset even on this dev site, so it would have silently
  disabled the seeder here too, reproducing the original bug;
- "is the table empty" — a freshly restored production site is also empty.

Same shape as `make_demo_users`, which already declines to run without
`GDB_DEMO_PASSWORD`.

---

## 6. Everything that changed

### Backend

| File | Change |
|---|---|
| `gdb_bank/doctype/gdb_loan_application/gdb_loan_application.json` | `read_only` dropped from `approved_amount`, `decision_reason`; descriptions corrected (§1.1) |
| `gdb_bank/doctype/gdb_loan_application/gdb_loan_application.py` | `validate()` with the two decision invariants (§1.1) |
| `security/keycloak.py` | `azp` asserted unconditionally (§1.2); `remember_id_token` / `forget_id_token` (§3.2) |
| `security/errors.py` | `http_status_code` + `__init_subclass__` mirroring (§3.1) |
| `api/v1_identity.py` | `exchange_token` accepts/verifies/stashes `id_token`; `sign_out` returns `id_token_hint` (§3.2) |
| `install.py` | `make_demo_applications` wired into `after_migrate`, rewritten, env-gated; dead `gdb_owner` removed (§5) |

### Frontend

| File | Change |
|---|---|
| `shared/identity/oidc.ts` | `redeem()` returns `{accessToken, idToken}`; forwarded to `exchange_token`; `endKeycloakSession` takes `idTokenHint` (§3.2) |
| `auth.tsx` | threads `id_token_hint` from `sign_out` to `endKeycloakSession` (§3.2) |
| `widgets/navigation/nav-registry.ts` | `NavGroup`, required `group`, `groupedNav()`; `/` duplicate deleted; `Apply` → citizen (§4) |
| `widgets/layout/ApplicantLayout.tsx` | consumes `groupedNav()`; hardcoded path list removed (§4) |
| `pages/Dashboard.tsx` | `user?.first_name` → `user?.full_name`. `Identity` has no `first_name`; this was breaking `tsc` |

### Configuration

| File | Change |
|---|---|
| `claude.md` | §4 gains the `SameSite=Lax` CSRF control (§3.3) |
| `docker-compose.yml` | `GDB_SEED_DEMO_DATA: '1'` on `backend`, local only (§5.1) |

---

## 7. Verification

```
51 site-free backend tests                              OK
3 spec-compliance tests (bench)                         OK   <- includes the azp test
verify_frontend_architecture.mjs                        PASSED
tsc --noEmit                                            clean
```

Status codes re-checked on the running stack after the fix:

| Probe | Before | After |
|---|---|---|
| forged token → `exchange_token` | 417 | **401** `AUTH_REQUIRED` |
| `v1_admin.users` / `.grant` / `.rbac_status` as citizen | 417 | **403** `NOT_AUTHORIZED` |
| "Log out" | confirmation interstitial | straight to `/login` |

Also re-confirmed in the browser: both seeded applications render for the
citizen and in the underwriter queue; the sidebar is correct for both personas;
and a fresh "Sign in with e-ID" after logout demands credentials, so both
halves of the logout work.

### 7.1 The frontend script's own false failures

`verify_frontend_architecture.mjs` reported six failures when first run. Three
were real (`ApplicantLayout.tsx` and `Dashboard.tsx` missing, `nav-registry`
lacking citizen destinations — all since built). **Three were not:**
`FORBIDDEN_FILES` asserts that `pages/MyLoans.tsx`, `pages/Apply.tsx` and
`pages/Review.tsx` "should have been deleted". The plan never asks for that —
§5.2 lists four files and says nothing about removing anything, and
`nav-registry.ts` actively routes to `/apply` and `/underwriting`, so deleting
those pages would break live nav entries.

Two silent-pass holes were also found in the harness, both of the same shape —
"requirement absent" reading as "requirement met":

- `verify_frontend_architecture.mjs:45` — `if (fs.existsSync(navRegistryPath))`
  with no `else`. Delete `nav-registry.ts` and check 3 passes silently. Line 47
  also uses `&&`, so it fails only when *both* markers are missing; adding one
  masks the other.
- `test_spec_compliance.py` — the `approved_amount` loop passed green if the
  field were absent from the schema entirely. **Since fixed** with a `found`
  flag.

---

## 8. Open items

1. **`test_spec_compliance.py` can only run under bench.** It imports
   `keycloak`, which imports `frappe`. The other four test modules are
   site-free by design, so a plain `python -m unittest discover` will always
   error on this one file; the 51 were run with `-p "test_[!s]*.py"` to exclude
   it. Either split the frappe-dependent test out or document the two commands.

2. **`exchange_token` with the argument entirely absent returns 500.** Frappe
   raises `TypeError` for a missing required kwarg before the function's own
   `if not access_token` guard can run, so that guard is unreachable in the
   case it was written for. Same shape as an `apply_loan` 500 seen with wrong
   arguments. A thin argument-validation layer would catch both. Pre-existing
   and unrelated to this session's changes.

3. **`allow_tests` was switched on for this site** to run the bench suite:
   `bench --site gdb2.localhost set-config allow_tests true`. Revert if it
   should stay off.

### 8.1 A claim withdrawn

Mid-session this record's author flagged the `http://localhost:8086` in
`keycloak.py`'s `KEYCLOAK_PUBLIC_URL` docstring as a stale port, on the grounds
that `docker-compose.yml` defaults `KEYCLOAK_PORT` to 8085. **That was wrong.**
`.env` sets `KEYCLOAK_PORT=8086`, and the live issuer is
`http://localhost:8086/realms/Guyana-Gov`. The comment matches this deployment;
8085 is only the compose default. Recorded because the next person to read that
docstring will have the same doubt.

### 8.2 A dev-only artifact worth knowing

`document.cookie` on `localhost:3001` shows `KEYCLOAK_SESSION`. Cookies are not
isolated by port, so on localhost the SPA and Keycloak share one jar. Harmless
here — `sid` is `HttpOnly` — but cookie-scoping intuitions formed in dev will
not transfer to a real two-hostname deployment.
