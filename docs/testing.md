# Testing the loan lifecycle

How to exercise apply → review → book → disburse → repay, by hand.

**Everything here is manual.** There is no test suite in `backend/apps/gdb_bank`
or `frontend/`, and `.github/workflows/ci.yml` runs build → push →
`kubectl set image` with no test, lint or typecheck gate. Nothing in this
document protects the next change — see §9.

Verified against the running stack on 2026-09-12; lending pinned at v16.5.0.

## 1. Prerequisites

```bash
docker compose ps     # expect 5: mariadb, redis, backend, frontend, keycloak
```

**Keycloak is the one that bites.** It is not always up, and when it is down
e-ID sign-in fails with a message that blames the credentials. Confirm the
realm answers before blaming anything else:

```bash
docker compose up -d keycloak
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:8086/realms/gdb-citizen/.well-known/openid-configuration   # want 200
```

Rebuilds, after editing code:

| Changed | Command | Note |
| --- | --- | --- |
| backend Python | `docker compose up -d --build backend` | ~2 min; runs migrate + seeds |
| frontend | `npm run typecheck && npm run build` in `frontend/`, then `docker compose up -d --build frontend` | the container serves a baked bundle, not your `dist/` |

The backend app code is baked into the image — only `sites` is a volume. Editing
`backend/apps/gdb_bank/**` changes nothing until you rebuild.

## 2. Credentials

| Who | e-ID | Email | Password |
| --- | --- | --- | --- |
| Citizen | `592-1111-0001` | `citizen@example.gy` | e-ID `ChangeMe@123` · email `admin` |
| Underwriter | `592-2222-0002` | `underwriter@gdb.gov.gy` | e-ID `ChangeMe@123` · email `admin` |
| New citizen | `592-3333-0003` | *provisions on first sign-in* | `ChangeMe@123` |

Two credential stores, deliberately: Keycloak holds the e-ID passwords, Frappe
holds the email ones. Both end in the same `sid` session, so every test below
works after either.

Portal <http://localhost:3000> · desk <http://localhost:8080> · Keycloak
<http://localhost:8086> (`admin`/`admin`).

## 3. Fast smoke test (~60 seconds)

Exercises the whole chain through the API. Green throughout means the lifecycle
works end to end.

```bash
#!/usr/bin/env bash
set -e
B=http://localhost:8080
C=$(mktemp); U=$(mktemp)

curl -s -c $C -H 'Content-Type: application/json' -X POST $B/api/method/login \
  -d '{"usr":"citizen@example.gy","pwd":"admin"}' > /dev/null

APP=$(curl -s -b $C -H 'Content-Type: application/json' -X POST $B/api/method/gdb_bank.api.apply_loan \
  -d '{"loan_amount":900000,"purpose":"smoke test","term_months":12}' \
  | python -c "import json,sys;print(json.load(sys.stdin)['message']['name'])")
echo "applied:  $APP"

curl -s -c $U -H 'Content-Type: application/json' -X POST $B/api/method/login \
  -d '{"usr":"underwriter@gdb.gov.gy","pwd":"admin"}' > /dev/null

for step in "review_loan {\"name\":\"$APP\",\"action\":\"approve\"}" \
            "book_loan {\"application\":\"$APP\"}" \
            "disburse_loan {\"application\":\"$APP\"}"; do
  m=${step%% *}; body=${step#* }
  curl -s -b $U -H 'Content-Type: application/json' -X POST \
    $B/api/method/gdb_bank.api.$m -d "$body" > /dev/null
  echo "$m: ok"
done

curl -s -b $C -H 'Content-Type: application/json' -X POST $B/api/method/gdb_bank.api.make_repayment \
  -d "{\"application\":\"$APP\",\"amount\":50000}" \
| python -c "
import json,sys; m=json.load(sys.stdin)['message']; l=m['loan']
print('status         ', l['status'])
print('disbursed      ', l['disbursed_amount'])
print('schedule rows  ', len(m['schedule']))
print('paid           ', l['total_amount_paid'])
print('principal o/s  ', m['dues']['principal_outstanding'])"
```

Expect `Disbursed` · `900000` · `12` rows · `50000` paid · `850000` outstanding.

## 4. Browser walkthrough

1. Sign in as the citizen using the three-box e-ID control.
2. **Apply** — 2,500,000 over 36 months. Lands **Submitted**.
3. Log out. Sign in as the underwriter. **Review Queue** appears in the nav
   (it does not for a citizen). Open the application → **Approve**.
4. The **Booking & disbursement** panel appears → **Book loan** → `Sanctioned`.
5. The amount prefills with what lending reports as drawable → **Disburse**.
   The repayment schedule appears — disbursement is what generates it.
6. Log out. Sign in as the citizen. **Loan account** shows the schedule and
   dues → **Pay** → the balance moves.

**Then click "My Loans".** If you are bounced to the login screen, the session
bug has regressed — see §8.

Partial disbursement is worth exercising too: disburse part, confirm the status
becomes `Partially Disbursed` and the panel re-offers only the remainder.

## 5. Guard tests — every one of these must FAIL

| Attempt | Expected |
| --- | --- |
| Citizen calls `disburse_loan` or `book_loan` | `PermissionError` — "Only GDB underwriters may do this." |
| Book an application still `Submitted` | "Only an approved application can be booked" |
| Book the same application twice | "Loan … is already booked" |
| Disburse a fully-drawn loan | "not awaiting disbursement (status Disbursed)" |
| Repay with amount `0` or negative | "Enter an amount greater than zero." |
| Underwriter approves their **own** application | "You cannot review your own application." |
| Citizen opens someone else's application | "You may only view your own applications." |

