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
`accounts_for` and `verify`. It holds no data; every call goes through
`gdb_bank/integrations/client.py`.

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

When `bank_registry_api_key` is set, every request carries
`Authorization: Bearer <bank_registry_api_key>`. With no key, no credentials
are sent. The scheme is one line in `integrations/client.py`; if the switch
asks for a different header or mTLS, that is the only place it changes.

**FLAG: REQUIREMENT CLARIFICATION NEEDED** — four things:

1. **Auth scheme** (not yet confirmed by the switch) and rate limits.
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

Two settings, read through `integrations/settings.py`. The first place that
has a value wins:

| Where | How |
|---|---|
| Portal | Administration → Integrations → Bank account registry. The API key is stored encrypted and is never shown again. |
| `site_config.json` | `"bank_registry_base_url": "https://<switch-host>/api/v1"`, `"bank_registry_api_key": "…"` |
| Environment | `BANK_REGISTRY_BASE_URL`, `BANK_REGISTRY_API_KEY` |

With no base URL the integration is **off**. There is no stand-in register:
discovery returns nothing, the citizen types the account, and `verify` answers
`Unavailable`.

## Two sources, five outcomes

Every result carries `source`:

| `source` | Meaning | May an underwriter rely on it? |
|---|---|---|
| `bank_registry` | the switch answered | **yes** |
| `unavailable` | not configured, or did not respond | **no** |

An unavailable check that looks like a pass is the failure mode this design
exists to prevent (plan.md §6.1).

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

## Who discovery works for

Discovery is keyed on `User.gdb_eid`, which `identity.py` writes the first
time that person signs in with an e-ID and which then persists. So it is the
**account**, not the session, that decides. A user who has never signed in
with an e-ID has no `gdb_eid`, gets the manual path, and `verify` carries the
whole control.

## Testing against it

Point `bank_registry_base_url` at the switch's own test environment, or at a
mock server you run that speaks the contract above. The portal's Integrations
screen has a **Test** button that reports whether the service answers.
