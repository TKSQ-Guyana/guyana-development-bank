# Requirement coverage — tested, not estimated

Run on 2026-09-15 against the live compose stack (frappe 16, erpnext, lending
16.5.0, gdb_bank 0.1.0, site `gdb.localhost`), through the frontend nginx at
`localhost:3000` — the same path the SPA uses.

## What changed from the first version of this file

The first version sampled ~25 requirements and inferred the rest from function
names. Several of those inferences were **wrong**, and the wrong ones were
flattering in one direction and unfair in the other:

| I claimed | Actually |
|---|---|
| R-170 authorization "never negative-tested" | **9 of 9 negative tests refused with 403.** Server-side enforcement is real |
| R-131 separation of duties "not enforced" | Partly wrong — `review_loan` **does** block reviewing your own application. The decider→disburser gap is real, but there is a guard I said didn't exist |
| R-124 "whether it blocks release is untested" | **It blocks.** Proven twice |
| `loan_account` probably reads stored balances | Half right — `dues` is **derived** via lending's `calculate_amounts()`; only the `loan` summary carries stored fields |
| `repayment_plan`, `accepted_offer` are endpoints | **Not whitelisted.** Internal helpers; they 403 |
| R-015 "no branching" | Wrong — Existing/New is a real fork with DCRA validation |

## Method

- **All 36 whitelisted methods** in `gdb_bank` were enumerated and exercised — the complete portal API surface. Since `CLAUDE.md` defines the portal contract as exactly these methods, "no endpoint exists" below is a **tested fact**, not an assumption. It does not rule out desk-only behaviour.
- Four sessions: `citizen@example.gy`, `underwriter@gdb.gov.gy`, a signed-up second citizen (`e2e.member@example.gy`), and a clean anonymous jar.
- A full lifecycle was driven end to end: apply → approve → offer → accept → conditions → verify → book → disburse → repay → reconcile.
- Not covered: browser/UI, accessibility, notifications, encryption, residency. Those need surfaces or infra this session had no access to.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | **Pass** — exercised, behaves as the requirement demands |
| ❌ | **Fail** — exercised, violates the requirement |
| 🟡 | **Partial** — exercised, satisfies some of it |
| ⬜ | **Absent** — verified against the full 36-method surface: nothing implements this |
| ⚫ | **Untestable here** — needs UI, infra or an external system |

---

## C1 — Channel and access

| ID | | Evidence |
|---|---|---|
| R-001 | 🟡 | 0% is real (`GDB-STD.rate_of_interest = 0.0`, live loans show `total_interest_payable 0.0`). The **G$3,000,000 ceiling is nowhere** — `maximum_loan_amount` is `0.0`. |
| R-002 | ⬜ | No sector endpoint or model. |
| R-003 | ⬜ | No priority-group model. |
| R-004 | ⬜ | No readiness checklist. |
| R-005 | ✅ | Measured: **79 kB gzip JS + 5 kB CSS**. Fine on a low-bandwidth link. |
| R-008 | 🟡 | `password_login` works and mints a normal `sid` — but against **Keycloak**, not My Guyana. |
| R-009 | ❌ | `whoami` shows the person key is the **email**; `eid` is an attribute. No GUIN/RIDN. |
| R-010 | ✅ | No Document Number or CAN appears anywhere in the surface. |
| R-011 | ⬜ | No national-ID path. |
| R-012 | ⬜ | No consent capture. |
| R-013 | ✅ | Tested: logging in with `592-3333-0003` was refused — *"This account is already linked to a different e-ID."* Dedupe holds. |
| R-014 | ⬜ | No agent-assisted registration. |

> ⚠️ Side-effect of that R-013 test: `592-3333-0003` is documented in `CLAUDE.md` as the account that **provisions a new citizen**. It no longer does — it errors. Either the doc is stale or prior test data linked its email. Worth a look.

## C2 — Applicant capabilities

