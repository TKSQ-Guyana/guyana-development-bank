# E2E browser test plan — Facilitator-run group (cluster) loans

**Audience:** an AI agent driving a real browser (Playwright / Chrome DevTools
MCP) against a **local, disposable** GDB stack.
**Goal:** prove that group loans are formed and filed **only** by a GDB
Facilitator, that citizens can only accept, view and sign, and that every
server-side control holds even when the UI is bypassed.

Run every case in order within a section. Record a verdict for each case ID.
**Do not stop at the first failure.**

---

## 0. Rules of engagement

1. **Local stack only.** `http://localhost:3000` (portal), `:8080` (desk),
   `:8086` (Keycloak). Never run this against a shared or production
   environment: it creates users, groups and loan applications that cannot be
   deleted from the portal.
2. **One browser context per persona.** Sessions are a `sid` cookie on
   `localhost`, shared across ports. Two personas in one context overwrite
   each other. Use a separate isolated context (or incognito window) for each
   persona, and never sign in to the desk (:8080) in a portal context.
3. **Evidence for every case:** a screenshot of the final state. For a negative
   case also capture the network response: HTTP status and the message.
   Frappe returns `PermissionError` as **403** and `ValidationError` as **417**.
   The human-readable text is in `_server_messages` (JSON-encoded) or
   `exception`.
4. **Calling the API directly** (security cases): from the persona's own page,
   run this in the DevTools console:

   ```js
   const r = await fetch('/api/method/gdb_bank.api.<METHOD>', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ /* args */ }),
   });
   [r.status, await r.text()]
   ```
5. **Message checks are "contains" checks.** The expected text is given
   verbatim; ignore surrounding punctuation or HTML.
6. **Never type real personal data.** Use the fixture values below.

---

## 1. Preconditions (a human usually does these)

| # | Step | Check |
|---|------|-------|
| P1 | Backend rebuilt with this change: `docker compose up -d --build backend`, then wait for `Site … ready` in `docker compose logs -f backend`. | `POST /api/method/gdb_bank.api.whoami` as any signed-in user returns `is_facilitator`. |
| P2 | `migrate` ran, so the **Facilitator** role exists. | Desk → Role list shows `Facilitator`. |
| P3 | A Platform Admin exists (README → *First administrator*). | They can sign in on the portal's **GDB staff** tab. |
| P4 | Frontend serves the new build on `:3000`. | `/facilitator` exists (redirects away for a non-facilitator). |

### 1.1 Accounts to create

Create the staff accounts as the **Platform Admin** in the portal
(Administration → Users → create staff). Each one shows a **one-time
password**; the person changes it on first sign-in on the **GDB staff** tab.

| Persona | How | Role(s) | Fixture |
|---|---|---|---|
| FAC-A | Portal admin, staff | Facilitator | `fac.a@gdb.test` |
| FAC-B | Portal admin, staff | Facilitator | `fac.b@gdb.test` |
| UW | Portal admin, staff | Loan Underwriter | `uw@gdb.test` |
| DO | Portal admin, staff | Disbursement Officer | `do@gdb.test` |
| HEAD | Keycloak realm `gdb-citizen` | (Citizen on first sign-in) | e-ID `111-1111-0001`, `head@gdb.test` |
| MEM1 | Keycloak `gdb-citizen` | Citizen | e-ID `111-1111-0002`, `mem1@gdb.test` |
| MEM2 | Keycloak `gdb-citizen` | Citizen | e-ID `111-1111-0003`, `mem2@gdb.test` |
| OUT | Keycloak `gdb-citizen` | Citizen, never invited | e-ID `111-1111-0004`, `out@gdb.test` |
| LATE | **Not created yet** (see FAC-07) | — | e-ID `111-1111-0005`, `late@gdb.test` |

Citizen Keycloak users: username = the e-ID (with dashes), the email above, a
**permanent** password (`Temporary` off). Sign each citizen in once on the
portal's citizen tab before Section 3, **except LATE**.

Use group names prefixed `E2E ` plus a run stamp, e.g. `E2E Parika Cassava 0930`,
so reruns never collide.

---

## 2. Persona & navigation

| ID | Persona | Steps | Expected |
|---|---|---|---|
| NAV-01 | FAC-A | Sign in on **GDB staff** tab. | Lands on `/facilitator`. Sidebar shows **Groups** under *Bank*. The header shows a **Facilitator** badge. No *My applications*, *Payments* or *Review queue*. |
| NAV-02 | FAC-A | Open `/apply/new`, `/apply`, `/cluster`, `/payments`. | Each redirects to `/facilitator`. |
| NAV-03 | FAC-A | Open `/review`, `/disbursements`, `/admin/users`. | Each redirects away. No queue or admin data renders. |
| NAV-04 | FAC-A | Console: `whoami`. | `is_facilitator: true`. `is_underwriter`, `is_finance`, `is_disbursement` and `is_platform_admin` are all `false`. |
| NAV-05 | HEAD | Sign in on the citizen tab. Open `/facilitator`. | Redirects to `/`. No **Groups** item in the sidebar. |
| NAV-06 | FAC-A | Try the **citizen** sign-in tab with any e-ID. | Refused. A staff account never opens through the e-ID door. |

