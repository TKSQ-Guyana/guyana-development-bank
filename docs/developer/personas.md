# Personas, Capabilities and Permissions

How authorization works in `gdb_bank`, and what to do when the Bank adds a role.

---

## The one-line version

`backend/apps/gdb_bank/gdb_bank/rbac/personas.py` is the only place a role is
defined. Everything else — Frappe Roles, Role Profiles, DocType permissions,
row-level SQL filters, Keycloak realm roles, the SPA's navigation and route
guards — is derived from it.

**Adding a role is a data change in one file plus `bench migrate`.**

---

## Why it is built this way

The naive version of this system spreads a role across nine places: a Frappe
Role record, permission rows on each DocType, an `if "Underwriter" in roles`
in every service, a query filter in every list endpoint, a Keycloak realm role,
a nav item, a route guard, a badge in the header, and a line in the seed
script. Adding the tenth role means finding all nine. Missing one is not a
compile error — it is a silent authorization hole that ships.

So the role is declared once, as data, and projected onto each consumer.

```
                      rbac/personas.py
                      (PersonaSpec × 7)
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   provisioning.py     export_rbac.py       guards.py + row_level.py
        │                    │                    │
   Frappe Roles        capabilities.        capability checks,
   Role Profiles       generated.ts         separation-of-duties,
   Custom DocPerms     gdb-realm-           permission_query_conditions,
                       structure.mjs        has_permission
        │                    │                    │
     ERPNext             SPA + Keycloak       every request
```

---

## Capabilities, not roles

Services never ask *"is this user an Underwriter?"*. They ask *"may this user
`credit.approve`?"*.

```python
@require(cap.CREDIT_APPROVE, subject_doctype=APPLICATION, subject_arg="name")
def approve(name: str, amount, reason: str, actor: Actor = None): ...
```

That indirection is the whole point. When a `Senior Underwriter` persona is
added later and granted `credit.approve`, this function already works for it.
Had it checked the role name, every such function would need editing.

The same applies on the frontend:

```tsx
<RequireCapability anyOf={[CAP.APPLICATION_VIEW_QUEUE]}>
  <Review />
</RequireCapability>
```

Capability strings are generated into TypeScript from the Python — see
*Generated files* below — so the two cannot drift.

---

## The four enforcement layers

A capability check alone is not enough, because `/api/resource/*`, the ERPNext
desk and report views never touch our service layer. Four layers, each covering
what the others miss:

| Layer | Where | Stops |
|---|---|---|
| **DocType permissions** | `permissions[]` rows, generated as Custom DocPerm by `provisioning.py` | A persona touching a DocType at all |
| **Row-level, lists** | `permission_query_conditions` hook → SQL predicate on `subject_eid` | A Citizen seeing another Citizen in *any* list, including the desk and `/api/resource` |
| **Row-level, single doc** | `has_permission` hook | IDOR/BOLA on `GET /api/resource/GDB Loan Application/GDB-APP-00042` |
| **Transaction** | `rbac/guards.py` → capability + `rbac/separation.py` | The maker acting as the checker |

### How Frappe combines them

From `frappe/database/query.py` (v16):

- **No** role permission with `read`/`select` on a DocType → only *shared*
  documents are visible, and an unshared `get_list` raises. **This is the
  Phase 5 Board/CEO guarantee** — it is the *absence* of a permission row, not
  a hidden route.
- **With** a role permission:
  `(if_owner OR User Permissions) AND permission_query_conditions`, then
  `OR shared`.

That trailing `OR shared` is why no persona is granted `share` on a case-level
DocType: a shared document would bypass the e-ID scope entirely.
`provisioning._assert_registry_invariants()` fails the migration if anyone adds
it.

### ⚠️ Frappe v16 breaking change

`has_permission` hooks must return **`True`** explicitly to grant. In v15,
returning `None` implicitly granted; in v16 it denies. Every return path in
`security/row_level.py` is explicit for this reason.

Also: `frappe.get_all` / `frappe.db.get_all` **do not apply permissions**. Use
`frappe.get_list` for anything user-facing, or filter explicitly and say why.

---

## Separation of duties

The three rules from `features.md` are declared as data in
`rbac/separation.py` and evaluated against the audit trail — not against a
status field, because a status can be reached by several routes but the trail
records who actually acted.

```python
SeparationRule(
    rule_id="approver_ne_releaser",
    blocked_capability=cap.DISBURSEMENT_RELEASE,
    conflicting_events=(ev.CREDIT_APPROVED, ev.OFFER_ISSUED),
    message="The officer who approved this loan may not release its funds.",
    include_subject_party=True,
)
```

`guards.require()` evaluates every rule matching the capability before the
service body runs, so a new rule takes effect everywhere that capability is
used without touching a service.

**This is why every state transition must call `services/audit.record()`.**
Skipping an audit write on an approval silently disables the maker/checker rule
that depends on it.

---

## Adding a role

Worked example: the Bank introduces a **Recovery Officer** who chases arrears.

### 1. Add any new capabilities

`rbac/capabilities.py`:

```python
# ---------------------------------------------------------------- recovery --
RECOVERY_VIEW_ARREARS = "recovery.view_arrears"
RECOVERY_RECORD_CONTACT = "recovery.record_contact"
RECOVERY_PROPOSE_WRITE_OFF = "recovery.propose_write_off"
```

`ALL_CAPABILITIES` is derived by reflection — there is no second list to update.

### 2. Append one `PersonaSpec`

`rbac/personas.py`:

