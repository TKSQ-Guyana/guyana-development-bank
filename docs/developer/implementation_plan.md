# GDB Enterprise Implementation Plan

> **READ FIRST: [`implementation_record.md`](implementation_record.md)** — what is
> already built, the Frappe v16 facts that shaped it, what is explicitly NOT
> built, and the one open decision that blocks Phase 2. This plan says what to
> build; that says where things actually stand.
>
> Role model: **[`personas.md`](personas.md)**. Adding a role is a data edit in
> `rbac/personas.py` plus `bench migrate` — do not hand-wire roles anywhere else.

> **ATTENTION AI AGENTS (CLAUDE/GEMINI):** 
> You are acting as an Enterprise Software Architect and Senior Developer. 
> - **DO NOT OVER-ENGINEER:** Stick to the established stack (React 18, Vite, Zustand, React Query, Tailwind, Frappe, Python, Keycloak). Do not introduce new libraries without explicit human approval.
> - **DO NOT HALLUCINATE FEATURES:** Implement *only* the features listed below for the specified persona. 
> - **BE CONCISE:** Do not write boilerplate explanations. Output only the necessary, production-ready code.
> - **OBEY `CLAUDE.md`:** The architectural standards in `CLAUDE.md` are absolute.

---

## Phase 1: Identity & Security Foundation (Keycloak + EID)
**Goal:** Establish the impenetrable identity layer before any loan logic is written.
1. **Frontend:** Implement OIDC PKCE flow in `frontend/src/features/identity`. No passwords handled in React.
2. **Backend:** Configure Frappe Social Login to decode Keycloak JWTs, extract the `EID` claim, and dynamically assign the correct Frappe Role Profile (Citizen, Underwriter, etc.).
3. **Validation:** Ensure the Admin "Kill Switch" in Keycloak immediately rejects tokens in Frappe.

## Phase 2: The Citizen Portal (Applicant Wizard)
**Goal:** A modular, draft-capable application wizard preventing PII local storage.
1. **Scaffold FSD:** Build the wizard inside `frontend/src/features/applications`. **NO 1500-line God Objects.** Create modular step components (Business, Financials, Documents).
2. **State Management:** Use Zustand for step-tracking. Use React Query to auto-save drafts to the Frappe backend. Do NOT use `localStorage` for PII.
3. **Document Vault:** Implement document uploads. Ensure Frappe backend validates MIME types and issues secure download URLs.
4. **Row-Level Security:** Backend APIs must strictly enforce `WHERE eid = session.eid`. Citizens cannot see other citizens' data.

## Phase 2.5: Regional Facilitator (Delegated Authority)
**Goal:** Enable Facilitators to safely draft/submit applications *on behalf of* a Cluster.
1. **The Consent Handshake:** Implement the flow where a `business_type == cluster` application explicitly opts in and is bound to a `facilitator_eid`.
2. **Proxy Authentication:** Facilitators log in with their *own* EID. The frontend portal displays a "Facilitator Dashboard" listing only their authorized cluster drafts.
3. **Audit Integrity (Crucial):** The Python `services/application.py` layer must enforce that the application `owner` remains the Citizen/Cluster, but the `modified_by` and audit logs explicitly record the Facilitator's EID. Do NOT use raw Frappe CRUD here.

## Phase 3: Underwriting & Maker/Checker Enforcement
**Goal:** Secure the bank's decision-making process.
1. **The Review Queue:** Build the Underwriter UI in `frontend/src/features/underwriting`. List applications by EID, not email.
2. **Data Comparison:** Build a UI that visually diffs "Citizen Declared Data" vs "Government Verified Data".
3. **Mandatory Audit Logs:** Backend Python `services/underwriting.py` must handle approvals/declines. Rejections require a non-blank reason.
4. **Structural Constraints:** Hardcode the logic: An Underwriter cannot approve their own application.

## Phase 4: Disbursement & Finance Operations
**Goal:** Money movement and ledger reconciliation with strict separation of duties.
1. **Condition Checking:** Build the Disbursement Officer view. They can check off conditions but CANNOT approve credit.
2. **Release Funds:** **CRITICAL RULE:** The Frappe backend must check the audit log. If `session.user` == `Underwriter who approved the loan`, THROW a 403 Forbidden. The Maker cannot be the Checker.
3. **Finance Ledger:** Build the Finance dashboard for matching bank transfers to loans and handling refunds.

## Phase 5: Board/CEO Dashboard (Aggregate Only)
**Goal:** High-level reporting with guaranteed privacy.
1. **Strict Privacy:** The CEO/Board Frappe Role has NO read access to the Loan Application DocType. 
2. **Aggregate APIs:** Create specific backend endpoints in `api/v1_reports.py` that only return aggregate numbers (SUMs, COUNTs). The system must physically prevent them from accessing individual case PII.
3. **Rule Approvals:** Build the workflow where Finance proposes a lending rule change, and the Board approves it. **CRITICAL RULE:** The proposer cannot be the approver.

---
**AI EXECUTION PROTOCOL:**
When the human asks you to implement a feature, locate its Phase in this document. Implement it using the Feature-Sliced Design folders. Run all backend writes through `frappe.get_doc().save()`. Do not use `db_set` for business status transitions. Enforce RBAC in the Python `services/` layer.