---

## 3. Facilitator happy path (one group, end to end)

Run as **FAC-A** unless stated otherwise.

| ID | Steps | Expected |
|---|---|---|
| FAC-01 | `/facilitator` → **New group**. | The wizard opens with a 5-step rail: **Group details · Members · Group plan · Facility · Review**. Status line reads *Not yet saved*. |
| FAC-02 | Press **Continue** with everything empty. | Red banner: *Enter the group name.* Nothing is created. |
| FAC-03 | Fill **Group name** = `E2E <stamp>`, **Group activity**, **Region** = Region 3, **Locality**, **Registration status** = Not registered → **Continue**. | URL becomes `/facilitator/groups/E2E%20<stamp>`. You are on **Members**. Back on step 1, **Group name** is disabled with the hint *Fixed once created.* |
| FAC-04 | Members: amber notice *No head yet…*. Add MEM1's e-ID; the name fills from the e-ID → **Add member**. Repeat for HEAD and MEM2. | Three rows, status **Invited**. Notice: *No acceptances yet — 3 invitations pending.* No **Make head** button on any row (none accepted). |
| FAC-05 | **HEAD** context: bell / `/apply?view=clusters`. | Invitation card *"<FAC-A name> invited you to join E2E <stamp>"* with **Accept** / **Decline**. The same card appears on `/cluster` under **Group invitations**. |
| FAC-06 | HEAD → **Accept**. MEM1 → **Accept**. MEM2 → **Decline**. | Each citizen's card disappears. `/cluster` for HEAD shows the group read-only: plan, Applications (*None yet.*), Members. There are **no** edit, invite or apply controls. |
| FAC-07 | FAC-A: add LATE's e-ID (no account yet). Then create LATE in Keycloak and sign LATE in for the first time. | Row **Invited** with no account. After LATE's first sign-in, LATE's bell holds the invitation. Leave it unanswered. |
| FAC-08 | FAC-A: **Refresh statuses**. | HEAD and MEM1 **Accepted**, MEM2 **Declined**, LATE **Invited**. FAC-A's bell has *"… accepted the invitation to …"* and *"… declined …"*, linking to `/facilitator/groups/<group>`. |
| FAC-09 | Click **Make head** on HEAD's row. | The **Group head** read-only field shows HEAD's name and e-ID. HEAD's row shows the **Head** tag. HEAD's bell: *You are now the head of E2E <stamp>*. |
| FAC-10 | **Continue** → Group plan. Leave **Executive summary** empty → **Continue**. | Blocked: *Enter the executive summary.* |
| FAC-11 | Fill all 7 plan sections → **Continue**. | Saved. On **Facility**, *Borrower* shows HEAD (source *Group head*). |
| FAC-12 | Facility: amount `1200000`, tenor `24`, purpose, two proceeds lines → **Save and continue**. | On **Review**. Status line: *Draft ACC-LOAP-…*. *Total (as saved)* appears when you go back to Facility. |
| FAC-13 | Review: open each section. | Sections show **Complete**. Facility answers include *Borrower (group head)*, *Interest rate 0%*, and the proceeds lines. No attention panel. **Submit application** is enabled. |
| FAC-14 | **Submit application** → confirm *"Submit … in <HEAD>'s name?"*. | Green notice *Submitted to GDB in <HEAD>'s name.* Status *With GDB · …*. Edit links are hidden. The rail locks Group details, Group plan and Facility; Members and Review stay clickable. |
| FAC-15 | Notifications. | HEAD: *"…'s application was submitted to GDB in your name"* → `/loans/<app>`. MEM1: *"…'s application has been submitted to GDB"*. LATE (invited): *"…submitted — accept your invitation to see it"*. MEM2 (declined) gets nothing. |
| FAC-16 | `/facilitator` list. | The row shows the group, Region 3, Head = HEAD (with e-ID), *2 accepted · 1 invited*, a **Submitted** badge and G$1,200,000. |

### 3.1 Downstream (proves the case is a normal group case)

