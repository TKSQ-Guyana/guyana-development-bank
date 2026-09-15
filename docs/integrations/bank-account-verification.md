# Bank account verification contract

GDB pays an approved loan into an account the citizen already holds at a
commercial bank. Two things have to be true before a payment instruction is
worth issuing: the account exists, and it is in the applicant's own name.

A typed account number proves neither. A transposed digit and a relative's
account look identical on a form, and money sent to either is money GDB does
not get back. So the portal does not ask for the number — it asks the national
payment switch which accounts the applicant's e-ID holds, and the applicant
picks one.

Adapter: `gdb_bank/integrations/bank_registry.py`. Two public functions,
`accounts_for` and `verify`.

## What GDB needs from the switch

### 1. Discovery — which accounts does this person hold?

```
GET {bank_registry_base_url}/accounts?national_id=592-1111-0001
Accept: application/json
```

**200**

```json
{
  "accounts": [
    {
      "bank": "Citizens Bank Guyana",
      "account_number": "0009111122223333",
      "account_name": "Demo Citizen",
      "branch_code": "CTZ-NA-07",
      "account_type": "Savings",
      "status": "Active"
    }
  ]
}
```

An empty list is a valid answer, and means the citizen types the account
instead. Any non-200, or no response, is the switch being unavailable.

### 2. Verification — is this one account real, and whose is it?

```
GET {bank_registry_base_url}/accounts/{account_number}?bank={bank}
Accept: application/json
```

**200 — found**

```json
{
  "bank": "Citizens Bank Guyana",
  "account_number": "0009111122223333",
  "account_name": "Demo Citizen",
  "branch_code": "CTZ-NA-07",
  "account_type": "Savings",
  "status": "Active",
  "reference": "AVS-2026-0913-88213"
}
```

**404 — no such account.** Any other status, or no response, is unavailable.

| Field | Type | Why GDB needs it |
|---|---|---|
| `bank` | string | must match a seeded `Bank`, or GDB cannot pay it |
| `account_number` | string | the key; echoed back normalised to digits |
| `account_name` | string | **the anti-misdirection check** — must match the applicant |
| `branch_code` | string | routing on the payment instruction |
| `account_type` | string | Savings / Current — some products cannot receive credits |
| `status` | string | **Active / Dormant / Closed** — a dormant account rejects a credit |
| `reference` | string | the switch's own id for the check, recorded as evidence |

`account_name` and `status` are the two GDB cannot proceed without.

## Name matching

`bank_registry.names_match` is forgiving about word order and punctuation and
nothing else: a bank holding `PERSAUD, ASHA` for the person GDB knows as
`Asha Persaud` is a match, and so is a middle name the bank holds and GDB does
not. Anything past that returns `False` and the case goes to a human.

Loosening this is not a code change to make casually — every relaxation is a
class of misdirected payment that stops being caught.

## Authentication

Not yet agreed. The adapter sends no credentials. If the switch requires an API
key or mTLS, it goes in site config alongside `bank_registry_base_url` and into
`_live_accounts()` / `_live_verify()`.

**FLAG: REQUIREMENT CLARIFICATION NEEDED** — four things:

1. **Auth scheme** and rate limits.
2. **Consent.** Discovery returns every account a person holds, keyed on their
   national ID. That is a disclosure, not a lookup, and it almost certainly
   needs the citizen's recorded consent at the point of asking — which the
   portal does not yet capture.
3. **Caching.** Whether GDB may store a result and for how long. A verification
   is a point-in-time fact: an account Active in March can be Closed in June,
   which is why release re-checks rather than trusting the application.
4. **Whether discovery exists at all.** If the switch offers only per-account
   verification, `accounts_for` returns nothing, every applicant types their
   account, and `verify` carries the whole control. The portal already behaves
   correctly in that case — this is a question about how good the experience
   can be, not whether the flow works.

## Configuration

Set in the site config to use the live switch:

```json
{ "bank_registry_base_url": "https://<switch-host>/api/v1" }
```

Unset, the adapter serves a small sandbox register instead.

## Three sources, five outcomes

Every result carries `source`:

| `source` | Meaning | May an underwriter rely on it? |
|---|---|---|
| `bank_registry` | the switch answered | **yes** |
| `sandbox` | stand-in register answered | **no** — build and test only |
| `unavailable` | not configured, or did not respond | **no** |

A configured-but-unreachable switch returns `unavailable`. It never falls
through to the sandbox, because an unavailable check that looks like a pass is
the failure mode this design exists to prevent (plan.md §6.1).

`api._check_result` reduces a result to one of five recorded outcomes:

| Outcome | Means |
|---|---|
| `Verified` | account exists, is Active, and the name matches |
| `Name Mismatch` | account exists, held in a different name |
| `Inactive Account` | account exists and the name matches — but Dormant or Closed |
| `Not Found` | the bank says there is no such account |
| `Unavailable` | GDB could not tell |

Stored on the `Bank Account` record as `gdb_verification_status`, alongside
`gdb_verification_source`, `gdb_verified_on` and `gdb_verification_reference`
— the result / source / timestamp / reference that plan.md §6.1 asks of every
external check.

## What this does and does not gate

**Does not gate the application.** None of the five outcomes stops a citizen
applying. A bank holding a maiden name is an underwriter's call, not a dead end
on a form, and §6.1 is explicit that an unavailable external check must not
block a case from reaching human review.

**Does gate release — not yet implemented.** plan.md §6.2: *"Only the verified
nominated bank account may receive funds."* The evidence a Disbursement Officer
needs is now recorded on every nominated account; the check that refuses to
authorise a payment instruction unless `gdb_verification_status` is `Verified`
belongs in the release path and is still to be built.

## Sandbox register

Used only while `bank_registry_base_url` is unset. Contents are stand-ins, not
real accounts, and always carry `source: "sandbox"`. Keyed by e-ID.

| e-ID | Bank | Account | Status |
|---|---|---|---|
| `592-1111-0001` | Citizens Bank Guyana | `0009111122223333` | Active |
| `592-1111-0001` | Demerara Bank | `0001222233334444` | Active |
| `592-2222-0002` | Demerara Bank | `0001777788889999` | Active |
| `592-3333-0003` | Citizens Bank Guyana | `0009000087654321` | Active |
| `592-3333-0003` | Republic Bank (Guyana) | `0004555566667777` | **Dormant** |
| `592-4444-0004` | Demerara Bank | `0001445566778` | Active |

Two entries are deliberate. `592-1111-0001` holds two accounts, so the "which
one?" path is exercised by the default demo login rather than only by a
hand-built case. `592-3333-0003`'s dormant account is a real account in the
right name that still cannot receive funds — the same reason DCRA's sandbox
carries a struck-off registration.

Discovery is keyed on `User.gdb_eid`, which `identity.py` writes the first
time that person signs in with an e-ID and which then persists. So it is the
**account**, not the session, that decides: once linked, discovery works on a
later email login too. A user who has never signed in with an e-ID — a
staff-created account, or a seeded demo user before its first e-ID login — has
no `gdb_eid`, gets the manual path, and `verify` carries the whole control.
