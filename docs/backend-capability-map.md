# Backend capability map — what the lending engine offers vs. what the portal uses

A CEO-level walkthrough of the ERPNext/lending backend at `:8080`, run against the
live compose stack on **2026-09-13**. Versions: frappe 16.33.1, erpnext 16.34.2,
lending 16.5.0, gdb_bank 0.1.0.

Purpose: decide what the SPA at `:3000` should grow into. Everything below was
executed against the running stack, not read off documentation.

## 1. The size of the gap

| | Count |
|---|---|
| Lending doctypes installed | 69 (42 main + 27 child tables) |
| Lending doctypes the portal touches | **6** |
| Lending script reports installed | 11 |
| Reports the portal surfaces | **0** |
| Loan desk actions available | 8 |
| Loan actions the portal wraps | **2** (disburse, repay) |

The portal is a thin slice over `Loan Application` → `Loan` → `Loan Disbursement`
→ `Loan Repayment` → `Loan Repayment Schedule` → `Loan Demand`. The other 36
doctypes — collateral, delinquency, restructuring, write-offs, accounting — have
no portal surface at all.

## 2. The CEO menu (Lending workspace, 12 sections)

- **Loan** — Loan Category, Loan Product, Loan Application, Loan, Loan Restructure
- **Disbursement and Repayment** — Loan Disbursement, Loan Security Deposit, Loan
  Repayment Schedule, Loan Interest Accrual, Loan Demand, Loan Repayment
- **Loan Security** — Security Type, Security Price, Security, Security
  Assignment, Security Release, Security Shortfall
- **Loan Classification** — Loan Classification, NPA Logs, Days Past Due Logs
- **Loan Adjustments** — Loan Adjustment, Loan Write Off, Loan Refund, Loan
  Balance Adjustment
- **Loan Processes** — Process Security Shortfall, Process Interest Accrual,
  Process Demand, Process Classification
- **Loan Transfers** — Branch, Loan Transfer
- **Co-Lending** — Loan Partner
- **Taxes and Charges** — Customer, Item, Sales Invoice, Sales Taxes and Charges
  Template
- **Banking** — Bank, Bank Account
- **LOS** — Loan Origination Settings, Loan Document Type
- **Reports** — 7 linked (11 installed)

## 3. Loan desk actions and the server methods behind them

From `lending/loan_management/doctype/loan/loan.js`. These are the real lifecycle
verbs, each callable as `/api/method/<path>`:

| Desk button | Server method (`lending.loan_management.doctype.loan.loan.*`) | In portal? |
|---|---|---|
| Loan Disbursement | `make_loan_disbursement` | via `disburse_loan` |
| Loan Repayment | `make_repayment_entry` | via `make_repayment` |
| Request Loan Closure | `request_loan_closure` | no |
| Close Loan | `close_unsecured_term_loan` | no |
| Loan Write Off | `make_loan_write_off` | no |
| Loan Refund | `make_refund_jv` | no |
| Loan Security Release | `unpledge_security` | no |
| (form load) | `get_loan_application` | n/a |

The Loan form's connections dashboard groups related documents into: Schedule &
Disbursement, Repayment, Security, Adjustments, Logs, and **Accounting (Journal
Entry, Sales Invoice)**.

## 4. Verified portal lifecycle (the current frontend contract)

All 18 `gdb_bank.api.*` endpoints, exercised end to end. Auth is the Frappe `sid`
cookie; every call is `POST /api/method/<path>` with a JSON body.

| Stage | Endpoint | Notes from the live run |
|---|---|---|
| apply | `apply_loan(loan_amount, purpose, term_months, monthly_income, phone, cluster)` | param is `loan_amount`, **not** `amount` |
| citizen list | `my_loans()` | own applications only |
| citizen detail | `loan_detail(name)` | blocks other users' applications |
| queue | `all_loans(status)` | underwriter only |
| decide | `review_loan(name, action, remarks)` | `Open` to `Approved` / `Rejected` |
| book | `book_loan(application)` | creates Loan, status `Sanctioned` |
| disburse | `disburse_loan(application, amount)` | status `Disbursed`, generates schedule |
| account | `loan_account(application)` | returns `application, loan, schedule, dues, disbursable` |
| repay | `make_repayment(application, amount)` | |
| clusters | `create_cluster`, `invite_member`, `save_plan`, `my_cluster`, `cluster_view`, `convert_lead` | `cluster_view` and `convert_lead` are not wired in the SPA |
| auth | `signup`, `whoami`, `identity.password_login` | |

Observed state machines:

- **Loan Application.status** — `Open` to `Approved` or `Rejected` (permlevel 1;
  the portal renames `Open` to `Submitted`)
- **Loan.status** — `Sanctioned` to `Partially Disbursed` to `Disbursed`
- **Loan Repayment Schedule.status** — `Active` to `Closed`

