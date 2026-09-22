# Guyana Development Bank citizen loan portal — project instructions

ERPNext (v16, MariaDB + Redis) is the backend via the `gdb_bank` custom Frappe
app; a React SPA (`frontend/`) is the citizen portal with a role-gated
underwriter review queue. The official name everywhere is
**Guyana Development Bank (GDB)**.

## Working agreements

- Commit at every working logic state; conventional-commit subjects.
- Never `git push` unless explicitly asked.
- Docker Hub images follow the MPS-Guyana convention: one repo
  `ravinadh/ksquarenis`, tags `gdb<run>`/`gdb-latest` (frontend) and
  `gdb-backend<run>`/`gdb-backend-latest` (backend), pushed by CI using the
  `DOCKERHUB_TOKEN` repo secret.

## Architecture facts

- **Four services total**: mariadb, redis (cache `/0`, queue `/1`), backend,
  frontend. The backend container is self-contained: `start-backend.sh`
  bootstraps the site under a flock on the shared sites volume (replica-safe),
  then runs gunicorn (loopback :8000) + worker + scheduler behind the image's
  own nginx on **:8080**, which also serves the ERPNext desk UI.
- Loans are the **official frappe/lending app's Loan Application** doctype
  (`ACC-LOAP-…`), pinned at v16.5.0 in `backend/Dockerfile`. Portal-only facts
  ride gdb_* Custom Fields (install.CUSTOM_FIELDS) and `gdb_bank/api.py` maps
  the stable portal contract (purpose/term_months/status
  Draft|Submitted|Approved|Rejected) onto it; lending's `Open` = portal
  `Submitted`, and portal `Draft` is `docstatus 0` — lending has no status for
  an application nobody has made yet. Status changes happen ONLY in
  `review_loan` via `db_set` (docs are submitted; status is permlevel 1).
- gdb_bank owns **six doctypes** of its own, all for things lending does not
  model: `GDB Cluster` + `GDB Cluster Member`, `GDB Loan Offer`,
  `GDB Loan Condition`, `GDB Applicant Document`, `GDB Information Request`
  and `GDB Citizen Profile`.
- **Evidence** (`gdb_bank/documents.py`): an application is decided on typed
  PDFs. The shelf row is created FIRST (`new_document`), the file then goes
  through **Frappe's own** `POST /api/method/upload_file` against that row, and
  `confirm_document` stamps it. That order is load-bearing:
  `File.has_permission` delegates a private file's access to the doc it is
  attached to, so the row is what makes the PDF readable by the applicant and
  by staff and by nobody else. Format and size are enforced in a
  `File.before_insert` hook, so they hold for any caller. Personal documents
  (Identity, Proof of Address) carry no `application` and follow the person.
  nginx and vite both proxy `/private/files/` — without that the SPA cannot
  open an upload.
- **Applying is two phases.** `save_application` writes a draft the applicant
  attaches to and can resume; `submit_application` puts it before the Bank.
  **Documents are OPTIONAL at submission** — nothing on the shelf gates the
  call. `documents.required_types` (Identity always, plus Financials for an
  existing business or Business Plan for a new one) is now advisory: it drives
  the shelf prompt and the `missing` array, and what is still outstanding is
  written to the submit log line so a thin file is visible as a fact, not just
  on a screen. Chasing paperwork is the underwriter's job via
  `request_information`. `apply_loan` is still the published one-shot
  contract — the two steps back to back.
- Seeded lending masters (`install.ensure_lending_defaults`): Loan Product
  "GDB Standard Loan" (GDB-STD, **0% term loan** — GDB lends interest-free) +
  "GDB Standard Offset Order" demand offset order wired into the Company.
  The product is INSERTED with `rate_of_interest: 8.0` and then forced to 0 by
  `install.ensure_product_terms` on EVERY migrate, so 8.0 is never the live
  rate on any site — read the rate there, not at the insert. Leaving it at 8
  would make lending compute interest into every schedule and show citizens
  interest they will never be charged. `maximum_loan_amount: 0` means NO
  ceiling in lending, not zero allowed — nothing overrides it the way the rate
  is overridden, and that is the uncapped amount behind R-131. Loan accounting
  is **ENABLED** on the company by `install.ensure_loan_accounting`, which sets
  `enable_loan_accounting: 1` and creates the ~16 GL accounts lending then
  makes mandatory on the product (`LOAN_ACCOUNT_SPECS`). Disbursements and
  repayments post real GL entries; without those accounts every accounting
  hook is an early `return` and money moves while the ledger stays silent.
