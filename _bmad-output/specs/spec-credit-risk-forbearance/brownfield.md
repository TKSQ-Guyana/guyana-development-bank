# Brownfield notes — what already exists and where the seams are

GDB is not missing machinery. It is missing the wiring. This file names what to build on, so
no capability reimplements something the stack already does.

## Integration rule already followed by the codebase

> Over HTTP, call `lending.api.*`. In-process, call the underlying function and relay lending's
> own field names. Never recompute money.

`services/application.py` already documents why: `lending.api.get_due_details` gates on a `Loan`
role no citizen holds and writes into `frappe.response` rather than returning, so GDB calls
`calculate_amounts` underneath it and relays lending's keys unchanged. Keep this pattern.

## lending mechanisms to use

| Capability | Use | Notes |
|---|---|---|
| CAP-1 | `Loan Product` and `Company` fields | Parameters are fields, not code. The approval step must write to them. |
| CAP-2 | `Company.loan_classification_ranges`, `days_past_due_threshold_for_npa`, `Process Loan Classification` | The scheduler job already runs. It needs ranges to classify into. |
| CAP-3 | `Loan.moratorium_tenure`, `Loan.moratorium_type`, `Loan.treatment_of_interest` | Set at **booking**, per lending's docs. The schedule generator derives `moratorium_end_date`. At 0% only `moratorium_type: "EMI"` is meaningful. |
| CAP-4 | `services/disbursement.offer_mismatch` | Already compares amount and term and refuses release. Extend to moratorium. This is the control. |
| CAP-5, CAP-6 | `Loan Restructure` doctype | `restructure_type` is a `DF.Literal["Normal Restructure", "Pre Payment", "Advance Payment"]`. Insert builds the revised schedule; submit retires the old one and activates the new. |
| CAP-6 | `Company.watch_period_post_loan_restructure_in_days`, `Loan.watch_period_end_date`, `update_watch_period_date_for_all_loans` | lending sets the watch period on a `Normal Restructure` already — it is zero only because the Company field is zero. |
| CAP-7 | `Loan Product.advance_payment_handling` (`Reduce Tenure` \| `Reduce EMI`) | lending's own words: *"Reduce Tenure keeps the EMI fixed and reduces the number of periods, while Reduce EMI keeps the number of periods fixed and reduces the EMI."* |
| CAP-8, CAP-9 | `Loan.loan_restructure_count`, `tenure_post_restructure`, `Loan Repayment Schedule.status` + `loan_restructure` | The register fields exist and are not maintained by the auto-path. |
| Schedule preview | `lending.api.get_repayment_schedule` | Whitelisted, **no permission gate**, accepts `repayment_start_date`. Richer than the `get_monthly_repayment_amount` call `issue_offer` uses today. |

## GDB patterns to reuse

| Need | Existing implementation |
|---|---|
| Maker-checker on a record | `GDBLendingRuleProposal.before_save` — refuses the same officer who proposed, and refuses a rejection with no reason |
| Four-eyes reaching the *person*, not the account | `security/conflict.is_same_person` — matches on account **or** national e-ID; already guards `review_loan` and `disburse_loan` |
| Proposal workflow with effective dating | `GDB Lending Rule Proposal` + `install.ensure_lending_rule_proposal_workflow`; `rules.py` is the thin portal surface over Frappe's own workflow engine |
| Borrower executing terms in her own name | `offers.accept_offer` / `sign_offer` — typed-name acceptance against frozen `agreement_text` |
| Staff read access to lending doctypes | `install.LENDING_READ_DOCTYPES`, currently `("Loan", "Loan Repayment", "Loan Disbursement", "Loan Demand")` — `Loan Restructure` must join it for CAP-8 |
| Role gates | `_require_underwriter`, `_require_disbursement`, `_require_finance` in `utils/session.py` |

## The seams — where new code actually goes

1. **`rules.py` / the proposal doctype** — approval currently *records* a decision and does not apply it. CAP-1 closes that loop.
2. **`GDB Loan Offer`** — needs a moratorium field, set in `issue_offer`, carried into `agreement_text`.
3. **`services/disbursement.create_loan_on_offer`** — writes three fields today (amount, periods, instalment). CAP-3 adds two.
4. **`services/disbursement.offer_mismatch`** — CAP-4 extends the comparison. **This must land with or before CAP-3**, or a loan booked before the field existed releases against an offer promising a holiday it does not carry.
5. **A new forbearance service** over `Loan Restructure` — propose (draft) / approve (submit) / borrower-accept, with `is_same_person` between proposer and approver.
6. **`api.make_repayment` / `services/finance.repayment_plan`** — CAP-7 intercepts before posting to capture the borrower's instruction.
7. **A scheduled control job** — CAP-9.

## Version pin

The runtime is `frappe/lending` **v16.5.0** (`backend/Dockerfile`). Field names above were read
from the vendored copy in `backend/lending_temp/` and confirmed against the live site where
possible. Confirm `Loan Restructure` field names inside the running container before writing
against them.

## Environment gotcha

Backend Python changes do not take effect until the backend container restarts; a newly
whitelisted method returns an error until then, and the bench console hides it.