| ID | Persona | Steps | Expected |
|---|---|---|---|
| DS-01 | UW | `/review`. | The case is in the queue. The applicant is **HEAD**, identified by e-ID. Missing evidence lists *Identity, Personal Financials*. |
| DS-02 | HEAD | `/apply` → **Clusters** tab → open the case. | Case view, read-only. HEAD can upload their own Identity / Personal Financials from the case page. |
| DS-03 | MEM1 | Open the case. | Visible. HEAD's phone and income are **not** shown. |
| DS-04 | OUT | Open `/loans/<app>` directly. | Refused or not found. No case data renders. |
| DS-05 | UW | Approve, then issue the Letter of Offer. | Offer issued. The signature roster is HEAD + MEM1 only, not LATE (invited) and not MEM2 (declined). |
| DS-06 | HEAD, MEM1 | Each signs the offer on the case page. | Both signatures recorded. The case moves to booking for DO. |
| DS-07 | FAC-A | `/facilitator/groups/<group>` → Review. | Read-only. Shows *With GDB · <stage label>*. No offer, signature or money controls exist anywhere for FAC-A. |

---

## 4. Edge cases — facilitator wizard

| ID | Setup | Steps | Expected |
|---|---|---|---|
| EC-01 | Any | New group with a name that already exists. | *A group called … already exists.* |
| EC-02 | Group with no head | Go to **Facility** → **Save and continue**. | Blocked: *Name the group head on Members first.* |
| EC-03 | Group, member Invited only | **Make head** is absent for that row. Console: `set_cluster_head({cluster, eid})`. | 417: *The head must be a member who has accepted the invitation.* |
| EC-04 | Draft exists | Members → try **Make head** on another accepted member. | The button is hidden once an application exists. Console `set_cluster_head` → 417 *The head cannot change once the group has an application.* |
| EC-05 | Any group | **Remove** on the head row. | No Remove button on the head. Console `remove_member({cluster, eid: <head>})` → *The head cannot be removed. Name another head first.* |
| EC-06 | Invited row | **Withdraw** → confirm. | The row disappears. The invitee's bell: *Your invitation to join … was withdrawn*. |
| EC-07 | Accepted non-head row | **Remove** → confirm. | Status **Exited**, row kept. Member's bell: *You are no longer part of …*. |
| EC-08 | Re-invite an Exited or Declined e-ID. | Add the same e-ID again. | Accepted. The row returns to **Invited**. |
| EC-09 | Duplicate invite of an Invited or Accepted e-ID. | Add again. | *… is already in this group or invited to it.* |
| EC-10 | FAC-A's own e-ID is recorded on their staff account (admin sets *staff e-ID*). | Invite that e-ID. | 403 *You cannot invite yourself to a group you facilitate.* |
| EC-11 | Head named, **no other accepted member** | Review. | Attention: *At least one other member must accept.* (Members · Awaiting members). **Submit application** is disabled. Console `submit_group_application` → *At least one member besides the head must accept before submitting.* |
| EC-12 | Draft, then clear **Shared project** | Plan step → **Continue**. | Client blocks: *Describe the shared project.* Console: save the plan with `plan_shared_project: ""`, then `submit_group_application` → *Complete the executive summary and shared project before submitting.* |
| EC-13 | Draft exists | Console `save_group_application` **without** `name`, twice. | Both return the **same** draft name. No second draft (retry-safe). |
| EC-14 | Group submitted (open) | Console `save_group_application`. | 417 *This group already has an application with GDB: ACC-LOAP-…* |
| EC-15 | Group submitted | Console `save_cluster_plan({cluster, plan_market:'x'})` and `save_cluster_details`. | *The group's application is with GDB. Its plan and details are locked.* |
| EC-16 | Draft exists | Review → **Discard draft** → confirm. | Draft removed. Status *Group saved · no application yet*. The group, members and plan remain. |
| EC-17 | Previous application **Rejected** by UW | Open the group. | Warning *Previous application … was not approved. A new one can be filed.* Facility can be saved again, producing a new draft. |
| EC-18 | Mid-wizard | Reload the browser on `/facilitator/groups/<group>`. | Reopens on **Review** with every saved answer intact. The attention list shows what is still missing. |
| EC-19 | Network drop | DevTools *Offline* → **Save and continue** on Facility → back *Online* → retry. | The first attempt shows an error and stays on the step. The retry succeeds, with no duplicate draft (see EC-13). |
| EC-20 | Validation | Tenor `0`, `361`; amount empty or `0`. | Blocked with *Enter a tenor of 1 to 360 months.* / *Enter the loan amount.* |
| EC-21 | Mobile | Viewport 390×844. Run FAC-01 to FAC-14. | The rail scrolls horizontally and keeps the current step in view. No horizontal page scroll. The sticky Back/Continue bar never covers a field. |

---

## 5. Security & separation of duties (bypass the UI)

