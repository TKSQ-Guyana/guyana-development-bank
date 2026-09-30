# Baseline findings — verified live, 2026-09-30

Gathered against the running stack. A loan was created end to end to prove each one:
application `ACC-LOAP-2026-00102` → offer `GDB-OFF-2026-00048` → loan `ACC-LOAN-2026-00052`
→ restructure `LOAN-RES-2026-00020`.

These are the baseline every capability is measured against.

## Configuration

| # | Finding | Observed value | Consequence |
|---|---|---|---|
| F-1 | `Company.loan_classification_ranges` | `[]` | No delinquency buckets exist. `Process Loan Classification` has run 57 times against nothing. |
| F-2 | `Company.watch_period_post_loan_restructure_in_days` | `0` | A restructured loan returns to performing instantly. No observation period. |
| F-3 | `Loan Product GDB-STD.advance_payment_handling` | `"Reduce Tenure"` | lending's own doctype default. GDB never chose it — it decides every borrower's early-payment outcome. |
| F-4 | `Loan Product GDB-STD` moratorium fields | none set | No product-level moratorium policy exists. |

## The book

| # | Finding | Observed value | Consequence |
|---|---|---|---|
| F-5 | `days_past_due` across all disbursed loans | `0` | Nothing ages. Every risk figure GDB reports is zero for the wrong reason. |
| F-6 | `Loan Restructure` records | **20**, all `restructure_type: "Advance Payment"`, `status: "Approved"`, `docstatus: 1`, `owner: "Administrator"` | Twenty submitted, approved changes to live agreements. No human authorised any of them. |

## Integrity breaks on `ACC-LOAN-2026-00052`

| # | Finding | Observed | Consequence |
|---|---|---|---|
| F-7 | `Loan.repayment_periods` vs Active schedule periods | **24 vs 21** | The master record disagrees with its own amortisation schedule. A live reconciliation break with nothing detecting it. |
| F-8 | `Loan.loan_restructure_count` / `tenure_post_restructure` | `0` / `0` | A submitted restructure exists against the loan. The register does not know. |
| F-9 | `Loan.moratorium_tenure` / `moratorium_type` | `0` / `""` | The offer the borrower signed granted a three-month moratorium. The loan carries none. |

## Visibility

| # | Finding | Observed | Consequence |
|---|---|---|---|
| F-10 | Reading `Loan Restructure` as each portal role | **HTTP 403** for Underwriter, Disbursement Officer and Finance | The event is invisible to everyone accountable for it. |
| F-11 | Borrower's own ledger after the change | Payment shown; **no mention of the schedule change** | Her instalments went 24 → 21 and her first payment moved to 30 Nov 2026. She was not told. |

## Origination

| # | Finding | Observed | Consequence |
|---|---|---|---|
| F-12 | `issue_offer` form fields | Amount · Term · Valid-for days · Additional conditions | No moratorium field anywhere in origination. |
| F-13 | Moratorium expressed as a condition precedent | Appeared in the release checklist with **Mark met / Waive** buttons, and blocked disbursement | A repayment holiday was treated as a box to tick. Someone had to declare it "Met" on day one to release the money. |
| F-14 | Generated schedule vs the accepted offer | Offer: *"repayments begin in month 4"*. Schedule: first instalment **30 Sept 2026**, the disbursement date. | The executed agreement and the schedule contradict each other, on the same case page, with nothing reconciling them. |

## Controls confirmed working

Recorded so they are not broken by this work:

- The conditions gate refused disbursement and named exactly what was outstanding, then released only once each item was cleared with attribution.
- Booking and release are the Disbursement Officer's, distinct from the approving underwriter, and the separation held through the walkthrough.
- lending retains the superseded schedule (`LN-RS-2026-00068` marked `Rescheduled`, `LN-RS-2026-00069` `Active`), satisfying `project_overview.md:1807` already.

## Incidental defects observed

Outside this spec's scope, logged so they are not lost:

- The underwriter's decision panel is labelled *"Remarks for the applicant (optional)"*; Approve and Reject are both live with the field empty.
- There is no Bank countersignature step — the case moves from borrower acceptance straight to final checks.
