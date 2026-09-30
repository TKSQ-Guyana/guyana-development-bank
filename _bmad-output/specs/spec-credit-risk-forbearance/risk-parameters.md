# Risk parameters

Every value here is a **proposal**, not a decision. Each is set through CAP-1 — proposed by one
Finance officer, approved by a second, effective-dated — never hardcoded. The starting values
below are drafting positions for that first proposal; the open questions in SPEC.md name the
ones GDB must actually answer.

## Delinquency classification — `Company.loan_classification_ranges`

Currently `[]`. Proposed starting ranges, on days past due:

| Bucket | Days past due | Meaning |
|---|---|---|
| Standard | 0 – 30 | Performing |
| Special Mention | 31 – 60 | Early warning; contact the borrower |
| Sub-Standard | 61 – 90 | Deteriorating |
| Doubtful | 91 – 180 | Recovery uncertain |
| Loss | 181+ | Full provision |

## Thresholds

| Parameter | Where it lives | Now | Proposed | Why it matters |
|---|---|---|---|---|
| NPA threshold | `Loan Product.days_past_due_threshold_for_npa` | unset | 90 days | Drives the NPA flag, which `collection_offset_logic_based_on: "NPA Flag"` already depends on |
| Watch period after a concession | `Company.watch_period_post_loan_restructure_in_days` | **0** | 180 days | A restructured loan must not read as cleanly performing the moment it is restructured |
| Maximum moratorium | new, GDB-held | none | 6 months | Bounds underwriter discretion (CAP-10) |
| Advance-payment default | `Loan Product.advance_payment_handling` | `"Reduce Tenure"` (lending's default) | GDB's explicit choice | Becomes the default only; CAP-7 lets the borrower override per payment |

## Concession reason codes — CAP-6

A concession is not valid without one. Starting set:

| Code | Use |
|---|---|
| `BUYER_DEFAULT` | A named customer failed and income dropped |
| `SECTOR_SHOCK` | Market or sector-wide event |
| `NATURAL_EVENT` | Flood, drought, fire |
| `ILLNESS_INCAPACITY` | Borrower or key person unable to trade |
| `COMMISSIONING_DELAY` | Asset the loan funded is late into service |
| `OTHER` | Free text required |

## Schedule-change event classification — CAP-5

The domain decision this spec turns on. lending files all three under one `restructure_type`;
GDB must report them apart.

| lending `restructure_type` | GDB classification | Flagged | Watch period | In restructured-exposure reporting |
|---|---|---|---|---|
| `Normal Restructure` | **Concession** | Yes | Yes | **Yes** |
| `Advance Payment` | Borrower-elected prepayment | No | No | No |
| `Pre Payment` | Borrower-elected prepayment | No | No | No |

A concession arises from the borrower's difficulty and is a credit event. A prepayment arises
from her choosing to pay early and is not. Counting them together makes the restructured-exposure
figure wrong in both directions — inflated by the 20 prepayments already on the book, and unable
to isolate genuine hardship within it.

## Authority matrix — CAP-10

Structure proposed; thresholds are an open question.

| Action | Underwriter | Escalation |
|---|---|---|
| Moratorium at origination | up to the policy maximum | beyond it |
| Concession — term extension | up to a facility-size limit | beyond it |
| Concession — any write-off element | never | always |

## Applies-to

These parameters govern `Loan Product` **GDB-STD** ("GDB Standard Loan", 0% term loan) and the
`Guyana Development Bank` Company record. A second product would carry its own values through
the same proposal route.
