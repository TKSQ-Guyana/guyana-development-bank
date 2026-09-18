# GDB lending platform — delivery plan

Ordered walk through the functional scope register, capability by capability, in
register order (C1 → C10, then CI, then CA). One step at a time: confirm the
slice, build it, run the gates, commit, tick it here, move on.

- **Requirements source**: `General Overview/GDB Lending Application - Functional
  Scope & Requirements.docx` — §2.4 index and §10.2 register (extracted text in
  `docx_utf8.txt`). 35 features, R-001 … R-212.
- **Build rules**: `plan.md` (Frappe-only backend, no second database, external
  systems behind Frappe-side adapters, no Phase 2 AI in Phase 1).
- **Phase 1** is the MVP under this SOW; **Phase 2** is the follow-on engagement.
  Of 210 register rows, 176 are Phase 1 and 34 are Phase 2.

## How we work each step

1. Confirm the slice — read the current code for that capability and record what
   actually exists. The status notes below are a function-level inventory taken
   on 2026-09-15, not a line-by-line audit.
2. Build it, smallest working increment first.
3. Gates (from `CLAUDE.md`): `npm run typecheck && npm run build` in `frontend/`;
   `docker compose up -d --build backend`, wait for `Site … ready`, then exercise
   the endpoints (login + the new method). Swagger UI at
   `http://localhost:3000/api-docs.html` is the manual harness.
4. Conventional commit at every working logic state.
5. Tick the step in the progress table, with the requirement IDs actually closed.

## Register defects to resolve with the client

Found while transcribing — each needs an answer before its step:

| # | Issue |
|---|---|
| D-1 | R-006 and R-007 (F1.2 *Indicative eligibility*) appear in the §2.4 index but have **no rows** in the §10.2 register. Register holds 210 rows; the index totals 212. |
| D-2 | §2.4 calls F1.2 *Indicative eligibility* and F1.3 *Registration and identity*; the register labels R-008–R-014 as **F1.2** Registration and identity. The numbering disagrees. |
| D-3 | C7 jumps F7.1 → F7.4; F7.2 and F7.3 exist in neither index nor register. R-125–R-132 (release authorization, disbursement execution) sit under "F7.1 Conditions". |
| D-4 | §2.4 gives F9.1 Configuration as R-151–R-163 (13); in the register, F9.1 covers R-151–R-155 (configuration) and then R-156–R-163, which are portfolio reporting, under no separate heading. |
| D-5 | R-042 (bank countersignature in platform) and R-117 (e-signature via My Guyana) must agree on what constitutes the executed instrument. |

## Where the build stands today

Verified inventory, 2026-09-15 — names and shapes only; behaviour is confirmed
per step:

- **Backend** `gdb_bank` over frappe/lending 16.5.0:
  - `api.py` — signup, whoami, apply_loan, my_loans, loan_detail, all_loans,
    review_loan, convert_lead, create_cluster, invite_member, save_plan,
    my_cluster, cluster_view, loan_account, repayment_plan, make_repayment,
    book_loan, disburse_loan, bank_options, my_bank_details, save_bank_details,
    my_bank_accounts, verify_bank_account, dcra_lookup, my_businesses, my_business
  - `offers.py` — issue_offer, my_offer, accept_offer, decline_offer, accepted_offer
  - `conditions.py` — list_conditions, verify_condition, raise_for_offer, outstanding
  - `collections.py` — unreconciled_receipts, suggest_loans, apply_receipt
  - `identity.py` — Keycloak e-ID password grant (stand-in for My Guyana)
  - `integrations/` — bank_registry.py, dcra.py
  - doctypes — gdb_cluster, gdb_cluster_member, gdb_loan_condition, gdb_loan_offer
- **Frontend** — pages Login, Signup, MyLoans, Apply, Cluster, LoanDetail, Review,
  Finance, Disbursements; components Collections, Conditions, Disbursement,
  EidBoxes, IssueOffer, Layout, LoanAccount, OfferPanel, PaymentFile, StatusBadge.
- **Roles** — `Citizen` and `Loan Underwriter` (+ System Manager). The scope needs
  **nine** personas, PR-01 … PR-09.
- **Docs** — `CLAUDE.md` still states gdb_bank has no doctype of its own; four now
  exist. Correct it in Step 1.

## Step order

