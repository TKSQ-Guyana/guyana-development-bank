# User journeys

Running case: **Parika Cassava Processing**, G$1,200,000 over 24 months at 0%, first payment
G$50,000. This is the loan actually created during discovery (`ACC-LOAP-2026-00102`), so every
"today" column below is observed, not imagined.

---

## J-0 — The bank sets its risk policy · CAP-1, CAP-2

**Actors:** Finance A, Finance B. **Runs:** once, then on any policy change.

| # | Actor | Action | System |
|---|---|---|---|
| 1 | Finance A | Proposes classification ranges, NPA threshold, watch period, maximum moratorium, advance-payment default (`risk-parameters.md`), each with an effective date and a stated reason | `GDB Lending Rule Proposal`, Pending |
| 2 | Finance A | Attempts to approve their own | **Refused** — existing `before_save` control |
| 3 | Finance B | Reviews and approves | `decided_by`, `decided_on`, `decision_note` recorded |
| 4 | — | On the effective date, approved values are **written to the Loan Product and Company** | The link CAP-1 adds; today approval records but does not apply |
| 5 | — | Nightly, `Process Loan Classification` ages the book into the new buckets | Already runs 57×; had nothing to classify into |

**Gates everything below.** Until J-0 lands, J-3's watch period is zero days and J-4 has no buckets to report.

---

## J-1 — She needs time before the first payment · CAP-3, CAP-4, CAP-10

| # | Actor | Today | After |
|---|---|---|---|
| 1 | Borrower | Buries "no sales until month 4" in the purpose text | **Funding step asks:** *"When can you realistically start repaying?"* — Straight away / After 3 months / After 6 months, with a reason line |
| 2 | Underwriter | Reads it, has nowhere to put it | Sees **Moratorium requested: 3 months** beside her projections |
| 3 | Underwriter | Writes it as a condition precedent — the only field available | Enters **Moratorium (months)**, bounded by policy; beyond his authority it escalates (CAP-10) |
| 4 | Borrower | Accepts an offer promising a holiday | Accepts an offer stating **first payment 31 Dec 2026** |
| 5 | Disbursement Officer | Ticks the moratorium "Met" on day one to unblock release | Books; `create_loan_on_offer` writes `moratorium_tenure: 3`, `moratorium_type: "EMI"` |
| 6 | Disbursement Officer | Releases against a schedule billing 30 Sept | **CAP-4 gate:** schedule is checked against the executed offer. Mismatch refuses release. |
| 7 | Borrower | First instalment due the day the money landed (F-14) | Schedule opens 31 Dec 2026. Arrears nil. Total repayable unchanged at G$1,200,000. |

---

## J-2 — She pays early · CAP-5, CAP-7, CAP-8

Trigger: G$200,000 spare, nothing yet due.

| # | Actor | Today | After |
|---|---|---|---|
| 1 | Borrower | Presses Pay | **Asked first:** finish sooner (G$50,000 × 21) or pay less each month (G$41,667 × 24), with *"you repay G$1,200,000 either way"* |
| 2 | System | Silently applies `advance_payment_handling: "Reduce Tenure"`, lending's default (F-3) | Applies **her** instruction; it is recorded against the payment |
| 3 | System | Creates an approved, submitted restructure owned by `Administrator` | Same schedule change, classified **Borrower-elected prepayment** — no flag, no watch period, excluded from restructured-exposure reporting (CAP-5) |
| 4 | Borrower | Told nothing (F-11) | Ledger shows the payment and, beneath it, *"Schedule revised at your request — instalments 24 → 21, final payment Apr 2028 → Jan 2028"* |
| 5 | Staff | 403 on the record (F-10) | Visible on the case to all three roles, with her instruction attached (CAP-8) |
| 6 | System | `loan_restructure_count` stays 0; header says 24, schedule says 21 (F-7, F-8) | Register maintained; header and schedule agree |

**The money moves identically.** What changes is who decided, whether it is a credit event, and who can see it.

---

## J-3 — She gets into difficulty at month 10 · CAP-6, CAP-10

G$700,000 owed, 14 instalments left, she can manage G$29,000.

| # | Actor | Today | After |
|---|---|---|---|
| 1 | Borrower | No route. Pays short, accrues arrears | **"Having difficulty paying?"** raises a Forbearance Request in her words |
| 2 | Underwriter A | — | Proposes a concession with a **reason code** (`BUYER_DEFAULT`), extending 14 instalments to 24 |
| 3 | System | — | Builds the revised schedule for review as a **draft**. Nothing has changed yet. G$700,000 over 24 → **G$29,167/month** |
| 4 | Underwriter A | — | Attempts to approve their own → **refused** (`is_same_person`) |
| 5 | Underwriter B | — | Reads the reason, checks the figures, approves. Above threshold it goes to the escalation body first (CAP-10) |
| 6 | Borrower | — | Receives a **variation to her agreement**, reads the revised terms, accepts in her own name |
| 7 | System | — | Only on her acceptance does the new schedule go live. Prior schedule retained, marked `Restructured` |
| 8 | System | Would return to "performing" instantly (F-2) | Classified **Concession**, flagged, **watch period starts**, provisioning posts, appears in restructured-exposure reporting |

**Outcome:** she pays G$29,167 and performs. GDB recovers the full G$700,000, ten months late, every step attributable.

---

## J-4 — The bank watches itself · CAP-2, CAP-5, CAP-9

**Daily, unattended:**

| Control | Fires when | Status today |
|---|---|---|
| Loan-vs-schedule reconciliation | `Loan.repayment_periods` ≠ Active schedule periods | **Would fire now** on ACC-LOAN-2026-00052 (24 vs 21) |
| Unapproved schedule change | A change with no maker **and** checker | Would fire on all 20 existing records |
| Watch-period breach | A concession reported performing inside its watch period | Cannot fire — watch period is 0 |
| Classification run | Nightly ageing into J-0's buckets | Runs, classifies nothing |

**Finance, weekly:** arrears ageing by bucket · forbearance rate · restructured book split into concession vs prepayment.

**Board / CEO, monthly:** portfolio, arrears summary, forbearance trend — aggregate only, case-level access refused. *The role does not exist; CAP-2 and CAP-5 produce its inputs.*

---

## What each persona gains

| Persona | Today | After |
|---|---|---|
| Borrower | Signed an agreement her schedule contradicts; a default decided her early payment; no route out of difficulty | Asked when she can start, asked how to apply early payments, has a route out of difficulty |
| Underwriter | Can express a moratorium only as prose the schedule ignores | A bounded field with authority limits; proposes concessions on the record |
| Disbursement Officer | Ticked a moratorium "Met" on day one, released against a contradicting schedule | A hard gate: terms mismatch blocks release |
| Finance | Zero days-past-due across the whole book; 20 invisible restructures | Real ageing, real classification, concessions reported apart from prepayments |
| Board | Does not exist | Has the figures it would need |
