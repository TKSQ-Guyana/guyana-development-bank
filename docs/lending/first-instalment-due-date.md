# When a loan's first instalment falls due

**Status:** documented behaviour, not yet configurable in practice. Nothing in
this note has been changed on any site. The options at the end need a GDB
policy decision before anyone builds them.

## In one paragraph

Today every GDB loan's first instalment falls due on the **last day of the
month the money is released in**, for a **full month's instalment**. A loan
disbursed on 28 September is due on 30 September, two days later. A loan
disbursed on 30 September is due **the same day**. GDB's code does not choose
this date. GDB never tells lending when the first instalment is due, so lending
works one out from two Loan Product settings that GDB has never set. Those two
settings are hidden on the Loan Product form for the kind of product GDB uses.

## What was seen on the local stack (28 September 2026)

| Loan | Released | Monthly instalment | First due | Days after release |
|---|---|---|---|---|
| ACC-LOAN-2026-00050 | G$120,000 on 28 Sep | G$10,000 (120,000 ÷ 12) | 30 Sep | 2 |
| ACC-LOAN-2026-00049 | G$1,000,000 on 28 Sep, then G$800,000 the same day | G$55,556 after the first release, G$100,000 once both were out (1,800,000 ÷ 18) | 30 Sep | 2 |

Both borrowers paid on 28 September. That was before their due date, so lending
recorded each payment as an **Advance Payment** and rebuilt the schedule. After
that, the next instalments moved to the 28th of each month (28 Oct, 28 Nov, …).
Keep this in mind when reading a schedule that seems to have "lost" its
30 September row.

## How lending picks the date

GDB releases money through `api.disburse_loan`, which creates a lending
**Loan Disbursement** without a `repayment_start_date` (no file under
`backend/apps/gdb_bank` sets that field). When that document is saved, lending
fills the date in itself:

1. `LoanDisbursement.on_update` → `make_update_draft_schedule`
   ([loan_disbursement.py:119-121, 162-168](../../backend/lending_temp/lending/loan_management/doctype/loan_disbursement/loan_disbursement.py#L162-L168)).
   For a monthly loan with no start date, it calls
   `get_cyclic_date(loan_product, posting_date)`.
2. `get_cyclic_date`
   ([loan.py:2113-2129](../../backend/lending_temp/lending/loan_management/doctype/loan/loan.py#L2113-L2129))
   works it out like this:

```text
first_due = last day of the release month + cyclic_day_of_the_month
if (first_due - release date) < min_days_bw_disbursement_first_repayment:
    first_due = last day of first_due's month + cyclic_day_of_the_month   # pushed ONCE, never again
```

It reads two fields from the **Loan Product** ("GDB Standard Loan"):

| Field (label on the form) | Meaning | GDB's value today |
|---|---|---|
| `cyclic_day_of_the_month` ("Cyclic Day Of the Month") | days after month-end that an instalment falls due | not set, read as **0** |
| `min_days_bw_disbursement_first_repayment` ("Minimum days between Disbursement date and first Repayment date") | shortest gap allowed before the first instalment; a shorter gap pushes the date one month later | **0** (the field's default) |

A loan with a moratorium gets that many months added. The two loans above had
none; their dates were not shifted.
Lending refuses only a first due date **before** the release date
([loan_disbursement.py:413-417](../../backend/lending_temp/lending/loan_management/doctype/loan_disbursement/loan_disbursement.py#L413-L417)),
so a same-day due date is accepted.

### Why it is a full instalment

GDB lends at 0%. The product also has "broken period" handling, which charges
extra interest for a short first month. At 0% that extra interest is zero, so
nothing reduces the first instalment and it is a normal one.

## Worked examples

Release dates are in September 2026. The first table uses today's settings; the
rest show what other values would do.

| Cyclic day | Minimum days | Released | First due | Gap |
|---|---|---|---|---|
| 0 | 0 | 2 Sep | 30 Sep | 28 days |
| 0 | 0 | 28 Sep | 30 Sep | 2 days |
| 0 | 0 | 30 Sep | **30 Sep** | **0 days** |
| 0 | 30 | 28 Sep | **30 Sep** | 2 days, unchanged, see the trap below |
| 5 | 0 | 28 Sep | 5 Oct | 7 days |
| 5 | 30 | 28 Sep | 5 Nov | 38 days |
| 5 | 30 | 2 Sep | 5 Oct | 33 days |
| 5 | 60 | 28 Sep | 5 Nov | 38 days, below 60 but pushed only once |

**The trap:** with the cyclic day at 0, the "minimum days" setting has no
effect. The push moves the date to "last day of the month the date is already
in, plus 0", which is the same date. A minimum gap only works when the cyclic
day is 1 or more.

## Can GDB change it today?

Not cleanly:

- **The fields are hidden.** The Loan Product form shows both only when
  *Repayment Schedule Type* is "Monthly as per cycle date"
  ([loan_product.json:300-307, 329-336](../../backend/lending_temp/lending/loan_management/doctype/loan_product/loan_product.json#L300-L336)).
  GDB's product is "Monthly as per repayment start date"
  ([install.py:891](../../backend/apps/gdb_bank/gdb_bank/install.py#L891)),
  so the desk hides them, but lending still reads them.
- **A value set some other way would stay.** `install.ensure_product_terms`
  runs on every migrate but only sets `rate_of_interest` and
  `validate_normal_repayment`
  ([install.py:906-926](../../backend/apps/gdb_bank/gdb_bank/install.py#L906-L926)),
  so it would not undo either field.
- **Only new releases would change.** An existing schedule keeps its dates.

## Ways to make it configurable (not built)

| Option | What changes | For | Against |
|---|---|---|---|
| **A. Set the two product fields** as a seeded, documented GDB setting (e.g. applied by an install step, like the 0% rate) | Loan Product values only | Lending's own rule, no new GDB logic | Hidden in the desk, so staff can't see or edit them there. The cyclic day must be 1 or more or the minimum gap does nothing. Due dates become "Nth of the month". |
| **B. Switch the product to "Monthly as per cycle date"** | Loan Product type, which shows the two fields in the desk | Staff can see and edit the rule in the ERPNext desk | Changes how lending builds every new schedule; needs its own testing across release, repayment and rescheduling |
| **C. GDB passes `repayment_start_date` on each release**, from a GDB setting or from the Letter of Offer | `api.disburse_loan` (code) plus a setting | The date the borrower signed for can be stated in the offer; any rule, e.g. "one full month after release" | GDB code decides a lending date, which lending would otherwise own; the rule must be written and tested |

Whichever is chosen, the portal needs no change to *show* the date. The
Payments page and the Statements page already read it from lending's schedule.

**Recommendation:** if the Letter of Offer should tell the borrower when their
first payment is due, choose **C**; that is the only option where the signed
agreement and the schedule are guaranteed to agree. If a uniform rule is enough,
**B** keeps the rule visible and editable in the desk, where lending expects it
to be configured.

## How to check a loan's first due date

- **Portal:** Payments → pick the facility → the first row of the schedule.
- **ERPNext desk:** Loan Repayment Schedule list, filtered by the loan, status
  *Active* → *Repayment Start Date*.
- **Frappe REST** (as staff):
  `GET /api/resource/Loan Repayment Schedule?filters=[["loan","=","ACC-LOAN-2026-00050"]]&fields=["name","status","repayment_start_date"]`

Note: an Advance Payment rebuilds the schedule, so the *Active* schedule may
start later than the one created at release. The earlier ones stay in the list
with status *Rescheduled* or *Outdated*.