Register order is the spine. Two foundations are pulled forward because C1 and C2
cannot be built correctly without them; nothing else is reordered.

| Step | Capability | Requirements | Phase |
|---|---|---|---|
| 0 | Traceability scaffolding | — | 1 |
| 1 | C1 Channel and access (+ pulled-forward config, roles, audit) | R-001–R-014 | 1 |
| 2 | C2 Applicant capabilities | R-015–R-049 | 1 (R-032 → 2) |
| 3 | C3 Field and regional capabilities | R-050–R-062 | 1 |
| 4 | C4 Group and capability building | R-063–R-079 | 1 (R-076 → 2) |
| 5 | C5 Verification and assessment | R-080–R-099 | 1 |
| 6 | C6 Credit decisioning | R-100–R-120 | 1 |
| 7 | C7 Money movement | R-121–R-142 | 1 |
| 8 | C8 Servicing | R-143–R-150 | 1 |
| 9 | C9 Product, portfolio and governance | R-151–R-168 | 1 / 2 |
| 10 | C10 Common and platform | R-169–R-185 | 1 (R-183 → 2) |
| 11 | CI Identity and access (sweep) | R-203–R-212 | 1 (R-205 → 2) |
| 12 | CA AI services | R-186–R-202 | 2 |
| 13 | End-to-end integration testing and release gates | — | 1 |

---

## Step 0 — Traceability scaffolding

**Build**: transcribe the §10.2 register into `docs/requirements.md` — 210 rows,
one table per feature, IDs and text verbatim; add a traceability matrix mapping
each R-ID to the doctype / endpoint / UI / test that satisfies it, empty to start.

**Done when**: every R-ID resolves to a matrix row, and D-1 … D-5 are logged for
the client.

## Step 1 — C1 Channel and access · R-001–R-014

**Pulled forward** as dependencies, not scope creep: R-151–R-155 configuration,
because R-001 and R-152 require program terms to come from configuration and
R-153 fails the build if a policy figure is hard-coded; R-169–R-175 roles and
audit, because every later step writes audit events and needs the nine-persona
role model.

**Build**
- Program configuration: ceiling per product (SME Direct G$3,000,000, Quick Loan
  G$300,000), 0% interest, term bounds, sector list including the "other — value
  creation" route, priority groups, prerequisites — versioned with author,
  timestamp and effective date, writable only by Finance Department.
- Public program pages reading that configuration; readiness checklist; sector
  and priority-group explanations; usable rendering on low-bandwidth mobile.
- Person record keyed on GUIN/RIDN, never a Document Number or CAN; duplicate
  prevention; national-ID fallback flagged for upgrade; versioned consent
  capture; agent-assisted registration recording who performed it.
- Nine roles (PR-01 … PR-09) with region and sector scoping enforced server-side.
- An audit event on every state change, append-only.

**Done when**: no policy figure appears in frontend or backend source (grep gate
in CI); a citizen registering through the identity adapter yields exactly one
person record; every write in this step leaves an audit row.

## Step 2 — C2 Applicant capabilities · R-015–R-049

**Build**: branch by existing business vs new venture; financial sections and plan
sections (vision, mission, goals, customer segments, target market and ecosystem,
operations, team, strategy); section-level save and resume with no data loss;
progress and outstanding indicators; ask-once reuse; ceiling validation with a
plain explanation; submission blocked until required sections, evidence and
training are present; applicant withdrawal before decision.
Evidence: typed upload (financials, plan, identity, proof of address, other),
document shelf with per-item status, type and size limits with clear errors,
provenance, replacement during the application.
Tracking: plain-language status with what happens next, itemized information
requests, notifications on status change, and no assessment score, compliance
result or underwriting note in any applicant-facing response.
Offer: Letter of Offer generated from the recorded decision with no re-entry of
terms; one authoritative document for staff and applicant; in-platform acceptance
with timestamp and identity binding as the execution record; decline with reason;
expiry recorded as a lapse; borrower download for the life of the facility.
Self-service: balance, next instalment and schedule from the ledger, repayment
reflected immediately, statement for any period, history across all facilities.

**Depends on**: Step 1 configuration and roles. R-032 is Phase 2.

**Done when**: an application survives a mid-way logout with no data loss; a test
asserts no underwriting field reaches an applicant response; offer terms in the
document equal the decision record to the cent.

