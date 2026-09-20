# DCRA integration contract

The Deeds and Commercial Registries Authority holds the register of business
names and companies in Guyana. GDB reads it at application time so an applicant
with an existing registered business supplies a registration number and nothing
else — name, type, standing and proprietors come from the register.

Adapter: `gdb_bank/integrations/dcra.py`. One public function, `lookup`.

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

Not yet agreed. The adapter sends no credentials. If DCRA requires an API key
or mTLS, it goes in site config alongside `dcra_base_url` and into `_live()`.

**FLAG: REQUIREMENT CLARIFICATION NEEDED** — auth scheme, rate limits, and
whether GDB may cache a response (and for how long).

## Configuration

Set in the site config to use the live registry:

```json
{ "dcra_base_url": "https://<dcra-host>/api/v1" }
```

Unset, the adapter serves a small sandbox register instead.

## Three outcomes, never two

Every result carries `source`:

| `source` | Meaning | May an underwriter rely on it? |
|---|---|---|
| `dcra` | the registry answered | **yes** |
| `sandbox` | stand-in register answered | **no** — build and test only |
| `unavailable` | not configured, or did not respond | **no** |

A configured-but-unreachable registry returns `unavailable`. It never falls
through to the sandbox, because an unavailable check that looks like a pass is
the failure mode this whole design exists to prevent — the same rule §5.3
applies to every verification check.

`status: "Unavailable"` is therefore distinct from `status: "Not Found"`. The
first means GDB does not know; the second means DCRA says there is no such
registration.

## Sandbox register

Used only while `dcra_base_url` is unset. Contents are stand-ins, not real
registrations, and always carry `source: "sandbox"`.

| Number | Business | Status |
|---|---|---|
| `BN-2024-004512` | Essequibo Cassava Processors | Active |
| `BN-2023-001987` | Demerara Coast Fisheries | Active |
| `C-2022-000734` | Berbice Agro Supplies Inc. | Active |
| `BN-2019-000442` | Linden Timber Works | **Struck Off** |

The struck-off entry is deliberate: an underwriter must be able to see a
business that exists but is no longer in good standing, and the flow has to
handle it.

Each sandbox entry also carries a stand-in `proprietor_eids`, matching the
shape of the seeded e-IDs in `keycloak/gdb-realm.json`, so the proprietor
search and the ownership check can be exercised end to end without a live
registry.