- All portal APIs are whitelisted methods in `gdb_bank/api.py`
  (`/api/method/gdb_bank.api.*`); auth is the Frappe session cookie from
  `/api/method/login`. The site runs with `ignore_csrf: 1` because the SPA
  never receives a Frappe-rendered CSRF token — nginx keeps `/api` same-origin.
- **TWO WAYS IN, both ending in the same `sid` session** — so nothing
  downstream of `whoami` knows or cares which was used:
  - **e-ID + password** → `gdb_bank/identity.py`: the Keycloak password grant
    with the e-ID AS the username, confirmed against Keycloak's `userinfo`,
    then `login_manager.login_as()`. The e-ID shape (3-4-4, eleven digits,
    dashes included) is stated in exactly two places that must agree —
    `identity.py` and `frontend/src/eid.ts`. Tokens are used once and dropped;
    Keycloak logout does NOT kill `sid`.
    First sign-in **links** the e-ID to an existing User with the same email,
    or **provisions** a Website User with `Citizen`. It also records the
    Keycloak claims as the *verified* half of `GDB Citizen Profile`
    (`profiles.record_identity_claims`) — kept apart from what the applicant
    declares, never merged, because where the two disagree is exactly the case
    a human should look at. **Roles never come from
    Keycloak** — staff access stays a manual Frappe grant. Disabling the
    Frappe User is the kill switch and works even while Keycloak still
    authenticates. Rate-limited 8/min per e-ID (Frappe's own
    `track_login_attempts` guards `/api/method/login`, which this never hits).
  - **email + password** → Frappe's own login, untouched and still the path
    the seeded demo users take. Retiring it (`disable_user_pass_login`) is a
    later, separate decision — and Frappe refuses that switch until a Social
    Login Key or LDAP exists, which this ROPC path is not.
  - ⚠️ This authenticates an e-ID somebody **provisioned**; it does not prove
    the person typing it is the person it names. An e-ID is an identifier, not
    a secret. Real proofing is the My Guyana broker in
    `docs/architecture/identity-and-auth.md`, which supersedes this path.
- **Roles — three, and the split between the two staff ones is a control.**
  `Citizen` (website user; own applications only), `Loan Underwriter` (decides:
  review, offer, conditions, document review) and `Finance Officer`
  (moves money: booking, disbursement, payment file, collections, the ledger
  views). **Booking is the money side's, not the underwriter's** —
  `book_loan` is `_require_disbursement`, because creating the Loan is what
  puts the facility on GDB's books and everything after it is a drawdown.
  That third persona is called the **Disbursement Officer** everywhere a human
  reads it — the badge, the seeded user's name, the refusal messages. The
  Frappe Role is still named `Finance Officer` and so are `FINANCE_ROLES` /
  `_require_finance`; renaming the Role itself needs a `rename_doc` patch or
  existing sites lose the grant, so it has deliberately not been done.
  Enforcement is server-side in `api.py` (`_require_underwriter`,
  `_require_finance`), mirrored in the SPA (`is_underwriter` / `is_finance`
  from `whoami`). `disburse_loan` carries a SECOND gate on top of the role —
  it refuses the officer who approved the case and the officer who owns it —
  because one account can hold both roles and R-131 was proven end to end on
  this stack: a single login carried an application from decision to
  G$99,000,000 disbursed. `install.REVOKED_MONEY_ROLES` takes the money
  surfaces back off the underwriter on migrate, since a permission already
  written to a site is not undone by ceasing to ask for it.