| ID | | Evidence |
|---|---|---|
| R-015 | 🟡 | Real fork: `business_stage` Existing/New, and Existing **requires** a DCRA number. But it doesn't drive sections. |
| R-016 | ❌ | Only `monthly_income`. No revenue, costs, obligations, cash position. |
| R-017 | 🟡 | `save_plan` takes two free-text blobs, not the eight named plan dimensions. |
| R-018 | ✅ | `apply_loan` captures amount + purpose. |
| R-019 | ⬜ | No sector field on the application. |
| R-020 | ⬜ | No priority-group declaration. |
| R-021 | ❌ | **Proven**: `apply_loan` does `doc.insert(); doc.submit()` — submission is immediate. No draft, no resume. |
| R-022 | ⬜ | No progress model. |
| R-023 | ⬜ | No reuse mechanism. |
| R-024 | ❌ | **Proven**: applied for **G$99,000,000** — accepted as `ACC-LOAP-2026-00025`. No ceiling check. |
| R-025 | ❌ | No evidence requirement blocks submission; there is no evidence model at all. |
| R-026 | ⬜ | No withdrawal endpoint. |
| R-027–R-031 | ⬜ | **No evidence/document endpoint exists.** Five requirements, zero surface. |
| R-032 | ⬜ | Phase 2. |
| R-033 | ⬜ | No replacement flow. |
| R-034 | 🟡 | Status maps to `Submitted/Approved/Rejected`; no plain-language "what happens next". |
| R-035 | ⬜ | No information-request model — and `review_loan` has no such outcome. |
| R-036 | ⬜ | No notification on status change. |
| R-037 | ❌ | **Proven leak**: the citizen's own `loan_detail` returns `underwriter_remarks: "approved"`, `reviewed_by: underwriter@gdb.gov.gy`, `reviewed_on`. Those are underwriting notes. |
| R-038 | ✅ | `issue_offer` builds the offer from the approved application — no re-entry. |
| R-039 | ✅ | One `GDB Loan Offer` doc serves both views. |
| R-040 | ✅ | `my_offer` returns amount, term, validity, conditions. |
| R-041 | ✅ | **Strong**: acceptance requires the applicant's typed name — *"Somebody Else"* was refused, *"Demo Citizen"* accepted, and `accepted_name` + `responded_on` were recorded. |
| R-042 | ⬜ | No countersignature step. |
| R-043 | ✅ | `decline_offer` recorded status `Declined` with the reason. |
| R-044 | 🟡 | `valid_until` is set and `is_open()`/`expiry_state()` exist; no job proves lapse. |
| R-045 | ⬜ | `accepted_offer` is **not whitelisted** — the borrower has no download route. |
| R-046 | 🟡 | `dues` is genuinely **derived** (lending's `calculate_amounts()` at read time). But the `loan` block ships stored fields (`total_payment`, `total_amount_paid`). |
| R-047 | ✅ | Repaid 8,250,000 → `total_amount_paid` updated in the same response. |
| R-048 | ⬜ | No statement endpoint. |
| R-049 | ⬜ | Single-facility only; no cross-facility history. |

## C3 — Field and regional capabilities

| ID | | Evidence |
|---|---|---|
| R-050 | ❌ | **Broken**: `convert_lead` as the underwriter → *"User underwriter@gdb.gov.gy does not have doctype access … for document Loan Lead."* The only staff role cannot convert a lead. |
| R-051–R-056 | ⬜ | No on-behalf-of application, no attribution model, no region scoping, no site-visit endpoint. |

> R-057–R-062 (Offline operation, Monitoring) were omitted from the list you pasted; they exist in the register.

## C4 — Group and capability building

| ID | | Evidence |
|---|---|---|
| R-063 | ✅ | Created `E2E Test Cluster` with region, sector, head. |
| R-064 | 🟡 | `invite_member` works, but invites by **email**, not identifier lookup. |
| R-065 | 🟡 | `member_status` exists (`Active`); invited/exited transitions and dates untested. |
| R-066 | ❌ | **Proven leak.** A second member's `cluster_view` returned the head's application **in full**: `loan_amount 250000`, **`monthly_income 75000`**, `phone`, `underwriter_remarks`. The docstring says this sharing is deliberate — it directly contradicts R-066. Direct access is still blocked (`loan_detail` → 403), so the leak is only via the cluster view. |
| R-067 | ⬜ | No exit flow. |
| R-068 | ✅ | A citizen created the cluster themselves. |
| R-069 | ⬜ | No facilitator role or routing. |
| R-070 | ❌ | `save_plan` is one shared blob — no shared/member separation. |
| R-071 | ⬜ | No section-level rights. |
| R-072 | 🟡 | `save_plan` touched only the cluster; no side-effect observed, not proven. |
| R-073–R-079 | ⬜ | **No Coursera surface exists.** Seven requirements, zero code. |

## C5 — Verification and assessment

| ID | | Evidence |
|---|---|---|
| R-080 | 🟡 | Keycloak stands in for My Guyana. |
| R-081 | ✅ | `dcra_lookup("BN-2024-004512")` → full record: name, type, status, registered_on, region, proprietors. |
| R-082–R-085 | ⬜ | No GRA, NIS, credit bureau, or sanctions/PEP surface. |
| R-086 | ✅ | `verify_bank_account` → `result: Verified`, `name_match: true`, `source: sandbox`. |
| R-087 | ⬜ | No directors/UBO model. |
| R-088 | ❌ | No check register — results are returned, never persisted with source/timestamp/reference. |
| R-089 | ⚫ | Both adapters returned success; the unavailable path was never triggered. **Untested and load-bearing.** |
| R-090 | ⚫ | Same. |
| R-091 | ⬜ | No re-run with retained history. |
| R-092–R-099 | ⬜ | **No assessment or benchmark surface.** Eight requirements, zero code. |

## C6 — Credit decisioning

| ID | | Evidence |
|---|---|---|
| R-100 | ✅ | `all_loans` returned all 24 applications; every submitted one is in it. |
| R-101 | ⬜ | No assignment. |
| R-102 | 🟡 | Groupable by the three lending statuses only. |
| R-103 | ❌ | No case ownership — any underwriter can act on any case. |
| R-104 | ⬜ | No age/time-in-state. |
| R-105–R-107 | ⬜ | No case workspace, stages, or fact→source links. |
| R-108 | 🟡 | One free-text `remarks`, not stage-level. |
| R-109 | ⬜ | No cluster context in the queue. |
| R-110 | ❌ | Two outcomes only (`approve`/`reject`). No refer, no request-information. *(Feasible: a Property Setter took the field to 5 options live.)* |
| R-111 | ❌ | **Proven**: approved `ACC-LOAP-2026-00025` with **no remarks** → 200. `if remarks:` makes rationale optional. |
| R-112 | ❌ | **Proven**: approved **G$99,000,000** against no ceiling and no capacity figure. |
| R-113 | 🟡 | `reviewed_by` + `reviewed_on` recorded. Evidence-state-at-decision is not. |
| R-114 | 🟡 | No automated path exists, but nothing enforces the prohibition. |
| R-115 | ❌ | `review_loan` uses `db_set` on a submitted doc — the decision is **mutable in place**, not an immutable event with linked corrections. |
| R-116 | ⬜ | No authority matrix. |
| R-117 | ⬜ | No e-signature. |
| R-118–R-120 | ⬜ | No specialist role or input. |
| — | ✅ | **Unrequired control worth keeping**: `review_loan` refuses to let an underwriter review their *own* application. |

## C7 — Money movement

| ID | | Evidence |
|---|---|---|
| R-121 | 🟡 | Conditions are raised from the **accepted offer** (5 were created), not from product configuration. |
| R-122 | ✅ | Both the underwriter and the applicant can read the checklist. |
| R-123 | ✅ | Verification recorded `status: Met`, `verified_by`, `verified_on`, `note`. Waiver is a peer status, equally attributed. |
| R-124 | ✅ | **Proven twice**: disbursement refused — *"5 condition(s) precedent are still outstanding"*, then *"4 …"* after one was met. |
| R-125 | ❌ | Nothing re-derived at release: a G$99M loan passed straight through. |
| R-126 | ✅ | Refusals state the reason and name the outstanding conditions. |
| R-127 | ❌ | There is no Disbursement Officer role; the underwriter authorizes release. |
| R-128 | ⬜ | Disbursement never checks the verified bank account. |
| R-129 | ✅ | Disbursement is a submitted doc posting GL entries (2 on a fresh loan, 8 on an older one). |
| R-130 | ⬜ | No receipt confirmation. |
| R-131 | ❌ | **Proven end to end.** One account — `underwriter@gdb.gov.gy` — approved, issued the offer, verified all 5 conditions, booked and **disbursed G$99,000,000**. No second pair of eyes anywhere. |
| R-132 | ⬜ | No training record to re-check. |
| R-133 | ❌ | Nothing reconciles the disbursement against the offered amount. |
| R-134–R-136 | ⬜ | No exception queue, no daily report. |
| R-137 | ✅ | `apply_receipt` posted `LM-REP-0024` for 36,112 into the loan ledger. |
| R-138 | ✅ | Allocated as `Advance Payment`, receipt marked `Reconciled`, `still_unapplied: 0.0`. |
| R-139 | 🟡 | Cancel+amend supports it natively; never executed. |
| R-140 | 🟡 | `suggest_loans` matched a standing-order receipt to a loan by description. Bank channels themselves absent. |
| R-141–R-142 | ⬜ | No manual payment invoice or settlement tracking. |

## C8 — Servicing

| ID | | Evidence |
|---|---|---|
| R-143 | ✅ | Every ledger doc is submittable; loan 17 holds 3 repayments, 3 demands, 1 disbursement, 8 GL entries, none mutated in place. |
| R-144 | 🟡 | `dues` is derived at read time; the `loan` summary still ships stored fields. |
| R-145 | ❌ | Lending denormalizes — `total_amount_paid: 172,224`, `days_past_due` stored. **Client decision**, not a core-code problem. |
| R-146 | ✅ | 0% is a first-class path: explicit zero-rate branch, `interest_amount: 0.0` on every schedule row. |
| R-147 | ❌ | `days_past_due` is a stored Int written nightly by `create_process_loan_classification`. (All 10 lending jobs are togglable via `Scheduled Job Type.stopped`.) |
| R-148 | ⬜ | No statement generator. |
| R-149 | ✅ | Loan 17 carries 4 schedules — 1 `Active`, 3 `Rescheduled`. Prior schedules retained for free. |
| R-150 | ⬜ | No closure endpoint. |

## C9 — Product, portfolio and governance

| ID | | Evidence |
|---|---|---|
| R-151 | ❌ | The only configuration is `Loan Product`, with `maximum_loan_amount = 0.0`. No sectors, priority groups, term bounds or prerequisites. |
| R-152 | ❌ | Follows R-151 — nothing to derive from. |
| R-153 | ⬜ | No build gate. |
| R-154 | 🟡 | `track_changes` gives author + timestamp; no effective date. |
| R-155 | ❌ | Only `Citizen` and `Loan Underwriter` exist. No Finance Department role, so config writes are unrestricted. |
| R-156–R-168 | ⬜ | Phase 2; no reporting surface, no Board/CEO role. |

## C10 — Common and platform

| ID | | Evidence |
|---|---|---|
| R-169 | ❌ | One `sid` per origin; no dual context. Token auth exists as the fix. |
| R-170 | ✅ | **9/9 negative tests refused 403** — `all_loans`, `loan_detail` (other's), `review_loan`, `book_loan`, `disburse_loan`, `issue_offer`, `verify_condition`, `unreconciled_receipts`, `loan_account` (other's). |
| R-171 | ❌ | Role-scoped only. No region or sector dimension exists. |
| R-172 | ❌ | Surfaces are not disjoint — `loan_detail` serves both and leaks underwriting fields (R-037). |
| R-173 | 🟡 | `track_changes = 1` on all four lifecycle doctypes; no "basis" field, and `db_set` writes bypass the Version trail. |
| R-174 | ⬜ | No system-vs-human distinction. |
| R-175 | ❌ | Unachievable in app code — `Administrator` short-circuits permissions (`frappe/permissions.py:108`, `:306`). Infra control required. |
| R-176 | ⬜ | No notification surface. |
| R-177 | ⚫ | Infra. |
| R-178 | 🟡 | Two adapters return structured results; health/timeout/retry and the unavailable path were never exercised. |
| R-179 | 🟡 | Both adapters reported `source: sandbox` — a sandbox mode exists in some form, but is not a per-integration switch. |
| R-180 | 🟡 | `signup` provisions a user; suspend/deactivate only via desk. |
| R-181 | ❌ | No Platform Admin role exists. |
| R-182 | ⬜ | No health surface. |
| R-183 | ⬜ | Phase 2. |
| R-184 | ⚫ | Not tested — no browser session. |
| R-185 | ⚫ | Amounts return as raw floats; formatting is a UI concern, untested. |

## CA — AI services (Phase 2)

| ID | | Evidence |
|---|---|---|
| R-186–R-202 | ⬜ | Nothing exists. R-186/R-187 should be designed into C6 now — the decision field must be one no AI can write. |

## CI — Identity and access

| ID | | Evidence |
|---|---|---|
| R-203 | ❌ | `whoami` returns `eid: 592-1111-0001` — a Keycloak username, not a GUIN/RIDN. |
| R-204 | ⬜ | No national-ID path. |
| R-205 | ⬜ | Phase 2. |
| R-206 | ✅ | No Document Number or CAN is used. |
| R-207 | ✅ | `identity.py` is genuinely adapter-shaped — swapping Keycloak for My Guyana is a contained change. |
| R-208 | ⬜ | No consent model. |
| R-209 | ✅ | Both adapter calls send only a lookup key (account number, DCRA number) — no credit or underwriting content leaves. |
| R-210 | ⬜ | No assisted capture. |
| R-211 | ❌ | Same as R-169. |
| R-212 | 🟡 | Ownership scoping enforced and proven; region/sector/case-assignment dimensions absent. |

---

## Result

| | Count |
|---|---|
| ✅ Pass | 26 |
| 🟡 Partial | 28 |
| ❌ Fail | 30 |
| ⬜ Absent (verified) | 112 |
| ⚫ Untestable here | 8 |

## The failures that matter most

1. **R-131 + R-112 + R-024 together** — one account took a **G$99,000,000** application (33× the ceiling) from submission to money out, unaided. Any one of a ceiling check, a four-eyes rule, or a release-time re-derivation would have stopped it. None exists.
2. **R-037 + R-066** — underwriting notes reach the applicant, and a cluster member sees another member's `monthly_income`. Two live confirmed disclosure paths.
3. **R-111** — a credit decision can be recorded with no rationale at all.
4. **R-115** — decisions are `db_set` mutations on a submitted doc, so there is no immutable decision event to audit.
5. **R-050 is broken outright** — the underwriter lacks `Loan Lead` permission, so lead conversion fails for the only staff role that exists.

## Two things to watch

- **Intermittent 417s**: four rapid sequential `verify_condition` calls failed, then the identical call succeeded on retry. Cause not diagnosed — possibly a save/commit race in `_as_system()`. Worth reproducing before it appears in production.
- `CLAUDE.md` is stale on three counts: the product is 0% (not 8%), loan accounting is **enabled** and posting GL, and e-ID `592-3333-0003` no longer provisions a new citizen.

## Test data I created (please review before demoing)

- `ACC-LOAP-2026-00025` — G$99,000,000, Approved → `ACC-LOAN-2026-00019` **Disbursed**, with offer `GDB-OFF-2026-00005` (Accepted), conditions `GDB-CP-2026-00011`–`15` (Met), one repayment of 8,250,000.
- `ACC-LOAP-2026-00026` — G$250,000, Approved; offer `GDB-OFF-2026-00006` **Declined**.
- Cluster `E2E Test Cluster`; user `e2e.member@example.gy`.
- ⚠️ **Pre-existing demo data changed**: bank transaction `ACC-BTN-2026-00001` (36,112) was reconciled against my test loan as `LM-REP-0024`. If that receipt was staged for a demo, it needs reversing.

---

# Custom code or core modification? — per requirement, with proof

**Answer: 0 of 204 requirements need an edit to frappe, erpnext or lending.**
Two (R-145, R-147) are blocked by lending's design and resolve by architectural
choice, not by patching. Every row below names the mechanism and the proof.

## The proof register

Each proof is a fact from this session, reproducible by the command or file
reference given.

| # | Proof | Established by |
|---|---|---|
| **P1** | Portal data rides core doctypes as **Custom Fields** | `install.py:287-297,517-519` `create_custom_fields`. Live: `loan_detail` returns `business_stage`, `dcra_number`, `business_name` on lending's Loan Application; `whoami` returns `eid` on User |
| **P2** | Core fields are **reshaped by Property Setter** | Live mutation: `Loan Application.status` `Open/Approved/Rejected` → **+Referred +Information Requested**, then `frappe.db.rollback()` restored 3 options. Also `install.py:524-531` |
| **P3** | Permissions on core doctypes are **data** | `install.py:498-512` `add_permission("Loan","Citizen",0)` + `update_permission_property`, stored as `Custom DocPerm` |
| **P4** | Row-level scoping via **hooks**, enforced server-side | `hooks.py` → `gdb_bank.permissions.loan_query_conditions` / `loan_has_permission`. Live: **9/9 negative tests refused 403** |
| **P5** | One app reshapes another's behaviour **without touching its source** | lending's own `hooks.py doc_events` on erpnext `Company`, `Sales Invoice`, `Journal Entry`, `Custom Field` + `lending/overrides/*.py` — running in this deployment |
| **P6** | Method and class **overrides exist in frappe 16** | `frappe/__init__.py:1579` (`override_whitelisted_methods`); `base_document.py:110`, `installer.py:325`, `migrate.py:126`, `sync.py:179` (`override_doctype_class`) |
| **P7** | Unwanted core **background jobs are switched off as data** | 10 lending jobs in `Scheduled Job Type`, all with a `stopped` flag |
| **P8** | The custom app **owns its own doctypes** | gdb_bank ships 4 (`gdb_cluster`, `gdb_cluster_member`, `gdb_loan_condition`, `gdb_loan_offer`). Live: full offer + conditions lifecycle ran on them |
| **P9** | Custom code **calls lending's internals** for derived figures | `api.py loan_account` imports `calculate_amounts` and `get_disbursal_amount`. Live: `dues` computed at read time |
| **P10** | R-175 is **not fixable by patching** | `frappe/permissions.py:108,306` — `Administrator` short-circuits permissions; bench access reaches the DB regardless |
| **P11** | The **only** lending-blocked case | Lending writes `total_amount_paid` (live: 172,224) and `days_past_due`. A Property Setter hides fields; it cannot stop writes |
| **P12** | The identity provider is **already an adapter** | `identity.py password_login` mints an ordinary `sid`; every downstream call behaves identically whichever way the user signed in |

## Mechanism codes

**F** fix existing gdb_bank code · **C** new custom code/doctype in gdb_bank ·
**D** data/config (Custom Field, Property Setter, Custom DocPerm, Role, Workflow,
Scheduled Job) · **H** hook override · **A** external adapter · **I** infra/CI,
not application code · **X** blocked by lending's design → architectural choice

### C1 — Channel and access

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-001 | D + C — ceiling into a config doctype (0% already correct) | No | P1, P8 |
| R-002, R-003, R-004 | C — sector, priority-group, checklist models | No | P8 |
| R-005 | F — keep the bundle budget (passing today) | No | measured 79 kB gzip |
| R-008 | A — swap Keycloak for the My Guyana broker | No | P12 |
| R-009, R-010, R-011, R-012, R-014 | C — person doctype keyed on GUIN/RIDN, consent, assisted registration | No | P8, P3 |
| R-013 | — passing | No | live refusal on duplicate e-ID |

### C2 — Applicant capabilities

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-015, R-018, R-034 | F — extend the existing fork and status mapping | No | — |
| R-016, R-017, R-022, R-023 | C — financial and plan section models | No | P8 |
| R-019, R-020 | D — sector and priority-group Custom Fields on Loan Application | No | P1 |
| R-021 | F + D — stop calling `doc.submit()` at insert; draft is `docstatus 0`, native to Frappe | No | `api.py:276-277` |
| R-024, R-025 | F — validate against the config ceiling | No | P1 |
| R-026, R-035 | F + D — withdraw and information-request outcomes | No | P2 |
| R-027–R-033 | C — evidence doctype over Frappe File, with provenance | No | P8 |
| R-036 | C — Frappe Notification on status change | No | P8 |
| R-037 | **F — a field whitelist in `_portal_dict`.** One function | No | live leak |
| R-038–R-041, R-043 | — passing | No | full offer lifecycle ran |
| R-042, R-044, R-045 | C — countersignature, expiry job, download route | No | P8 |
| R-046 | F — drop stored fields from the payload (see R-145) | No | P9, P11 |
| R-047 | — passing | No | repayment reflected immediately |
| R-048, R-049 | C — statements and cross-facility history folded from the ledger | No | P9 |

### C3 — Field and regional capabilities

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-050 | **D — one `add_permission` line for `Loan Lead`** | No | P3 |
| R-051, R-054, R-055 | C — on-behalf-of application, site visit doctype | No | P8 |
| R-052 | C + D — per-entry officer attribution | No | P1 |
| R-053 | D + H — User Permission plus the query hook already in use | No | P4 |
| R-056 | H — validation blocking officer edits to declared answers | No | P5, P6 |

### C4 — Group and capability building

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-063, R-064, R-065, R-072 | F — extend the existing cluster code | No | P8 |
| R-066 | **F — stop returning other members' fields from `cluster_view`.** One function | No | live leak |
| R-067, R-069, R-070, R-071 | C — exit flow, facilitator routing, sectioned plan | No | P8 |
| R-068 | — passing | No | citizen created a cluster |
| R-073–R-079 | A + C — Coursera adapter and training records | No | P8 |

### C5 — Verification and assessment

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-080, R-082–R-085 | A — My Guyana, GRA, NIS, bureau, sanctions adapters | No | P12 |
| R-081, R-086 | — passing (sandbox) | No | live DCRA + bank lookups |
| R-087, R-091–R-099 | C — UBO model, assessment, benchmarks | No | P8 |
| R-088, R-089, R-090 | C — check register doctype; unavailable is a stored result, never a pass | No | P8 |

### C6 — Credit decisioning

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-100, R-109 | F — queue completeness and cluster context | No | — |
| R-101, R-103, R-104, R-113 | C + D — assignment, ownership lock, timers | No | P8, P1 |
| R-102 | D — queue states | No | P2 |
| R-105–R-108, R-118–R-120 | C + D — case workspace, specialist input and its role | No | P8, P3 |
| R-110 | **D — Property Setter, proven live** | No | **P2** |
| R-111, R-112 | **F — require rationale; validate the amount.** Two validations | No | live: approved with no remarks, G$99M |
| R-114 | H + C — reject any decision write not made by a human session | No | P5, P6 |
| R-115 | C — submittable `GDB Credit Decision`; corrections are new linked docs | No | P8 |
| R-116 | D — Workflow Transition `conditions` / `allowed` | No | live field list |
| R-117 | A — e-signature via My Guyana | No | P12 |

### C7 — Money movement

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-121, R-125, R-128, R-133, R-139 | F — derive from config, re-derive at release, check the account, reconcile, use cancel+amend | No | P8 |
| R-122, R-123, R-124, R-126, R-129, R-137, R-138 | — passing | No | conditions blocked disbursement twice |
| R-127, R-131 | **D + F — a Disbursement Officer role plus "releaser ≠ decider"** | No | P3; live G$99M single-actor path |
| R-130, R-132, R-134–R-136, R-141, R-142 | C — receipt confirmation, training re-check, exception queue, invoices | No | P8 |
| R-140 | A — bank channel adapters | No | P12 |

### C8 — Servicing

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-143, R-146, R-149 | — passing, natively | No | submittable ledger; zero-rate branch; 3 retained schedules |
| R-144 | F — fold the ledger, stop shipping stored fields | No | P9 |
| R-145 | **X — lending writes balances regardless. Option A (derive and ignore) needs no core edit; only a fork would** | No, under Option A | **P11** |
| R-147 | **X + D — stop the classification job, compute at query time** | No | P7, P11 |
| R-148, R-150 | C — statements, closure | No | P9 |

### C9 — Product, portfolio and governance

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-151, R-152, R-154 | C — versioned configuration doctype with effective dates | No | P8 |
| R-153 | I — CI grep gate | No | — |
| R-155 | D — Finance Department role owns config writes | No | P3 |
| R-156–R-168 | C — portfolio and governance reports | No | P8, P9 |

### C10 — Common and platform

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-169, R-211 | I — token auth or a second hostname | No | token auth present in `frappe.auth` |
| R-170 | — passing | No | **P4** |
| R-171, R-212 | D + H — region/sector User Permissions on the existing hooks | No | P4 |
| R-172 | F — split applicant and staff method namespaces | No | — |
| R-173, R-174 | C + H — audit doctype written from `doc_events`; stop using `db_set` for state | No | P5, P8 |
| R-175 | **I — unachievable in app code; patching frappe would not fix it** | No | **P10** |
| R-176, R-178, R-179, R-182, R-183 | C — notifications, adapter base class with health and sandbox, retention | No | P8 |
| R-177 | I — volume/DB encryption | No | — |
| R-180, R-181 | D — Frappe user administration; Platform Admin role denied case data | No | P3 |
| R-184, R-185 | F — staff surfaces stay in the SPA; GYD formatting | No | — |

### CA — AI services (Phase 2)

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-186–R-202 | C + A — assistive services behind the same adapter contract; the decision field stays one no AI can write | No | P6, P8 |

### CI — Identity and access

| ID | Mechanism | Core edit | Proof |
|---|---|---|---|
| R-203, R-204, R-205, R-208, R-210 | C + A — GUIN/RIDN resolution, fallback, upgrade, consent, assisted capture | No | P12, P8 |
| R-206, R-207, R-209 | — passing | No | no CAN used; adapter-shaped; only lookup keys leave |
| R-211 | I — see R-169 | No | — |
| R-212 | D + H | No | P4 |

## The precise answer

| | |
|---|---|
| Requirements needing a **frappe / erpnext / lending source edit** | **0 of 204** |
| Blocked by lending's design (architectural choice, not a patch) | **2** — R-145, R-147 |
| Closed by **fixing existing gdb_bank code** | ~30, including every disclosure and control failure found |
| Closed by **config/data** (no code at all) | ~20, including the four decision outcomes and all nine roles |
| Closed by **new custom code** in gdb_bank | ~110 |
| Closed by **adapters** to external systems | ~20 |
| **Infra/CI, not application code** | 7 — R-153, R-169, R-175, R-177, R-183, R-188, R-211 |

The two most severe findings — one account disbursing G$99,000,000 unaided
(R-131) and underwriting notes reaching the applicant (R-037) — are **both fixed
inside `gdb_bank`**, in a validation and a field whitelist. Neither is a platform
limitation.

The single case where a core edit could ever become necessary is R-145 under its
strictest reading *while keeping lending for servicing*. Even then the answer is
to fork the pinned app in `backend/Dockerfile` — never to edit files in place.
