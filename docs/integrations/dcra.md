# DCRA integration contract

The Deeds and Commercial Registries Authority holds the register of business
names and companies in Guyana. GDB reads it at application time so an applicant
with an existing registered business supplies a registration number and nothing
else — name, type, standing and proprietors come from the register.

Adapter: `gdb_bank/integrations/dcra.py` — `lookup` and `businesses_for`. It
holds no data; every call goes through `gdb_bank/integrations/client.py`.

## What GDB needs from DCRA

A read-only lookup by registration number.

```
GET {dcra_base_url}/registrations/{registration_number}
Accept: application/json
```

**200 — found**

```json
{
  "registration_number": "BN-2024-004512",
  "business_name": "Essequibo Cassava Processors",
  "business_type": "Business Name",
  "status": "Active",
  "registered_on": "2024-03-18",
  "region": "Region 2 — Pomeroon-Supenaam",
  "proprietors": ["Hemanth Narine"],
  "proprietor_eids": ["592-1111-0001"]
}
```

**404 — no such registration.** Any other status, or no response, is treated as
the registry being unavailable.

| Field | Type | Why GDB needs it |
|---|---|---|
| `registration_number` | string | the key; echoed back normalised |
| `business_name` | string | prefills the application, so it is never retyped |
| `business_type` | string | Business Name / Company — changes what evidence applies |
| `status` | string | **Active / Struck Off / Suspended** — standing is a credit fact |
| `registered_on` | date | trading history; a registration days old is a different case |
| `region` | string | regional reporting and Field Officer routing |
| `proprietors` | string[] | display only — names are not the match key, see below |
| `proprietor_eids` | string[] | **the anti-impersonation check** — GDB matches the caller's own e-ID against this list, never the name |

`business_name` and `status` are the two GDB cannot proceed without.
`proprietor_eids` is what `gdb_bank.api.my_businesses` and the ownership note
on `dcra_lookup` are built on — without it every match falls back to name
comparison, which two registers can spell differently for the same person.

## Proprietor search

Used to list the registrations a signed-in citizen may pick from, keyed by
e-ID rather than name for the same reason as above.

```
GET {dcra_base_url}/registrations?proprietor_eid={eid}
Accept: application/json
```

**200** — `{"registrations": [ <registration objects, same shape as above> ]}`
(or a bare array). Any other status, or no response, is treated the same as
an unreachable registry: the caller gets no matches and falls back to manual
entry, never a fabricated one.

## Authentication

When `dcra_api_key` is set, every request carries
`Authorization: Bearer <dcra_api_key>`. With no key, no credentials are sent.
The scheme is one line in `integrations/client.py`; if DCRA asks for a
different header or mTLS, that is the only place it changes.

**FLAG: REQUIREMENT CLARIFICATION NEEDED** — DCRA has not confirmed its auth
scheme, its rate limits, or whether GDB may cache a response (and for how
long).

## Configuration

Two settings, read through `integrations/settings.py`. The first place that
has a value wins:

| Where | How |
|---|---|
| Portal | Administration → Integrations → DCRA business registry. The API key is stored encrypted and is never shown again. |
| `site_config.json` | `"dcra_base_url": "https://<dcra-host>/api/v1"`, `"dcra_api_key": "…"` |
| Environment | `DCRA_BASE_URL`, `DCRA_API_KEY` |

With no base URL the integration is **off**. There is no stand-in register:
GDB holds no business data of its own.

## Two sources, never a guess

Every result carries `source`:

| `source` | Meaning | May an underwriter rely on it? |
|---|---|---|
| `dcra` | the registry answered | **yes** |
| `unavailable` | not configured, or did not respond | **no** |

An unavailable check that looks like a pass is the failure mode this whole
design exists to prevent — the same rule §5.3 applies to every verification
check. Nothing is recalled from GDB's own earlier filings either: a remembered
name beside a registration number reads as a confirmation it is not.

`status: "Unavailable"` is therefore distinct from `status: "Not Found"`. The
first means GDB does not know; the second means DCRA says there is no such
registration.

## Testing against it

Point `dcra_base_url` at DCRA's own test environment, or at a mock server you
run that speaks the contract above. The portal's Integrations screen has a
**Test** button that reports whether the service answers.