`loan_account` returns no payment history, so a borrower cannot see past
repayments.

## 5. Report APIs — ready-made CEO dashboards, currently unused

Callable as
`GET /api/method/frappe.desk.query_report.run?report_name=<name>&filters=<json>`.
Verified returning real data:

- **Loan Outstanding Report** (`company`, `as_on_date`) — 16 rows, 25+ fields
  including `principal_outstanding`, `days_past_due`, `total_installments_overdue`
- **Loan Repayment and Closure** (`company`, `from_date`, `to_date`) — 15 rows
  with principal / interest / penalty split
- Also installed: Future and Past Cashflow (both need `as_on_date`), ALM Audit,
  Loan Statement of Account, Disbursement Analysis, and 4 security reports

These are the fastest route to a portfolio dashboard — no new backend code.

## 6. Defects found during the walkthrough

Each was reproduced live.

1. **Nothing reaches the general ledger.** After 15 disbursements and 15
   repayments: `GL Entry = 0`, `Journal Entry = 0`, `Payment Entry = 0`.
   `Process Loan Accounting` has never run (0 records). Every accounting field on
   Loan Product `GDB-STD` is `null` (`loan_account`, `payment_account`,
   `interest_income_account`, and the rest) because loan accounting is disabled
   on the Company.

2. **No interest is ever collected.** All 15 `Loan Demand` rows are
   `demand_subtype: "Principal"` — there is not one Interest demand. Repayments
   therefore allocate 100% to principal and 0% to interest, and `Loan Outstanding
   Report` shows `total_interest_paid: 0` for every loan. Only 4 `Loan Interest
   Accrual` records exist, covering 2 loans, none after 2026-09-12.

3. **Repayments accept any amount.** `make_repayment` accepted **99,000,000**
   against a 1,250,000 loan (`ACC-LOAN-2026-00011`), leaving
   `excess_amount_paid = 97,806,535`. There is no ceiling, and with no GL there
   is no cash reconciliation to catch it. A pre-existing row (`LM-REP-0008`,
   5,000,000 against a 1,200,000 loan) shows this is not new.

4. **No segregation of duties.** The same `underwriter@gdb.gov.gy` session
   approved, booked, and disbursed `ACC-LOAP-2026-00015` with no second approver.

5. **A fully repaid loan still reads `Disbursed`.** `ACC-LOAN-2026-00011` has
   `total_principal_paid == loan_amount` and a `Closed` schedule, but
   `Loan.status` stays `Disbursed`. The UI cannot use `loan.status` for closure.

6. **The `phone` parameter of `apply_loan` is unusable.** `applicant_phone_number`
   is a Frappe `Phone` field with strict validation and the portal passes raw
   input straight into it. `592-555-0199` gives "Please select a country code";
   `+592 555 0199` gives "is not valid". Only bare E.164 (`+5922271234`)
   succeeds. There is no normalisation and no client-side guard.

7. **Argument errors surface as a bare `{"exc_type":"TypeError"}`** with no
   message, so the SPA cannot render anything useful.

8. **Websockets are down.** `/socket.io/` returns **502** on `:8080`, so realtime
   list and form updates do not work.

## 6b. Authorization findings

The portal's role gating lives in `gdb_bank/api.py`. But nginx proxies `/api`
same-origin, so **any authenticated session can call any whitelisted method on
any installed app**, not just `gdb_bank.api.*`. The portal's guards are therefore
a front door, not the only door. Two consequences were confirmed live.

### `post_bulk_payments` has no permission check (upstream lending bug)

`lending…loan_repayment.post_bulk_payments` (loan_repayment.py:3403) has no
`frappe.has_permission` call and resolves loans with `frappe.db.get_all`, which
bypasses permissions. Its two sibling methods use the permission-aware
`frappe.get_list` and are correctly guarded. Called from a plain **Citizen**
session:

| Method | Writes? | Result as Citizen |
|---|---|---|
| `get_bulk_due_details` | no | `PermissionError: Not permitted to view one or more of the selected loans` |
| `calculate_amounts` | no | `PermissionError: Not allowed via controller permission check` |
| **`post_bulk_payments`** | **yes** | **reached the function body** — returned `The following loans do not exist: …` |

The probe used a non-existent loan name deliberately, so nothing was written. It
proves the citizen executed the method body with no authorization gate in front
of it. The method that posts repayments is the one method of the three that is
unguarded.

### `create_loan` does not check application status

`lending…loan_application.create_loan` (loan_application.py:307) validates only
`docstatus == 1`; it never checks `status == "Approved"`.

- `gdb_bank.api.book_loan` **does** guard this correctly — booking the rejected
  `ACC-LOAP-2026-00016` returned
  `Only an approved application can be booked (ACC-LOAP-2026-00016 is Rejected).`