| ID | Persona | Console call | Expected |
|---|---|---|---|
| SEC-01 | HEAD | `create_cluster({cluster_name:'E2E hack'})` | 403 *Only a GDB facilitator may do this.* |
| SEC-02 | HEAD | `invite_member({cluster:<group>, eid:'111-1111-0004'})` | 403 *Only a GDB facilitator may do this.* |
| SEC-03 | HEAD | `save_application({loan_amount:1, purpose:'x', term_months:12, cluster:<group>})` | 403 *Group applications are filed by the group's GDB facilitator.* |
| SEC-04 | HEAD | `submit_application({name:<group draft>})`, `discard_application({name:<group draft>})` | 403 *A group's application is managed by its GDB facilitator.* |
| SEC-05 | HEAD | `save_cluster_plan({cluster:<group>, plan_market:'x'})` | 403 *Only a GDB facilitator may do this.* |
| SEC-06 | FAC-B | `cluster_view`, `invite_member`, `save_group_application`, `submit_group_application` on FAC-A's group | 403. Writes say *Only the group's facilitator may do this.*; `cluster_view` says *You are not a member of this cluster.* FAC-B's `/facilitator` list does not show FAC-A's group. |
| SEC-07 | FAC-A | `all_loans({})`, `review_loan`, `book_loan`, `disburse_loan` on the group case | 403 on every one. |
| SEC-08 | FAC-A | `loan_detail({name:<group app>})` | Refused. The facilitator reads the case only through `cluster_view`. |
| SEC-09 | FAC-A | `cluster_view({cluster:<group>})` | Members' `profile` is `null`. The group case has `phone` and `monthly_income` as `null`. |
| SEC-10 | Platform Admin | Grant **Facilitator + Loan Underwriter** to one staff account. | Refused: *Facilitator cannot be combined with another role.* Granting Facilitator alone succeeds. |
| SEC-11 | Platform Admin | Grant **Facilitator** to a citizen account. | Refused: *Citizen accounts carry no staff roles…* |
| SEC-12 | DO | `invite_member`, `create_cluster` | 403 *Only a GDB facilitator may do this.* |
| SEC-13 | Disabled FAC-A | Admin disables FAC-A, then FAC-A reloads. | Session ends. Sign-in is refused. |
| SEC-14 | Any | `set_cluster_head` with a malformed e-ID (`123`) | 417 validation error. Nothing changes. |

---

## 6. Citizen-side removal (regression)

| ID | Persona | Steps | Expected |
|---|---|---|---|
| CIT-01 | OUT | `/apply/new`. | Application type shows **Existing business · New venture · Quick Loan** only. |
| CIT-02 | OUT | Continue as *New venture*. | Legal structure offers **Sole proprietorship · Incorporated (Inc.) · Partnership**. No *Cluster* card. |
| CIT-03 | OUT | Existing business with a DCRA registration (if DCRA is configured). | No *Apply as a cluster?* question. The structure comes from the register. |
| CIT-04 | OUT | Walk the whole wizard. | The rail never shows Group, Members or Group plan steps. The Documents tab has no *Personal financial statement* row. |
| CIT-05 | OUT | `/` dashboard. | No *Cluster-supported loan* tile. The hero line does not mention clusters. |
| CIT-06 | OUT | `/cluster`. | *No groups yet — Group loans are arranged by a GDB facilitator.* No *Start a cluster* form. |
| CIT-07 | HEAD | `/apply/<group draft name>` typed in the URL (while it is still a draft). | Redirects to `/loans/<name>`. It never opens in the citizen wizard. |
| CIT-08 | OUT | `/apply` → **Clusters** tab, empty. | *No group applications yet — Arranged by a GDB facilitator.* |

---

## 7. Known gaps (report, do not fail)

- **Groups formed by citizens before this change** have no facilitator. Their
  members can still read them, but nobody can invite, edit or file for them,
  and there is no screen to assign a facilitator. Report any found as
  *legacy-orphan*.
- **Group-level documents.** The facilitator cannot upload documents. Each
  person uploads their own Identity / Personal Financials from the case page.
- **Disbursement account.** The payout goes to the head's own nominated
  account (their *My details*). The facilitator never sets it.
- **System Manager** passes the facilitator role check, as it passes every
  role check (documented break-glass gap). It still cannot act on a group it
  does not facilitate.

---

## 8. Report format

Return one Markdown table and nothing else above it:

| ID | Verdict (PASS / FAIL / BLOCKED / GAP) | Evidence (screenshot file, HTTP status + message) | Notes |
|---|---|---|---|

Then list every **FAIL** with: steps to reproduce, expected vs actual, the
persona, the request (method + body) and the full response body.