The self-review guard needs the underwriter to apply for a loan themselves
first — it compares `gdb_owner` against the session user, not roles.

## 6. Auditing the calculations

Book a **clean, single-disbursement** loan first. Multiple disbursements
regenerate the schedule and make the arithmetic impossible to follow.

```bash
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site gdb.localhost console' <<'PY'
import json, frappe
LOAN = "ACC-LOAN-2026-00005"          # change me
s = frappe.db.get_value("Loan Repayment Schedule", {"loan": LOAN, "status": "Active"}, "name")
rows = frappe.get_all("Repayment Schedule", filters={"parent": s},
    fields=["idx","payment_date","principal_amount","interest_amount",
            "total_payment","balance_loan_amount"], order_by="idx asc")
open("/tmp/out.json","w").write(json.dumps(rows, default=str))
PY
docker compose exec -T backend bash -lc 'cat /tmp/out.json'
```

Check these **independently of the application** — an audit that calls lending's
own helpers only proves lending agrees with itself:

1. `principal + interest == instalment`, every row
2. `balance[n] == balance[n-1] − principal[n]`, every row
3. `Σ principal == disbursed_amount`
4. `Σ interest == Loan.total_interest_payable`
5. closing balance `== 0`
6. per-row day count: `interest ÷ (opening_balance × rate ÷ 365)`

All six held on a 1,200,000 / 8% / 12-month loan. Check 6 is the interesting
one — see §7.

## 7. Known findings — expected, not bugs to re-report

**Interest is billed on 31 days every month.** Check 6 above returns `31` for
every full period, including February (28 actual) and the 30-day months. Cause,
`loan_repayment_schedule.py:1021`:

```python
days = date_diff(payment_date, add_months(payment_date, -1))
```

Month-end due dates clamp when a month is subtracted, so the gap is always 31.
The opening stub period is correct (actual days from disbursement).

Consequence on a 1,200,000 / 8% / 12-month loan: 359 days billed against 353
elapsed — interest 50,010.20 versus 49,108.91 on true actual/365, an overcharge
of **901.29 (1.84%)**. The **effective annual rate is 8.153%, not 8%**
(31 × 12 = 372 days billed per 365-day year).

This is upstream lending behaviour, and all four monthly `repayment_schedule_type`
values reach the same branch — there is no configuration that yields actual/365.
Whether it is acceptable is a product and legal question about what the loan
agreement promises, not an engineering one. **Open.**

**Overpayment is accepted without a ceiling.** `make_repayment` validates only
`amount > 0`. A payment of 5,000,000 against a 1,095,613 balance was accepted
and booked as `excess_amount_paid: 3,904,387`. With `enable_loan_accounting = 0`
no GL entry exists either, so the money is recorded nowhere in the books and the
portal exposes no refund path. **Open — treat as a release blocker.**

**A fully repaid loan does not close.** Principal outstanding reached `0.00`
while status stayed `Disbursed`. **Open.**

**Prepayment goes entirely to principal.** Paying before anything is due reduces
principal with no interest component and no prepayment charge, though the product
has a `prepayment_charges` field. Borrower-favourable; needs to be a deliberate
policy. **Open.**

## 8. Gotchas that waste an afternoon

- **`localhost` shares cookies across :3000 and :8080.** Signing into the desk
  kills your portal session and vice versa. Log out of one first, or use two
  browser profiles.
- **Stale e-ID links** refuse sign-in with "already linked to a different e-ID".
  That guard is correct — the data is what is wrong. Inspect and clear:
  ```bash
  docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site gdb.localhost console' <<'PY'
  import frappe
  print(frappe.get_all("User", fields=["name","gdb_eid"], filters={"gdb_eid":["is","set"]}))
  # frappe.db.set_value("User", "citizen@example.gy", "gdb_eid", None); frappe.db.commit()
  PY
  ```
- **Editing `keycloak/gdb-realm.json` does nothing** on its own — Keycloak
  imports a realm only if it does not exist. Drop the volume first:
  `docker compose rm -sf keycloak && docker volume rm guyana-development-bank_keycloak-data`.
- **`frappe.set_user` destroys the caller's session.** It overwrites
  `local.session.sid` with the username. Never call it directly — use
  `_as_system()` in `api.py`, which restores `sid` and `session.data`. The
  symptom is a 200 followed by 403 on everything after.
- **`flt()` on a tuple returns `0.0` silently.** `get_disbursal_amount` returns
  `(disbursal_amount, pending_principal_amount)`; forgetting `[0]` yields a
  plausible zero with no error.

## 9. Postman

`docs/postman/gdb.postman_collection.json` — 20 requests. Run a Login first
(Postman keeps the `sid` automatically), set the `loanName` variable, then work
down Auth → Citizen → Underwriter.

## 10. What this does not cover

No part of this runs in CI, so none of it protects the next change. The session
bug in §8 was live in `make_repayment` and shipped silently — every citizen who
made a repayment was logged out, with no error and no log line.

First things worth automating, in order:

1. §3 as a pytest, plus a `whoami` call *after* the repayment — that single
   assertion catches the exact defect that shipped.
2. §5 guards — cheap, and they encode the authorisation rules.
3. §6 checks 1–5 against a fixed loan — pins the arithmetic against a lending
   upgrade.
4. Wire all of it into `ci.yml` **before** the image push, not after.
