# gdb_bank

Custom Frappe app for the Guyana Development Bank citizen loan portal.

Provides:

- **Loan Application** doctype (amount, purpose, term, income, status workflow
  `Submitted → Under Review → Approved/Rejected`).
- Roles **Citizen** (portal user, sees only their own applications) and
  **Loan Underwriter** (GDB persona, reviews every application).
- Whitelisted REST endpoints under `/api/method/gdb_bank.api.*` consumed by the
  React citizen portal (`frontend/` in this repository).

Installed on top of ERPNext — see `backend/Dockerfile`.