## Step 3 — C3 Field and regional capabilities · R-050–R-062

**Build**: lead creation and conversion to a registered applicant;
agent-assisted application with the applicant's recorded consent; attribution of
every officer-captured entry; visibility bounded to the officer's region and
assigned cases; structured site visit (date, location, observations,
photographic evidence) attached as officer-observed evidence; a block on officers
altering an applicant's own declared answers.

**First**: F3.3 Offline operation (R-057–R-059) and F3.4 Monitoring
(R-060–R-062) are in the register but were not in the brief pasted into the
session — read their text in Step 0 before scoping this step.

## Step 4 — C4 Group and capability building · R-063–R-079

**Build**: cluster with name, region, sector, owning cluster head and optional
facilitator; members added by identifier lookup and invited when unregistered;
member status (invited, active, exited) with dates; strict isolation of member
financial data; exit that invalidates no other member's application or facility;
applicant-created clusters; facilitator support requests routed by region.
Shared plan with clearly separated shared and member-owned sections, head and
facilitator editing shared sections only, and plan changes that never alter an
application, assessment, decision or offer.
Coursera: required modules configured per sector and product; enrolment and
completion recorded per applicant from the Coursera API; completion surfaced on
the profile module by module with dates, gating submission and disbursement;
curriculum managed through the API, authored and approved by the Ministry;
external government programs signposted with provenance and last-verified date.
R-076 (training reach reporting) is Phase 2.

**Existing**: clusters and the shared plan are partly built — confirm isolation
(R-066) and the no-side-effect rule (R-072) before extending.

## Step 5 — C5 Verification and assessment · R-080–R-099

**Build**: adapters for business registry, GRA tax compliance via My Guyana,
social insurance, credit bureau, sanctions/PEP and adverse media, bank account
verification, and directors and beneficial owners — not the business alone.
Every check recorded with source, timestamp, result and reference; **unavailable
recorded as unavailable, never as a pass**, and never blocking progress to human
review; re-run on demand retaining the prior result.
Assessment: repayment capacity for existing businesses from evidenced financials;
plan readiness for new ventures; evidenced figures ranked above self-declared;
consumed inputs recorded and the assessment invalidated when they change; the
configured ceiling applied at assessment time; never presented as a decision or a
recommendation to approve. Sector benchmark data maintained by a specialist and
surfaced attributed to author and date.

**Existing**: `verify_bank_account` and `dcra_lookup` — treat these as the
adapter pattern to follow, extended with health, timeout, retry, explicit
unavailability and sandbox mode (R-178, R-179).

## Step 6 — C6 Credit decisioning · R-100–R-120

**Build**: every submitted application enters the queue with no bypass;
assignment by configurable rules (region, sector, workload); grouping by working
state; a lock preventing action on another underwriter's case; queue age and
time-in-state. Case workspace presenting application, evidence, verification and
assessment together, organized by review stage, every displayed fact linked to
its source document, stage-level observations, cluster context without other
members' financials. Decision: four outcomes (approve, decline, refer, request
information); mandatory recorded rationale; approved amount validated against
ceiling and assessed capacity; deciding underwriter, timestamp and evidence state
recorded; **no automated or system-originated decision under any condition,
including AI failure**; immutable decisions with corrections as new linked
events; approval authority matrix by amount band; e-signature on the Letter of
Offer via the My Guyana mechanism, with the executed instrument retained.
Specialist input is attributed advice, never an outcome, with no decision access.

**Existing**: `review_loan` is a two-outcome approve/reject with optional
remarks — this step replaces it.

## Step 7 — C7 Money movement · R-121–R-142

**Build**: conditions derived from the decision and product configuration,
presented as an actionable checklist, each verified by staff with attribution and
timestamp; release blocked while any condition is unverified; entitlement and
authorizations re-derived at the point of release; refusal with a stated reason
when a precondition cannot be verified; explicit Disbursement Officer
authorization with no scheduled or automatic release; payment instruction only to
the verified nominated account; disbursement as an immutable ledger event with
instruction reference; borrower confirmation of receipt; **separation of duties —
the deciding underwriter cannot authorize release**; training re-verified module
by module at the pre-disbursement check, holding release on a regressed or
incomplete record without reopening the decision.
Reconciliation of each disbursement to the cent; an exception queue for failed,
returned and partial payments requiring explicit attributed resolution; a daily
reconciliation report. Repayments from Republic Bank, Demerara Bank and Bank of
Guyana recorded into the single ledger with configured allocation; reversal as a
new linked explained entry; manual payment invoices carrying a reference and
tracked from issue to settlement.