```python
PersonaSpec(
    key="recovery_officer",
    role="GDB Recovery Officer",
    title="Recovery Officer",
    description="Chases arrears. Decides no credit and moves no money.",
    desk_access=True,
    row_scope=RowScope.ALL,
    portal_home="/recovery",
    keycloak_roles=("GDB_Recovery_Officer",),
    capabilities=frozenset({
        cap.IDENTITY_VIEW_SELF,
        cap.APPLICATION_VIEW_ANY,
        cap.RECOVERY_VIEW_ARREARS,
        cap.RECOVERY_RECORD_CONTACT,
        cap.RECOVERY_PROPOSE_WRITE_OFF,
    }),
    doctype_permissions=(
        DocPerm(APPLICATION, read=True, report=True),
        DocPerm(AUDIT_EVENT, read=True, report=True),
    ),
),
```

### 3. Add a separation rule, if the persona is a checker

`rbac/separation.py` — e.g. a write-off proposer is never its approver.

### 4. Regenerate the projections

```bash
cd backend && python scripts/export_rbac.py
```

Writes `capabilities.generated.ts` and `gdb-realm-structure.generated.mjs`.
Commit both.

### 5. Add the screen

`widgets/navigation/nav-registry.ts`:

```ts
{ to: '/recovery', label: 'Recovery', requires: [CAP.RECOVERY_VIEW_ARREARS] },
```

…and a route wrapped in `<RequireCapability anyOf={[CAP.RECOVERY_VIEW_ARREARS]}>`.

### 6. Deploy

```bash
bench --site gdb.localhost migrate     # provisioning.reconcile() runs
docker compose up -d kc-bootstrap      # setup-gdb.mjs seeds the realm role
```

`reconcile()` creates the Role, the Role Profile `GDB Recovery Officer`, and
the Custom DocPerm rows. `setup-gdb.mjs` creates the `GDB_Recovery_Officer`
realm role, so Keycloak can grant it.

### 7. Verify

```bash
cd backend/apps/gdb_bank && python -m unittest discover -s gdb_bank/tests -v
bench --site gdb.localhost execute gdb_bank.rbac.provisioning.drift
```

`drift` should be empty.

---

## Modifying a role

Edit the spec, bump `revision`, regenerate, migrate. `reconcile()` is
convergent: it adds what is missing and **removes** Custom DocPerm rows this
app previously granted but the registry no longer declares. Rows belonging to
roles outside the registry are never touched.

## Retiring a role

Set `retired=True`. Do **not** delete the spec.

```python
PersonaSpec(key="recovery_officer", ..., retired=True),
```

`reconcile()` revokes its permissions and disables the Role, but leaves the
Role record and every historical audit row naming it intact. Audit trails have
to stay readable after a persona is withdrawn.

---

## Generated files — never edit by hand

| File | Generated from | Regenerate |
|---|---|---|
| `frontend/src/shared/rbac/capabilities.generated.ts` | `capabilities.py`, `personas.py` | `cd backend && python scripts/export_rbac.py` |
| `backend/scripts/gdb-realm-structure.generated.mjs` | `personas.py` | same |

CI runs `python scripts/export_rbac.py --check` and fails if either is stale.

---

## The invariants CI enforces

`gdb_bank/tests/test_registry.py` runs without a Frappe site or a database and
gates every push:

- Every capability is granted to at least one persona (no dead guards).
- Persona keys and role names are unique.
- Every active persona has at least one Keycloak role, or nobody could ever be
  granted it by login.
- **A `RowScope.NONE` persona holds no permission on a case-level DocType** —
  Phase 5's privacy guarantee.
- No persona may `share` or `export` case-level data.
- No single persona holds both sides of a separation-of-duties rule.
- Every case-level DocType has a `ScopeSpec`, or it would get no row filtering.
- Every lifecycle transition names a real state and a real capability; terminal
  states have no exits; every state is reachable.

`provisioning._assert_registry_invariants()` re-checks the privacy ones at
migrate time, so a bad registry fails the deploy rather than the audit.

---

## The current seven

| Persona | Row scope | Desk | Notes |
|---|---|---|---|
| `citizen` | `own_eid` | no | Applicant/borrower |
| `facilitator` | `facilitated` | no | Acts for a mandating cluster; never the owner |
| `underwriter` | `all` | yes | Credit decision; no money, no conditions |
| `disbursement_officer` | `all` | yes | Conditions, countersign, release |
| `finance` | `all` | yes | Ledger, refunds, proposes rules |
| `board` | **`none`** | yes | Aggregates only; approves rules |
| `platform_admin` | `none` | yes | Accounts, roles, kill switch |

Legacy roles `Citizen` and `Loan Underwriter` alias onto `GDB Citizen` and
`GDB Underwriter` (`LEGACY_ROLE_ALIASES`); existing accounts keep working and
`reconcile()` grants holders the new role.

---

## Known gaps

- **System Manager.** A Frappe System Manager can still reach data directly
  through the desk. `features.md` records this as accepted for now. Note that
  System Manager grants no *GDB capability* on its own: credit and money still
  require a persona that declares them.
- **`Administrator`.** Exempt from row-level scoping as a break-glass path. It
  is a named account and its use is visible in the technical log; locking it
  out would make a broken permission table unrecoverable.
- **Kill switch timing.** Keycloak-side disablement is picked up at the next
  session creation and cached for 60s. Admin-side disablement
  (`services/admin.set_enabled`) is immediate and deletes live sessions.
