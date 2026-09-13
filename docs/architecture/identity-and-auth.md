# Identity & Auth — e-ID via Keycloak

Edit the mermaid blocks directly. Verified against frappe `version-16` source (file:line cited).

## 1. Who does what

| Layer | Owns | Does NOT own |
| --- | --- | --- |
| My Guyana (EK Digital) | e-ID, biometric, passport, TIN, identity proofing | anything in aLOS |
| Keycloak | brokering, realms, sessions, claims, roles, service accounts | credit data |
| Frappe | `sid` session, User, roles, permissions, all business data | identity proofing (R-008) |

```mermaid
flowchart LR
  subgraph UP["Upstream — not ours"]
    MG["My Guyana IdP<br/>e-ID · biometric · passport · TIN"]
  end
  subgraph KC["Keycloak — IAM"]
    RC["realm: gdb-citizen<br/>brokers My Guyana"]
    RS["realm: gdb-staff<br/>9 persona roles"]
    SA["service accounts<br/>client_credentials"]
  end
  subgraph FR["Frappe / ERPNext"]
    SLK["Social Login Key<br/>keycloak · gdb_staff"]
    U["User + Roles + User Permissions"]
    P["GDB Person<br/>unique person_key"]
  end
  SPA["React SPA<br/>apply. / staff."]

  MG -->|OIDC broker| RC
  SPA -->|1 authorize| RC
  SPA -->|1 authorize| RS
  RC -->|2 code| SLK
  RS -->|2 code| SLK
  SLK -->|3 token + userinfo| U
  U --> P
  SA -->|outbound M2M| EXT["registries · bureau · screening · Coursera"]
```

## 2. Two auth systems — where they meet

- **Keycloak session** — `KEYCLOAK_SESSION` cookie on the Keycloak host. Owns *who you are*.
- **Frappe session** — `sid` cookie on the app host. Owns *what you may do*.
- They meet **once**, at the code exchange. Frappe reads userinfo, mints its own `sid`, and **discards the Keycloak tokens** (social-login path stores no access token).

⚠️ Consequence: two independent lifetimes. Logging out of Keycloak does not kill `sid`. Decide: back-channel logout, or short Frappe session + silent re-auth. Open item.

## 3. Citizen onboarding — first time

```mermaid
sequenceDiagram
  autonumber
  actor C as Citizen
  participant SPA as React SPA
  participant F as Frappe
  participant KC as Keycloak · gdb-citizen
  participant MG as My Guyana

  C->>SPA: "Continue with My Guyana"
  SPA->>F: gdb_bank.identity.get_login_url(keycloak)
  Note right of F: wraps get_oauth2_authorize_url()<br/>oauth.py:121 — mints anti-CSRF state
  F-->>SPA: authorize URL
  SPA->>KC: GET /protocol/openid-connect/auth
  KC->>MG: broker redirect
  C->>MG: e-ID / biometric
  MG-->>KC: assertion (guin, ridn, assurance)
  Note over KC: First Broker Login flow<br/>Detect Existing User → link, never duplicate
  KC-->>F: 302 code + state → login_via_keycloak
  F->>KC: POST /token  (code exchange)
  F->>KC: GET /userinfo
  KC-->>F: person_key, email, name
  Note right of F: get_email() oauth.py:361<br/>email MUST be present or login fails
  F->>F: update_oauth_user() oauth.py:337-341<br/>set_social_login_userid(keycloak, person_key)
  F->>F: default role Citizen (Portal Settings)
  F->>F: login_as() → post_login() → on_login  auth.py:356,171
  F->>F: hook: upsert GDB Person + Consent + Audit
  F-->>SPA: Set-Cookie sid
  SPA->>F: gdb_bank.api.whoami
```

Returning sign-in = same flow, steps 8–11 collapse (Keycloak SSO), `update_oauth_user` finds the existing User.

## 4. The three config values that carry the design

| Field | Value | Why |
| --- | --- | --- |
| `user_id_property` | `person_key` | preset ships `preferred_username` (social_login_key.py:238) — mutable, would break R-009/R-206. **Must override.** |
| `auth_url_data.scope` | `openid profile email` | preset ships `openid` only (`:239`) → no email → login hard-fails |
| `redirect_url` | relative path | `get_redirect_uri()` → `frappe.utils.get_url()` (oauth.py:165) resolves per request host → two hostnames work natively. Do not pin `host_name` in site_config. |

`person_key` = Keycloak script mapper emitting `guin ?? ridn`. Never CAN or Document Number (R-010/R-206). Mark it an **essential claim** so a keyless assertion fails auth.

## 5. Identity assurance lifecycle

```mermaid
stateDiagram-v2
  [*] --> NationalID: no e-ID (R-011)
  [*] --> EID: e-ID assertion
  NationalID --> EID: account link on person_key (R-205)
  EID --> Suspended: User.enabled = 0
  NationalID --> Suspended: User.enabled = 0
  Suspended --> EID: re-enabled
  Suspended --> [*]: deactivated
  note right of NationalID
    same GDB Person row
    no duplicate (R-013)
  end note
```

## 6. Account management

| Action | Where | Note |
| --- | --- | --- |
| Provision citizen | automatic | `sign_ups = Allow` + `Portal Settings.default_role = Citizen` |
| Provision staff | Platform Admin, manually | `sign_ups = Deny` — Keycloak identity alone grants nothing (R-180/R-181) |
| Suspend / deactivate | Frappe `User.enabled = 0` | `update_oauth_user` refuses a disabled user (oauth.py) — single kill switch, works even if Keycloak still authenticates |
| Password reset | n/a | no passwords. `System Settings.disable_user_pass_login = 1`, delete `gdb_bank.api.signup` |
| Consent | `GDB Consent` | versioned text retained (R-012/R-208) |
| Authorization | Frappe | Keycloak roles are the *source*; Frappe Roles + User Permissions + `permission_query_conditions` are the *enforcement* (R-170/R-212) |

## 7. Session separation (R-169/R-211)

```mermaid
flowchart TB
  A["apply.gdb.gov.gy<br/>sid (citizen)"] --> S["one Frappe site"]
  B["staff.gdb.gov.gy<br/>sid (staff)"] --> S
  A -.-> RC["realm gdb-citizen"]
  B -.-> RS["realm gdb-staff"]
```

`sid` is host-scoped → both contexts active independently. Separate realms → separate SSO sessions.

## 8. Build order

1. `keycloak` service (MariaDB 11.8 — Keycloak's tested version) + realm exports in `keycloak/realms/`
2. Mock OIDC IdP brokered into `gdb-citizen` — unblocks everything while T4 is open
3. `install.py` seeds both Social Login Keys + `Portal Settings.default_role`
4. `gdb_bank.identity.get_login_url` + SPA button
5. Prove login → `whoami` returns Citizen
6. Flip `disable_user_pass_login`, delete `signup`
7. `GDB Person` + `on_login` hook + audit
8. Staff realm + `permission_query_conditions`

## Open items

- Logout strategy (§2)
- Verify `login_via_keycloak` in the pinned image: `docker compose run --rm backend grep -n login_via_keycloak apps/frappe/frappe/integrations/oauth2_logins.py`
- My Guyana claim names — blocked on T4