**Existing**: `gdb_loan_condition` with `conditions.py`, `disburse_loan`, and the
`collections.py` reconciliation helpers. Confirm separation of duties (R-131) and
the training re-check (R-132) first — both are likely gaps.

## Step 8 — C8 Servicing · R-143–R-150

**Build**: an append-only loan ledger, never updated or deleted; every balance,
arrears figure and statement derived by reading the ledger at read time; **no
stored balance, overdue flag or ageing bucket**; schedule generated from the
authorized terms with no interest component; days past due computed at query time
as the age of the oldest unpaid instalment; statements and any tax-facing report
from the same ledger fold as every other figure; authorized restructuring that
regenerates the schedule and retains the prior one; closure on full repayment
with full history retained.

**Check first**: frappe/lending stores balances and runs accrual and
classification processes. Establish whether lending's fields can be reconciled
with R-145 or whether a gdb-side derived read path is required — this decision
shapes the whole step.

## Step 9 — C9 Product, portfolio and governance · R-151–R-168

**Build**: the remainder of configuration beyond Step 1's pull-forward; portfolio
reporting (total disbursed, active facilities, principal outstanding, amounts due
and collected, collection efficiency); ageing across past-due bands excluding
not-yet-due amounts; **unfiltered table totals equal to headline figures to the
cent, proven by automated test**; filtering by date range, sector, region,
priority group and amount band; exports carrying their filter criteria in the
file and logged with user, timestamp, filters and row count; an "as at" timestamp
on every financial view; a read-only oversight role that refuses non-read
requests. Governance: capital deployed against allocated capital; reach by
sector, region and priority group; portfolio health at aggregate level only; no
individual case, credit, compliance or identity detail in governance views; a
periodic board reporting pack export. R-156–R-168 are Phase 2.

## Step 10 — C10 Common and platform · R-169–R-185

**Build**: separate applicant and staff authentication contexts, both active
independently; authorization enforced server-side at the API boundary; staff
access scoped by role, region and sector; disjoint applicant and staff API
surfaces returning only customer-safe fields to applicants; an audit event for
every state change with actor, action, target, timestamp and basis;
system-originated actions distinguished from human ones; an audit trail readable
but never editable, including by administrators; email and SMS only where
credentials are configured, never recording a send that did not occur;
access-controlled, encrypted document storage with retention metadata; one
adapter per external system with health, timeout, retry and explicit
unavailability; a sandbox mode per integration; account provisioning, scoping,
suspension and deactivation; a Platform Admin denied case evidence, credit
decisions and money movement; integration health and failure rates surfaced;
accessibility (semantic markup, keyboard operation, 4.5:1 contrast); GYD
formatting with no false precision. R-183 (retention and purge) is Phase 2.

## Step 11 — CI Identity and access sweep · R-203–R-212

Largely realized inside Steps 1 and 10 — this is the verification pass: the My
Guyana assertion resolved to GUIN or RIDN; national-ID registration accepted and
flagged for upgrade; upgrade without creating a duplicate person (Phase 2); never
keying on a Document Number or CAN; identity as an adapter so federated sign-in
can be added without a data model change; consent captured, versioned and
retained per external check; **no credit, compliance or underwriting content
transmitted to any external portal**; in-person assisted capture; session
separation; least-privilege scoping by role, region, sector and case assignment
at the API boundary.

**Open item**: the current Keycloak e-ID path authenticates an identifier, not a
person — `CLAUDE.md` records this, and R-080 says the platform performs no
identity verification of its own. Confirm the My Guyana broker contract before
this step can close.
---

## Progress

| Step | Status | Closed IDs | Notes |
|---|---|---|---|
| 0 | not started | — | |
| 1 | not started | — | |
| 2 | not started | — | |
| 3 | not started | — | |
| 4 | not started | — | |
| 5 | not started | — | |
| 6 | not started | — | |
| 7 | not started | — | |
| 8 | not started | — | |
| 9 | not started | — | |
| 10 | not started | — | |
| 11 | not started | — | |
| 12 | deferred (Phase 2) | — | |
| 13 | not started | — | |
