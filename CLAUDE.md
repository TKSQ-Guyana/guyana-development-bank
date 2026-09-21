
## Enterprise Architecture & Coding Standards

> **Before touching the sign-in or sign-out path, `security/errors.py` or
> anything Keycloak:** read
> [`docs/developer/record_2026-09-22_auth_audit.md`](docs/developer/record_2026-09-22_auth_audit.md)
> §3. Three defects there were invisible from the source and would not have
> failed a test — the error taxonomy's 401/403 arrived as 417 for months, and
> logout left the Keycloak session alive for anyone who abandoned a
> confirmation page. The flow is verified end to end in §2; do not re-derive
> it.
>
> **Before touching `rbac/provisioning.py`:** read
> [`docs/developer/record_2026-09-21_signin.md`](docs/developer/record_2026-09-21_signin.md) §2 and §3.
> Four defects there were invisible from reading the code — including a
> `provisioning.py` that had never run to completion, so no persona role had
> ever reached a database, and a lock-file deadlock that crash-looped the
> backend 33 times while looking like a slow migration. The Frappe v16 and
> Keycloak 26 facts in §3 are verified; do not re-derive them.
>
> **Current state of the build:** [`docs/developer/implementation_record.md`](docs/developer/implementation_record.md)
> — what exists, what does not, and the Frappe v16 facts already verified
> (do not re-derive them). The Phase 2 case-file decision is now resolved.
>
> **Roles are registry-driven.** `backend/apps/gdb_bank/gdb_bank/rbac/personas.py`
> is the single source of truth; Frappe roles, DocType permissions, row-level
> scoping, Keycloak realm roles and the SPA's capability constants are all
> derived from it. Adding a role is a data edit there plus `bench migrate` —
> never hand-wire one. Runbook: [`docs/developer/personas.md`](docs/developer/personas.md).
>
> **Authorize on capabilities, not role names.** Guard services with
> `@require(cap.X)`. A literal role-name comparison in `services/` or `api/` is
> a bug: it is the coupling that makes adding a persona a codebase-wide edit.

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
* **Separation of Duties (Maker ≠ Checker):** The person who creates or reviews an application cannot be the same person who approves or disburses it. This must be structurally enforced by the backend using Frappe's native Workflow Engine and Roles.
* **Server-Side Drafts:** Form drafts must use server-side persistence with **Optimistic Concurrency** (e.g., `If-Match: 17`) to prevent race conditions if an applicant has multiple tabs open.
* **External API Resilience:** Government APIs (e.g., DCRA) must be wrapped in timeouts, retries, and circuit breakers. An external API timeout must yield a `VERIFICATION_PENDING` state for manual review, never a business rejection.

### 4. Security & Authentication
* **Authentication:** Use OIDC Authorization Code Flow with PKCE via Frappe's Social Login integration (Keycloak).
* **CSRF — `SameSite=Lax` on `sid` IS the control. Do not weaken it.** The API
  takes no CSRF token: a form-encoded, token-less `POST /api/method/...` with a
  valid session cookie is accepted (verified against the running stack,
  2026-09-22). What stops that being a cross-site request forgery is the one
  attribute `SameSite=Lax` on the Frappe `sid` cookie, which withholds it from
  cross-site POSTs. That makes the attribute load-bearing rather than
  incidental: setting `SameSite=None` — for an iframe embed, a cross-domain
  portal, a payment provider's callback — removes the ONLY thing standing
  between a session cookie and a forged state change, and nothing in the test
  suite would fail. If it ever has to change, a real CSRF token must land in
  the same commit; `errors.py` already gives the SPA a machine-readable code
  to branch on. Also keep `sid` `HttpOnly` — it is what keeps the session out
  of reach of any XSS.
* **Role Management & Permissions (CRITICAL):** You MUST use Frappe's inbuilt Role Management (Role Profiles, Permission Manager, User Permissions) for each persona (Citizen, Underwriter, Manager).
  * **Role-Based Access Control (RBAC):** Define Document-level permissions in the Frappe DocType via the "Permissions" table. Do not reinvent authorization logic in Python if the Permission Manager can handle it.
  * **User Permissions (Row-Level Security):** Ensure that a Citizen can only see their own applications by leveraging Frappe's User Permissions or `has_permission` hooks, preventing BOLA/IDOR vulnerabilities.
  * **Authorization Validation:** Never trust client-supplied IDs. Even if RBAC allows access to a DocType, ensure the specific document ID (`GET /applications/123`) belongs to the authenticated user or their authorized subset.
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
* Reinvent role management; always use Frappe's inbuilt Role Profiles and Permission Manager.
* Store PII in client storage or URLs.
* Expose stack traces or internal DB hostnames.
* Perform raw SQL business writes.
* Bypass Frappe Workflow transitions or use `db_set` for business data.
* Hardcode secrets or commit `.env` files.
* Perform non-idempotent financial operations.
* Call external APIs without timeouts.
* Silently swallow exceptions.