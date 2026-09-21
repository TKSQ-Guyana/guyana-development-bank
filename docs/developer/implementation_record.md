# Implementation Record — what exists, what doesn't, and why

**Last updated:** 2026-09-21
**Audience:** AI agents (Claude/Gemini) and developers picking this up cold.

Read this **before** `implementation_plan.md`. The plan says what to build;
this says what is already built, what was decided along the way, and what is
still undecided. Update it whenever you complete a phase.

---

## 0. TL;DR for the next session

- **Phase 1 (identity/RBAC) is substantially done.** A registry-driven persona
  system with 7 personas, 58 capabilities and 4 enforcement layers.
- **Phases 2–5 are not started.** DocTypes exist as *skeletons* (identity,
  scoping and lifecycle fields only); no business fields, no wizard, no
  underwriting/disbursement/finance/board services.
- **The single most important file is
  [`rbac/personas.py`](../../backend/apps/gdb_bank/gdb_bank/rbac/personas.py).**
  Adding or changing a role is a data edit there plus `bench migrate`.
- **There is a more feature-complete sibling project** at
  `C:\Users\HemanthKumarChittipr\Downloads\guyana-development-bank` — see
  §6. It is the functional target; its architecture is what this build fixes.
- **One decision is still open** — see §7. Do not start Phase 2 services
  without resolving it.

---

## 1. What was built

### 1.1 The persona registry (the spine)

Everything authorization-related is derived from one declarative registry, so
a new role is a data change rather than a nine-file hunt.

```
              rbac/personas.py  (7 × PersonaSpec)
                        │
     ┌──────────────────┼──────────────────┐
     │                  │                  │
provisioning.py    export_rbac.py     guards.py / row_level.py
     │                  │                  │
Frappe Roles,      capabilities.       capability checks,
Role Profiles,     generated.ts,       separation-of-duties,
Custom DocPerms    gdb-realm-          permission_query_conditions,
                   structure.mjs       has_permission
```

Full explanation and the "how to add a role" runbook:
**[`docs/developer/personas.md`](personas.md)**.

| File | Lines | Purpose |
|---|---|---|
| `rbac/capabilities.py` | 116 | 58 capability constants. `ALL_CAPABILITIES` derived by reflection — no second list to update. |
| `rbac/personas.py` | 517 | **The registry.** `PersonaSpec`, `DocPerm`, `RowScope`, the 7 personas, legacy aliases, derived lookups. |
| `rbac/separation.py` | 118 | 7 `SeparationRule`s — maker/checker, declared as data, evaluated against the audit trail. |
| `rbac/scoping.py` | 69 | Per-DocType `ScopeSpec`: which columns carry the subject/facilitator e-ID. |
| `rbac/provisioning.py` | 348 | Registry → Frappe Roles, Role Profiles, Custom DocPerms. Convergent. Asserts privacy invariants. |
| `rbac/guards.py` | 216 | `@require(capability, ...)` decorator: capability check + separation check + denial telemetry. |

### 1.2 Security layer

| File | Lines | Purpose |
|---|---|---|
| `security/eid.py` | 86 | e-ID normalization/validation; mirrors the Keycloak claim onto `User.gdb_eid`. |
| `security/session.py` | 89 | `Actor` — the resolved caller (user, e-ID, personas, capabilities, row scope). |
| `security/row_level.py` | 196 | `permission_query_conditions` + `has_permission` hooks, generated from `scoping.SCOPES`. |
| `security/keycloak.py` | 409 | JWKS token verification, claims → personas, user provisioning, role sync, kill switch. |
| `security/errors.py` | 87 | Error taxonomy → `{code, message, details}` + HTTP status. No stack traces to the client. |

### 1.3 Domain, services, API

| File | Lines | Purpose |
|---|---|---|
| `domain/events.py` | 66 | Audit event type constants. Append-only vocabulary. |
| `domain/statuses.py` | 126 | 18-state lifecycle + `TRANSITIONS` table (source, target, required capability). |
| `services/audit.py` | 107 | Business audit writer. **Substrate for separation of duties.** |
| `services/admin.py` | 204 | Persona grant/revoke, kill switch, capability preview. Mandatory reasons, all audited. |
| `repositories/audit.py` | 76 | Audit trail reads (kept out of `services/` to avoid a guards↔services cycle). |
| `api/v1_identity.py` | 122 | `exchange_token` (PKCE → Frappe session), `whoami`, `registry`. |
| `api/v1_admin.py` | 57 | Thin controllers over `services/admin.py`. |
| `api/v0_legacy.py` | 283 | **DEPRECATED.** The pre-registry endpoints, re-exported from `api/__init__.py`. |

