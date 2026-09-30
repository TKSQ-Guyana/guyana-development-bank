---
id: SPEC-credit-risk-forbearance
companions:
  - findings.md
  - journeys.md
  - risk-parameters.md
  - brownfield.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# GDB credit risk and forbearance

## Why

**A mandate, and a live control gap.** GDB is a real bank lending public money. Its book currently has no delinquency classification, no observation period after a concession, and no record of who authorised a change to a borrower's agreement — all three verified against the running system on 2026-09-30 (`findings.md`). Twenty schedule changes are already submitted and approved against live loans with no human behind any of them, invisible to every accountable role. One loan's master record disagrees with its own repayment schedule right now.

The consequence is not theoretical. An underwriter who wants to give a borrower three months before her first payment has no way to express it that the schedule will honour, so an applicant doing exactly what the loan was for defaults on instalments nobody expected her to make. A borrower in genuine difficulty at month 10 has no path but default, because no GDB role can even read the record that would rescue her. And every risk number GDB reports is currently zero — not because the book is clean, but because nothing ages it.

The engine underneath (frappe/lending) already carries the machinery for all of this. GDB has never reached for it.

## Capabilities

- **CAP-1** — Risk-parameter governance
  - **intent:** Finance proposes a risk parameter, a second Finance officer approves it, and on its effective date the approved value is applied to the Loan Product and Company.
  - **success:** An approved proposal changes the live parameter on its effective date; the proposer cannot approve their own; the applied change is traceable from the live value back to the proposal that set it.

- **CAP-2** — Delinquency classification
  - **intent:** Every live loan carries a days-past-due figure and a classification bucket, derived nightly from the schedule.
  - **success:** A loan with a missed instalment shows a non-zero days-past-due and moves through the configured buckets as it ages; a loan in arrears past the NPA threshold is flagged.

- **CAP-3** — Moratorium at origination
  - **intent:** A borrower can ask for a later first payment; an underwriter grants a moratorium within policy bounds; it is stated on the Letter of Offer and written onto the Loan at booking.
  - **success:** A loan booked on an offer granting N months has no instalment falling due inside those N months, and the borrower saw the term before she accepted.

- **CAP-4** — Terms-mismatch gate
  - **intent:** Release is refused when the booked schedule does not carry the executed offer's terms, including moratorium.
  - **success:** Disbursement is refused, naming the discrepancy, on a loan whose schedule contradicts the accepted offer.

- **CAP-5** — Concession / prepayment split
  - **intent:** Every schedule-change event is classified as either a concession granted because the borrower is in difficulty, or a change the borrower elected by paying early, and the two are reported apart.
  - **success:** Restructured-exposure reporting counts concessions and excludes borrower-elected prepayments; each existing and future event carries one classification.

- **CAP-6** — Concession as a governed event
  - **intent:** A concession is proposed by one officer with a reason code, approved by a second, accepted by the borrower as a variation to her agreement, and then flagged with a watch period.
  - **success:** No concession takes effect without two distinct officers and the borrower's acceptance; the prior schedule is retained; the loan carries a watch-period end date afterwards.

- **CAP-7** — Borrower-elected prepayment
  - **intent:** When a payment would be applied ahead of schedule, the borrower is asked how to apply it — finish sooner, or pay less each month — and her instruction is recorded against that payment.
  - **success:** The resulting schedule matches her stated choice, and the choice is retrievable from the payment record.

- **CAP-8** — Schedule-change visibility
  - **intent:** Schedule-change history is readable by the Underwriter, Disbursement Officer and Finance on the case, and by the borrower for her own loan.
  - **success:** A schedule change is visible to all three staff roles and to the borrower, showing what changed, why, on whose authority, and when.

- **CAP-9** — Integrity controls
  - **intent:** A daily control detects any loan whose master terms disagree with its Active schedule, and any schedule change with no maker and checker.
  - **success:** The control raises the known live break (`Loan.repayment_periods` ≠ Active schedule periods) and any schedule change lacking both an approver and a borrower acceptance.

- **CAP-10** — Delegated lending authority
  - **intent:** Credit discretion is bounded by an authority matrix; beyond the bound, the decision escalates instead of saving.
  - **success:** An officer granting a moratorium or concession beyond their limit is refused and the case is routed to the escalation body.

## Constraints

- Build on frappe/lending's own doctypes and fields — `Loan Restructure`, `moratorium_tenure`/`moratorium_type`, `advance_payment_handling`, `loan_classification_ranges`. No second state machine; no money recomputed in the portal. See `brownfield.md`.
- Every schedule version is retained; a new schedule never erases the prior one (`project_overview.md:1807`). lending already satisfies this — it must stay true and become visible.
- Maker must not equal checker on any state-changing credit or money action, enforced server-side on the record — the `GDBLendingRuleProposal.before_save` and `disburse_loan` pattern — never only in the UI.
- Any change to terms the borrower has already executed requires her acceptance in her own name before it takes effect.
- GDB lends at 0%, so a moratorium or prepayment reshapes cash flow and never changes total repayable. No interest capitalisation arises, which makes `moratorium_type: EMI` the correct and only meaningful setting.
- Risk parameters live in records and configuration, never hardcoded. Changing one goes through CAP-1.
- Portal access is whitelisted methods in `gdb_bank` over the Frappe session; identity, roles and session handling are unchanged by this work.

## Non-goals

- Not building a replacement restructure or amortisation engine. lending computes every figure.
- Not implementing IFRS 9 expected-credit-loss modelling. Classification and provisioning posting only.
- Not building the Board / CEO persona, though CAP-2 and CAP-5 produce its inputs.
- Not changing lending's behaviour of rescheduling on an advance payment. That behaviour is correct; only its classification, its visibility and the borrower's say in it change.
- Not closing the System Manager / Administrator bypass, which remains a known accepted gap.

## Success signal

A borrower who needs three months before her first payment gets them on her signed offer and in her schedule, and never enters arrears for it. A borrower who falls into difficulty at month 10 is restructured by two officers with a reason on the record and her own acceptance, and GDB recovers the full balance. And on any given morning, GDB can state how much of its book is in arrears, in which bucket, and how much has been granted forbearance — figures it cannot produce today at all.

## Assumptions

- Bank of Guyana style days-past-due buckets (30 / 60 / 90 / 180) are the starting proposal in `risk-parameters.md`; the actual ranges are a GDB policy decision made through CAP-1.
- The three existing portal roles are the right holders of these actions; no new staff role is required except the escalation body named in CAP-10.

## Open Questions

- What is GDB's maximum moratorium, and is eligibility restricted by venture type or sector?
- What is the watch-period length after a concession, and what evidence returns a loan to performing?
- Is the prepayment choice (finish sooner / pay less each month) offered per payment, or elected once in the loan agreement?
- What are the delegated lending authority thresholds, and which body hears an escalation — a credit committee or the Board?
- Does a concession above some amount require credit-committee or Board approval, and what is that amount?
- How are the 20 existing unclassified restructures to be treated — back-classified as prepayments, or left as a documented legacy set?