- Calling `create_loan` directly on that same **Rejected** application returned a
  populated Loan document.

The returned doc is an unsaved draft (`docstatus 0`), so this is a two-step
bypass rather than a one-call exploit, and it requires the `Loan: create`
permission that comes with `Loan Manager`. It still means the portal's approval
gate is not the system's approval gate.

## 6c. Why the ledger is empty, precisely

Every accounting hook in lending is gated by an early `return` when company loan
accounting is off — not an error. Documents submit and state advances with no
ledger, silently: `loan_controller.py:11-12` (covers Disbursement, Demand,
Accrual, Repayment), `loan.py:179` and `:674`, `loan_disbursement.py:782`,
`loan_repayment.py:2132`, `loan_demand.py:135`, `loan_interest_accrual.py:182`,
`loan_write_off.py:212`, `loan_refund.py:125`,
`process_loan_accounting.py:91`. The 16-mandatory-account gate is
`loan_product.py:149-185`.

Because `get_gl_map` returns `None` at `loan_repayment.py:2132`, the
`frappe.throw("Payment Account is mandatory")` at `:2488` never fires — that
throw is what will start failing the moment accounting is switched on.

Two things are broken outright rather than merely skipped:

1. **`make_refund_jv`** (loan.py:1188) builds a Journal Entry with `account=None`
   on both legs, because `Loan.loan_account` and `payment_account` are NULL.
   Independently, `submit=1` raises
   `TypeError: 'NoneType' object is not callable`, because erpnext's
   `get_payment_entry` returns `je.as_dict()` (journal_entry.py:1562) and lending
   never passes `journal_entry`. So excess payments cannot be refunded at all.
2. **`auto_close_loan`** (loan_repayment.py:1406-1418) never fires, because
   GDB-STD has `write_off_amount = 0` and `excess_amount_acceptance_limit = 0`.
   That is the mechanical reason **zero loans are `Closed`** and why
   `ACC-LOAN-2026-00005` and `-00011` sit at `Disbursed` holding GYD 3.9M and
   97.8M of unrefundable `excess_amount_paid` respectively
   (`validate_normal_repayment = 0` is what lets the overpayment in,
   loan_repayment.py:1035-1042).

## 7. What holds up

- The role gate is enforced server-side. As a Citizen, `review_loan`,
  `book_loan`, `disburse_loan` and `all_loans` all returned
  `PermissionError: Only GDB underwriters may do this.`, and `loan_detail` on
  another citizen's application returned
  `You may only view your own applications.`
- Schedule generation, demand generation and the repayment allocation engine run
  correctly as a state machine. The defects above are configuration and
  validation gaps, not broken plumbing.

## 8. What the SPA should grow into

The SPA already wires 15 of the 18 portal endpoints across 7 pages
(`Apply`, `MyLoans`, `LoanDetail`, `Review`, `Cluster`, `Login`, `Signup`) and 2
components (`LoanAccount`, `Disbursement`). Unwired: `cluster_view`,
`convert_lead`.

Ranked by value per unit of work:

1. **Portfolio dashboard — no backend work needed.** Wire
   `frappe.desk.query_report.run` for Loan Outstanding and Loan Repayment and
   Closure. This is the single biggest capability jump available today.
2. **Payment history on the loan account.** `loan_account` returns no payments;
   add them to the existing endpoint rather than a new one.
3. **Arrears / DPD view.** `Loan Demand` and `Days Past Due Log` already carry
   the data; no portal endpoint exposes either.
4. **Pre-apply EMI preview.** `lending.api.get_repayment_schedule` and
   `lending.api.get_due_details` exist and are callable — an applicant currently
   gets no repayment estimate before submitting.
5. **Closure and settlement.** No portal endpoint wraps `request_loan_closure`
   or `close_unsecured_term_loan`, and `make_repayment` only ever issues
   `Normal Repayment` — no Pre-payment, Advance, Partial or Full Settlement, or
   Loan Closure repayment types.
6. **Statement of accounts.** `Loan Statement of Account` and
   `Process Loan Statement of Accounts` exist; the portal offers no statement or
   receipt of any kind.

Not worth building until the backend supports them: write-off, refund of excess
(`make_refund_jv` is broken, see 6c), collateral, restructuring, bulk operations.

**Do not build a repayment UI on the current backend without fixing item 3 in
section 6 first.** A payment box that accepts any number, allocates all of it to
principal, and writes nothing to a ledger is worse in production than no payment
box at all.

## 9. Notes

- `CLAUDE.md` states that gdb_bank has no doctype of its own. That is now stale —
  `GDB Cluster` and `GDB Cluster Member` exist.
- Walkthrough test data left in the dev stack: `ACC-LOAP-2026-00015` and
  `00016`, `ACC-LOAN-2026-00011`, `LM-DIS-00015`, `LM-REP-0014` and `0015`.