### 1.4 DocTypes — **skeletons only**

10 DocTypes in `gdb_bank/gdb_bank/doctype/`. They carry **identity, scoping and
lifecycle fields only**. Business fields are appended per phase — this was a
deliberate instruction ("first create the personas, we will keep on adding the
fields").

| DocType | Fields | Note |
|---|---|---|
| `GDB Loan Application` | 12 | `subject_eid`, `facilitator_eid`, `status` (18 states), `doc_version` for optimistic concurrency. Has a marked `section_break_detail` where Phase 2 fields go. |
| `GDB Audit Event` | 16 | Append-only. System Manager gets **read only**; nobody gets write/delete. |
| `GDB Application Document` | 9 | Scope inherited from `application` link. |
| `GDB Disbursement Condition` | 9 | |
| `GDB Information Request` | 10 | |
| `GDB Consent` | 6 | Records the terms version agreed to. |
| `GDB Cluster` + `GDB Cluster Member` | 6 + 3 | |
| `GDB Facilitator Mandate` | 8 | The Phase 2.5 consent handshake. |
| `GDB Lending Rule Change` | 14 | |

JSONs ship with a **System Manager row only**; every persona permission is
written as Custom DocPerm by `provisioning.reconcile()`.

> Generated by a one-off script in the scratchpad. Frappe owns these files now —
> the Desk rewrites them when a DocType is edited. Edit them in place or via
> the Desk; do not regenerate.

### 1.5 Frontend

| File | Purpose |
|---|---|
| `shared/rbac/capabilities.generated.ts` | **GENERATED.** Capability constants + persona catalogue. |
| `shared/rbac/index.ts` | `can()`, `canAny()`, `canAll()`, `hasPersona()`. |
| `shared/rbac/types.ts` | `Identity` — the capability-shaped `whoami` payload. |
| `shared/rbac/RequireCapability.tsx` | Route guard keyed to capabilities, replaces `RequireUnderwriter`. |
| `widgets/navigation/nav-registry.ts` | Navigation as data, filtered by capability. |

Modified: `auth.tsx` (calls `v1_identity.whoami`), `App.tsx` (`PortalHome`
redirects to the persona's `portal_home`; `/review` → `/underwriting`),
`Layout.tsx` (nav from registry, persona badges), `types.ts` (re-exports
`Identity`).

**The SPA authorizes nothing.** It decides what to *render*. Every capability
is re-checked server-side.

### 1.6 Infrastructure

| File | Change |
|---|---|
| `hooks.py` | Row-level hooks generated via `row_level.hook_map()`; `on_session_creation` wired to Keycloak sync. |
| `install.py` | `gdb_eid` custom field on User; `after_install`/`after_migrate` call `provisioning.reconcile()`; demo users now one per persona with deterministic `999-` e-IDs. |
| `backend/scripts/export_rbac.py` | Generates the TS + Keycloak projections. `--check` mode for CI. |
| `backend/scripts/gdb-realm-structure.generated.mjs` | **GENERATED.** 9 realm roles + `gdb-portal` PKCE client. |
| `keycloak-local/setup-gdb.mjs` | Seeds realm roles, the `gdb-portal` client, the `eid` claim mapper, one test account per persona. |
| `docker-compose.yml` | `kc-bootstrap` runs `setup-gdb.mjs` after `setup-mps.mjs`; mounts all of `backend/scripts`. |
| `.github/workflows/ci.yml` | New `verify` job (registry tests, drift check, DocType JSON integrity, typecheck, build). Image builds now `needs: verify`. |
| `pyproject.toml` | Added `pyjwt[crypto]>=2.8`. |
| `api.py` | **Moved to `api/v0_legacy.py`** — see the trap below. `whoami` delegates to `v1_identity.whoami`; everything else untouched. |

---

## 1.7 A trap that already bit once

`gdb_bank/api.py` and `gdb_bank/api/` existed side by side for part of this
work. **Python resolves the package directory in preference to the same-named
module**, so `api.py` became dead code the moment the package appeared — and
every endpoint in it (`signup`, `apply_loan`, `my_loans`, `loan_detail`,
`all_loans`, `review_loan`) stopped resolving, silently, while the file sat on
disk looking perfectly correct.

Nothing caught it: the syntax was valid, and `import gdb_bank.api.v1_identity`
still succeeded through the package.

**Fixed by** moving the file to `api/v0_legacy.py` and re-exporting its
functions from `api/__init__.py`, so the dotted paths the SPA calls keep
resolving. Frappe resolves a whitelisted method by importing the dotted path
and taking the attribute, and the re-exported objects are the same functions
`@frappe.whitelist()` registered, so the whitelist check still passes.

**Guarded by** `tests/test_api_surface.py`:
- `test_every_expected_endpoint_resolves` — every dotted path the SPA calls
  actually resolves to a callable.
- `test_no_module_is_shadowed_by_a_package` — structural check for any
  `foo.py` sitting next to `foo/`.

A dotted path in the frontend is type-checked by nothing. If you move an API
module, update `EXPECTED` in that test and the SPA in the same change.

---

## 2. The seven personas

| Persona | Frappe role | Row scope | Desk | Keycloak realm role(s) |
|---|---|---|---|---|
| `citizen` | `GDB Citizen` | `own_eid` | no | `Citizen`, `GDB_Citizen` |
| `facilitator` | `GDB Regional Facilitator` | `facilitated` | no | `GDB_Regional_Facilitator` |
| `underwriter` | `GDB Underwriter` | `all` | yes | `GDB_Underwriter` |
| `disbursement_officer` | `GDB Disbursement Officer` | `all` | yes | `GDB_Disbursement_Officer` |
| `finance` | `GDB Finance Officer` | `all` | yes | `GDB_Finance_Officer` |
| `board` | `GDB Board Member` | **`none`** | yes | `GDB_Board_Member`, `GDB_CEO` |
| `platform_admin` | `GDB Platform Admin` | `none` | yes | `GDB_Platform_Admin` |

Legacy `Citizen` and `Loan Underwriter` alias onto `GDB Citizen` /
`GDB Underwriter`; existing accounts keep working.

---

## 3. Frappe facts that shaped the design

Verified against the Frappe v16 docs. **Do not re-derive these from memory.**

1. **Submittable DocTypes have exactly 3 states** (Draft/Submitted/Cancelled)
   and fields are immutable after submit except `allow_on_submit`. This is why
   the 18-state lifecycle is a `status` field guarded by a transition table,
   not `docstatus`.
2. **`frappe.get_all` / `frappe.db.get_all` do NOT apply permissions.** Use
   `frappe.get_list` for user-facing reads. The legacy `api.py` uses
   `get_all` — its row security rests entirely on a hand-written filter.
3. **⚠️ v16 breaking change: `has_permission` hooks must return `True`
   explicitly.** v15 granted on `None`; v16 denies. Every return path in
   `row_level.py` is explicit for this reason.
4. **No read/select role permission → only *shared* docs visible, and
   `get_list` raises.** This *is* the Board/CEO privacy guarantee — the absence
   of a permission row, not a hidden route.
5. **Permission composition:** `(if_owner OR User Permissions) AND
   permission_query_conditions`, then `OR shared`. That trailing `OR shared` is
   why no persona may `share` case data — `provisioning` fails the migration if
   one is granted it.
6. `permission_query_conditions` returns a raw SQL string → every value goes
   through `frappe.db.escape`.

---

## 4. Verification

All of this passes today:

```bash
# Registry + API-surface invariants — no Frappe site or DB needed (25 tests)
cd backend/apps/gdb_bank && python -m unittest discover -s gdb_bank/tests -t . -v

# Generated files in step with the registry
cd backend && python scripts/export_rbac.py --check

# Frontend
cd frontend && npm run typecheck && npm run build

# On a live site
bench --site gdb.localhost migrate                                  # reconcile runs
bench --site gdb.localhost execute gdb_bank.rbac.provisioning.drift  # should be empty
bench --site gdb.localhost execute gdb_bank.rbac.provisioning.describe
```

The tests gate the things that fail silently: a `RowScope.NONE` persona gaining
case-level access, a persona holding both sides of a separation rule, a
capability granted to nobody, a stale generated file, an unreachable lifecycle
state.

---

## 5. What is NOT built

Be explicit about this — it is easy to mistake the skeleton for the feature.

- **Phase 2** — no application wizard, no server-side drafts, no document
  vault upload/MIME validation/signed URLs, no business fields on the DocType.
- **Phase 2.5** — `GDB Facilitator Mandate` DocType and the `facilitator`
  persona exist; **no service implements the consent handshake or
  acting-on-behalf.** `services/facilitator.py` does not exist.
- **Phase 3** — no `services/underwriting.py`, no review queue API, no
  declared-vs-verified diff.
- **Phase 4** — no `services/disbursement.py` or `services/finance.py`, no
  condition checking, no payment file, no ledger.
- **Phase 5** — no `api/v1_reports.py`, no aggregate endpoints, no rule-change
  workflow. The `board` persona is locked down correctly but has nothing to
  read.
- **Idempotency** — `Idempotency-Key` handling is specified in `CLAUDE.md` but
  **not implemented**. No `security/idempotency.py` yet.
- **Optimistic concurrency** — `doc_version` field exists; no `If-Match`
  enforcement.
- **Document security** — no MIME magic-number validation, no virus scan, no
  signed URLs.
- **External APIs** — no DCRA or bank-registry integration, no circuit breaker.
- **OIDC PKCE on the frontend** — `exchange_token` exists on the backend;
  the SPA still uses the password `Login.tsx`. `oidc-client-ts` not installed.
- **React Query / Zustand / RHF+Zod** — named in the plan, **not yet added** to
  `package.json`.

---

## 6. The sibling project (functional target)

`C:\Users\HemanthKumarChittipr\Downloads\guyana-development-bank` is a
**separate, more feature-complete build of the same product.** It is not a
dependency — treat it as a reference implementation.

**What it has that this does not:** applicant profiles with declared-vs-verified
split, consent versioning, document shelf, loan offers, conditions, collections,
cluster members, lending rule proposals, DCRA + bank-registry integrations, 31
application fields (sections B–H), and the full set of frontend screens.

**Why this build exists anyway** — measured, not asserted:

| | Sibling | This build |
|---|---|---|
| `Apply.tsx` | 1,532 lines | not built |
| `api.py` | 2,075 lines | layered |
| Roles | 4 | 7 personas |
| `db_set`/`set_value` calls | 23 | audit-guarded transitions |
| Frontend structure | flat `pages/` + `components/` | FSD + capability-driven |

The sibling's own `ARCHITECTURE_STANDARDS.md` describes the layered/FSD target
it does not itself follow, and `implementation_plan.md` here explicitly says
"**NO 1500-line God Objects**" — a direct reference to that `Apply.tsx`.

**Useful things to lift from it:** the DocType field lists, the
`APPLICATION_SECTIONS` table, the DCRA and bank-registry clients, the
`profiles.py` declared-vs-verified design, and its prose-docstring style.
**Do not lift:** `Apply.tsx`, the flat `api.py`, or `db_set` on submitted docs.

---

## 7. OPEN DECISION — resolve before Phase 2

**Where does the loan case file live?**

- **Option A — follow the sibling:** extend lending's `Loan Application` with
  `gdb_*` custom fields plus satellite DocTypes. *Proven* to carry the whole
  feature set. Costs: `STATUS_TO_PORTAL` mapping, `db_set` on submitted docs,
  two competing status fields, awkward drafts.
- **Option B — the `GDB Loan Application` DocType built here:** owns the full
  lifecycle cleanly; lending's `Loan` is created only at booking for
  amortisation and GL. Costs: more upfront work, the legacy `api.py` endpoints
  must be migrated.

**Current state:** the Option B DocTypes exist, and the legacy Option A path in
`api.py` is untouched and still functional. **Both routes are still open.**

The user was asked twice and redirected to other work both times. Ask again,
concisely, before writing Phase 2 services — the answer determines every
service module that follows.

---

## 8. Conventions to follow

- **Never check a role name.** Guard with `@require(cap.X)`. Roles are an
  implementation detail of the registry.
- **Every state transition calls `services/audit.record()`.** Skipping it
  silently disables the separation-of-duties rule that queries that event.
- **`doc.save()` for business state; `db_set` only for operational system
  state** (`last_seen`, the e-ID mirror) — and say why in a comment.
- **Regenerate after touching the registry:**
  `cd backend && python scripts/export_rbac.py`. CI fails on stale output.
- **Never hand-edit** `capabilities.generated.ts` or
  `gdb-realm-structure.generated.mjs`.
- **Controllers in `api/` parse and delegate.** An `if role ==` in that package
  is in the wrong layer.
- Keep `rbac/` and `domain/` free of `frappe` imports so the tests stay
  site-free and fast.