- `make_repayment` is the BORROWER's (or a cluster member's). Staff are
  refused: bank-side receipts go through `collections.apply_receipt`, which
  starts from a Bank Transaction — i.e. from money that actually arrived.
- Staff identify an applicant by **e-ID, never by mailbox** — `_portal_dict`
  carries `applicant_eid`, and the review queue, the case header and the
  cluster roster all show it.
- **Clusters**: the head INVITES an e-ID (`invite_member`), and the invitee
  accepts (`respond_to_invitation`) signed in as themselves. An e-ID with no
  portal account yet is a valid invitee — the row waits against the bare e-ID
  and `identity.link_pending_invitations` attaches it on their first e-ID
  sign-in. `_cluster_of` counts Active rows only. Each member holds their own
  `GDB Citizen Profile` and their own documents; members never see each
  other's, staff see both blocks of everyone's.
- **A cluster loan is a different product, never a side effect of membership.**
  `_cluster_for` files against a group ONLY when the caller names it: both `""`
  and an omitted `cluster` mean the applicant's own application. Naming one
  still requires Active membership AND being the head, so a plain member's loan
  can never become the group's — not through the SPA, not through `apply_loan`,
  not through a client that forgets the field.
- ERPNext does not run on Postgres. MariaDB 11.8 + one Redis are part of
  every environment.

## Local stack

`docker compose up -d --build` → mariadb, redis, backend (first boot takes
minutes: new-site + erpnext + lending + gdb_bank + wizard + seeds; watch
`logs -f backend`; seeds demo users `citizen@example.gy`,
`underwriter@gdb.gov.gy` and `finance@gdb.gov.gy`, password =
`ADMIN_PASSWORD`, default `admin` — seeding runs on EVERY boot, not only at
site creation, or a persona added later never appears on an existing site),
keycloak :8086, frontend nginx :3000; desk at :8080. Frontend dev loop:
`npm run dev` in `frontend/` → vite :5173 proxying `/api` to :8080. After
backend app changes: `docker compose up -d --build backend` (restart runs
migrate + seeds again). `localhost` cookies are shared across ports 3000/8080
— log out of one before logging into the other.

**Keycloak :8086** (admin/admin, realm `gdb-citizen`, auto-imported from
`keycloak/gdb-realm.json`). e-ID accounts, password `ChangeMe@123`:
`592-1111-0001` (links to the seeded citizen), `592-2222-0002` (links to the
underwriter), `592-5555-0005` (links to the finance officer), `592-3333-0003`
(provisions a new citizen — but ONLY on a site where it has never signed in;
once provisioned it links to that User like the rest, so testing the
provisioning path needs a fresh site or an unused e-ID). **8086, not 8085** —
the sibling MPS-Guyana stack holds 8085 and both run on this machine.
Keycloak imports a realm ONLY if it does not already exist, so editing the
realm JSON needs `docker compose rm -sf keycloak && docker volume rm
guyana-development-bank_keycloak-data` first — see `keycloak/README.md`, which
also records the four settings that are load-bearing (every user needs an
email; `temporary: false` on credentials; `directAccessGrantsEnabled`;
`loginWithEmailAllowed: false`).

## After every task

Frontend gates: `npm run typecheck && npm run build` in `frontend/`.
Backend sanity: `docker compose up -d --build backend`, wait for
`Site … ready`, then exercise an endpoint (login + `gdb_bank.api.whoami`).

---

## Enterprise Architecture & Coding Standards

> **CORE PRINCIPLE:** The frontend is an untrusted client. The backend is the enforcement boundary. Every financial state transition must be authorized, validated, auditable, idempotent where applicable, and executed within a well-defined consistency boundary.

### 1. Frontend Architecture & State
* **Structural Taxonomy:** Maintain a strict separation of concerns beyond just "features".
  * `entities/`: Domain models and types (Applicant, Loan, Business).
  * `features/`: Business capabilities (Applications, Finance, Identity).
  * `widgets/`: Complex assembled UI (Application Summary, Navigation).
  * `shared/`: Generic UI (Buttons, Cards), base API wrappers, configuration.
