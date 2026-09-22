# Guyana Development Bank (GDB) - Enterprise Architecture & Coding Standards

This document outlines the required architectural patterns, coding standards, and defensive engineering practices for the GDB Digital Lending Platform. All future development must adhere to these guidelines to ensure scalability, security, and maintainability.

---

## 1. Frontend Standards (React)

### 1.1 Folder Structure: Feature-Sliced Design
Do not group files by their technical type (e.g., `pages/`, `components/`). Group files by their business feature domain.
**Correct Structure:**
```text
frontend/src/
  app/                 # App.tsx, ErrorBoundary, global providers
  features/
    applications/      # Loan application wizard, forms, and specific API calls
    finance/           # Ledger, disbursements, portfolio
    clusters/          # Cluster management
    identity/          # Login, profile, OIDC handling
  shared/
    ui/                # Generic buttons, cards, layout wrappers
    api/               # Base fetch wrapper
```

### 1.2 Component Architecture (Avoid God Objects)
- Components must be kept small and adhere to the **Single Responsibility Principle**.
- Massive components (like a 1,500-line `Apply.tsx`) must be dismantled. The main component should act as a "shell" or "controller" that renders smaller, modular sub-components (e.g., `FinancesStep.tsx`, `BusinessStep.tsx`).

### 1.3 State Management
- **Local UI State:** Use `useState` for simple component-level state (e.g., toggling a dropdown).
- **Complex Feature State:** Use **Zustand** with the **Slices Pattern** for complex multi-step forms. 
  - *Critical Rule:* Always use selectors (`useWizardStore(s => s.amount)`) to prevent unnecessary full-page re-renders.
- **Server State (API Data):** Use a server-state library like **React Query** to handle caching, loading states, and background syncing. Do not manually `useEffect` to fetch and store API data in local state.

### 1.4 Client-Side Security & Data Handling
- **No PII in Local Storage:** Never store sensitive applicant data, financial records, or EIDs in unencrypted `localStorage`. 
- **Drafts:** Application progress should be auto-saved to the backend (Server-Side Drafts).

---

## 2. Backend Standards (Frappe / Python)

### 2.1 Layered Architecture (Decoupling)
Do not place business logic or database queries directly inside API endpoints.
- **Controllers (`api/`):** Responsible ONLY for route whitelisting, argument parsing, permission gates, and returning HTTP responses.
- **Services (`services/`):** Responsible for the actual business logic, complex calculations, and calling the ORM. 
- **Domain (`domain/`):** Contains shared primitives (e.g., `_session_user`, `_require_underwriter`) that are imported across the app. This prevents circular dependencies.

### 2.2 Strict State Machines
- **Never perform raw string updates on statuses.** (e.g., `doc.db_set("status", "Approved")`).
- Use Frappe's Workflow engine or dedicated State Machine service classes to enforce valid transitions. Check if a transition is legal before executing it.

### 2.3 Data Access & Auditability
- **Always use the ORM for writes.** All database insertions or updates must go through `frappe.get_doc(doctype, name).save()` or `.db_set()`.
- **No Raw SQL Writes:** Bypassing the ORM with `frappe.db.sql` for writes is strictly prohibited, as it circumvents Frappe's audit logging (versions), webhooks, and validation hooks. Audit trails are mandatory for this financial platform.

---

## 3. Identity & Authentication

### 3.1 OAuth 2.1 / OIDC Best Practices
- **No Password Handling:** The frontend must NEVER collect raw passwords and send them to the backend API (Resource Owner Password Credentials flow is deprecated).
- **Use PKCE:** The frontend must redirect the user to Keycloak for authentication using the **Authorization Code Flow with PKCE**. Keycloak will handle the password and return a secure code to exchange for a session.

### 3.2 Session & CSRF Security
- If relying on Frappe's `sid` cookie for sessions, ensure it is set with `HttpOnly` and `SameSite=Strict`.
- All state-changing `POST` requests originating from the frontend must include the appropriate CSRF token header (`X-Frappe-CSRF-Token`).

---

## 4. Resilience & Error Handling
- **Frontend Error Boundaries:** Wrap feature routes in `<ErrorBoundary>` components to ensure a crash in one module (e.g., Finance) does not crash the entire application (e.g., Citizen Portal).
- **Backend Centralized Error Handling:** Do not return raw stack traces to the frontend. Catch exceptions in the Service layer and return standardized error payloads via the Controller.