* **Component Responsibility:** Component quality is measured by responsibility, state ownership, and testability—not strictly by line count. 
* **State Boundaries:** Do not duplicate server state in client state.
  * **React Query:** Owns server state (loan status, profiles, documents).
  * **Zustand:** Owns temporary UI/workflow state (current wizard step, themes).
  * **React Hook Form + Zod:** Use for complex wizards/forms. Do not dump every keystroke into Zustand.
* **Client-Side Security:** NEVER store PII or sensitive financial data in `localStorage`, `sessionStorage`, `IndexedDB`, or URL query parameters (e.g., `?nin=123`). Do not send PII to analytics or `console.log`.

### 2. Backend Architecture & Frappe Rules
* **Layered Boundaries:** Separate concerns into API Controllers (routing, payload parsing), Services/Use Cases (business logic, transaction boundaries), and Repositories (complex Frappe ORM queries).
* **Security vs. Domain:** Authorization policies (e.g., `_require_underwriter`) belong in `security/` or `infrastructure/` modules, not in core business `domain/` modules.
* **Frappe Lifecycle (`doc.save` vs `db_set`):**
  * **Business State:** ALWAYS use `doc.save()` or a controlled domain method. This guarantees Frappe's audit logging, validation, and webhooks fire.
  * **System State:** `doc.db_set()` bypasses validation and audit hooks. It is ONLY allowed for exceptional, non-business operational updates (e.g., `last_seen`, `processing_lock`).
* **Raw SQL:** Raw SQL writes to business data are strictly prohibited. Raw SQL reads are allowed only when the ORM is inefficient, but they require strict parameterization, review, and least-privilege access.

### 3. Financial Controls & Integrity
* **Idempotency (Mandatory):** All state-changing financial APIs (submit, approve, disburse, repay) must enforce idempotency using an `Idempotency-Key` header to prevent duplicate transactions on network retries.
* **Separation of Duties (Maker ≠ Checker):** The person who creates or reviews an application cannot be the same person who approves or disburses it. This must be structurally enforced by the backend.
* **Server-Side Drafts:** Form drafts must use server-side persistence with **Optimistic Concurrency** (e.g., `If-Match: 17`) to prevent race conditions if an applicant has multiple tabs open.
* **External API Resilience:** Government APIs (e.g., DCRA) must be wrapped in timeouts, retries, and circuit breakers. An external API timeout must yield a `VERIFICATION_PENDING` state for manual review, never a business rejection.

### 4. Security & Authentication
* **Authentication:** Transition to OIDC Authorization Code Flow with PKCE. Strongly consider a **BFF (Backend For Frontend)** to handle token management, CSRF, and rate limiting, keeping access tokens completely out of the browser.
* **Authorization (Prevent BOLA/IDOR):** Never trust client-supplied IDs. `GET /applications/123` must strictly verify that the authenticated user owns or has role-based access to resource `123`.
* **Document Security:** Never trust user-supplied filenames. Enforce MIME type validation (magic numbers), strict size limits, virus scanning, and authorized signed URLs for downloads.

### 5. Observability & Auditing
* **Technical Logs vs. Business Audit:** 
  * *Technical logs* capture API requests, latency, and errors using Request IDs. **Do not log PII.**
  * *Business audit trails* must be tamper-resistant and capture: *Who? What changed? Old value? New value? When? Why? Which workflow transition?*
* **Error Taxonomy:** Never expose stack traces, SQL queries, or Keycloak internals to the frontend. Use standardized error payloads (e.g., `{"code": "LOAN_INVALID_STATE"}`) mapped to appropriate HTTP status codes (400, 401, 403, 404, 409, 422).

### 6. Forbidden Patterns
**DO NOT:**
* Put business logic in React components.
* Trust frontend roles for backend authorization.
* Store PII in client storage or URLs.
* Expose stack traces or internal DB hostnames.
* Perform raw SQL business writes.
* Bypass workflow transitions or use `db_set` for business data.
* Hardcode secrets or commit `.env` files.
* Perform non-idempotent financial operations.
* Call external APIs without timeouts.
* Silently swallow exceptions.
 Dev_V3