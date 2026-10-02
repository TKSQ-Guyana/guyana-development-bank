# E2E browser test plan — Field Officer: assist requests, assisted applications, field work

**Audience:** an AI agent driving a real browser (Chrome DevTools MCP or
Playwright) against a **local, disposable** GDB stack. You verify by taking
**screenshots** and reading the visible text. You do not need to read the code.
**Goal:** prove that a Field Officer can help a citizen apply, can submit the
application to GDB or send it back to the citizen, that every screen shows who
submitted it, that field work requested by an underwriter is reported correctly,
and that an officer can never see another citizen's records.

Run the sections in order. Record a verdict for **every** case ID.
**Do not stop at the first failure** — note it and continue.

---

## 0. Rules of engagement — read all of this first

1. **Local stack only.** Never run this against a shared or production
   environment: it creates loan applications that cannot be deleted.
2. **The portal URL.** Use `PORTAL = http://localhost:5173` (the dev server,
   which has the latest code). If a human tells you the frontend container was
   rebuilt, `http://localhost:3000` works too. Every URL below is relative to
   `PORTAL`.
3. **One isolated browser context per persona.** Three personas: `CITIZEN`,
   `OFFICER`, `UNDERWRITER`. Open each in its own isolated context
   (e.g. `new_page(..., isolatedContext: "citizen")`). Two personas in one
   context log each other out.
4. **Screenshot rule.** At every line marked 📸, take a screenshot and save it as
   `<CASE-ID>.png` (e.g. `FO-QL-03.png`). Then read the screenshot (or the
   page's text) and compare it to the **Expected** list. A case **passes only if
   every Expected item is visibly true**. Quote the exact on-screen text you saw
   in your report.
5. **"Contains" checks.** Expected text is given verbatim in quotes. It passes if
   the screen contains it; ignore surrounding punctuation, spacing and case.
6. **Never invent a result.** If a page is still loading ("Loading…"), wait up
   to 20 seconds and screenshot again. If something is missing, the case FAILS —
   say what you saw instead.
7. **Clicking.** "Click **X**" means click the button or link whose visible text
   is exactly `X`. If there are two, the one that is **not** inside an open
   dialog unless the step says "in the dialog".
8. **Typing into date, time and multi-line boxes.** The browser tool's `fill`
   does not always reach these. If after filling, the value disappears or the
   next button stays disabled, set the value with this snippet in the page
   (replace the selector and value):

   ```js
   (() => {
     const el = document.querySelector('SELECTOR');           // e.g. 'dialog input[type=date]', 'main textarea'
     const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, 'VALUE');  // date: '2026-10-05', time: '14:30'
     el.dispatchEvent(new Event('input', { bubbles: true }));
     return el.value;
   })()
   ```
9. **Confirm dialogs** (`window.confirm`, e.g. "Send to … to check and submit?"):
   accept them unless the step says otherwise.
10. **Calling the API directly** (Section 9 only): from that persona's own page,
    run:

    ```js
    const r = await fetch('/api/method/gdb_bank.<MODULE>.<METHOD>', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ /* args */ }),
    });
    [r.status, await r.text()]
    ```
    Frappe returns a permission refusal as **403** and a validation refusal as
    **417**. The readable message is inside `_server_messages`.
11. **Console.** At the end of each section, list the browser console errors of
    each persona's page. Any red error that is not a deliberate refusal from a
    negative case is a FAIL for that section (case `X-CONSOLE`).

---

## 1. Preconditions (a human usually does these)

| # | Step | Check |
|---|---|---|
| P1 | Stack is up: `docker compose ps` shows backend, frontend, mariadb, redis, keycloak running. | `POST /api/method/gdb_bank.api.whoami` while signed out returns 403. |
| P2 | Backend runs the current code (restart after any Python change: `docker compose restart backend`). | — |
| P3 | Dev server running: `npm run dev` in `frontend/`. | `PORTAL/login` shows **e-ID number** and **GDB staff** tabs. |

### 1.1 Accounts (fixtures)

| Persona | Signs in on | Login | Password | Notes |
|---|---|---|---|---|
| `CITIZEN` | **e-ID number** tab | e-ID `592-1111-0001` | `<CITIZEN_PASSWORD>` — ask the human | Name shows as "hemanth Chittiprolu" |
| `OFFICER` | **GDB staff** tab | `fieldofficer@gdb.gy` | `E2e-Test-2026!` | Field Officer, region **Region 1 — Barima-Waini** |
| `UNDERWRITER` | **GDB staff** tab | `underwriter@gdb.gy` | `E2e-Test-2026!` | Loan Underwriter (+ Disbursement Officer) |

Officers only see requests and tasks from **their own region**. Always choose
**Region 1 — Barima-Waini** below unless a case says otherwise.

### 1.2 Test files

Create these two files once, somewhere the browser can upload from (e.g. a temp
folder). Run in a terminal:

```bash
python -c "import base64;open('stall-front.jpg','wb').write(base64.b64decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAAIAAgBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k='))"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%%%EOF\n' > stall-photo.pdf
```

`JPG` = full path of `stall-front.jpg`; `PDF` = full path of `stall-photo.pdf`.

### 1.3 Sign in all three

- `CITIZEN`: open `PORTAL/login` → **e-ID number** tab → type the e-ID in the three
  boxes (`592`, `1111`, `0001`) and the password → **Sign in with e-ID**.
  Expected: the citizen **Dashboard**.
- `OFFICER`: `PORTAL/login` → **GDB staff** tab → email + password →
  **Sign in as GDB staff**. Expected: page title **Work queue**; sidebar shows
  **Work queue** and **New application**; a "Field Officer" badge at top right.
- `UNDERWRITER`: same as officer. Expected: **Review queue**.

📸 `P-SIGNIN-citizen`, `P-SIGNIN-officer`, `P-SIGNIN-underwriter`.

---

## 2. Citizen asks for help (persona: CITIZEN, then OFFICER)

**FO-REQ-01 — the citizen sends a help request**
1. CITIZEN: open `PORTAL/apply/quick`.
2. Select **I need help from a field officer** → click **Continue to request help**.
3. If you see "Sending replaces your request …", that is fine (an older waiting
   request exists) — note its number as `OLD_REQ`.
4. Type of business: **Small service**. Region: **Region 1 — Barima-Waini**.
   Best time: **Morning**. Click **Send request**.
5. 📸 Expected:
   - "Request sent"
   - "A GDB field officer for Region 1 will call you"
   - A reference like "GDB-FO-2026-000NN" → save it as `REQ`.
   - Under "What happens next", step 3 contains "the officer submits it to GDB"

**FO-REQ-02 — a waiting request can be replaced** (only if `OLD_REQ` existed in
FO-REQ-01; otherwise run it now)
1. CITIZEN: click **Back to start**, select **I need help from a field officer**
   again → **Continue to request help**.
2. 📸 Expected: the **form** is shown (NOT the "Request sent" page) with the line
   "Sending replaces your request `REQ` (Region 1)".
3. Region: **Region 1 — Barima-Waini**, Type: **Market vendor** → **Send request**.
4. 📸 Expected: "Request sent" with a **new** number. Save it as `REQ` (replace
   the old value). The old number must not appear as the current request.

**FO-REQ-03 — the officer sees it in the work queue**
1. OFFICER: open `PORTAL/field`.
2. 📸 Expected:
   - Three cards: "ASSIST REQUESTS", "ASSISTED APPLICATIONS", "FIELD TASKS", each
     with a number and "to do".
   - Filter buttons "To do", "Waiting", "Done".
   - A row with `REQ`, status "Waiting", and a button **Review & accept**.
   - The replaced request (if any) is NOT in "To do".

---

## 3. The officer works the request (persona: OFFICER, then CITIZEN)

**FO-AR-01 — accept**
1. OFFICER: click **Review & accept** on the `REQ` row.
2. 📸 (before accepting) Expected: "PHONE" shows "Hidden until accepted";
   header shows "In regional pool"; service shows "Quick Loan" (not "Quick").
3. Click **Accept request**.
4. 📸 Expected: status "Accepted"; "Assigned to you"; the phone number is now
   visible; a card "Log a call"; header buttons **Resolve request…** and
   **Start application**.

**FO-AR-02 — log a call**
1. Click **No answer**, type a note "Rang twice", click **Log call**.
2. 📸 Expected: "HISTORY · 1" and "1. No answer" with the note; the result
   buttons are cleared.

**FO-AR-03 — book a visit (request stays open)**
1. Click **Resolve request…** → in the dialog click **Visit booked**.
2. Set Date `2026-10-05`, Time `14:30` (use the snippet in rule 8 with
   `dialog input[type=date]` / `dialog input[type=time]`), Where
   "Market stall 4". Leave "e-ID card" ticked, tick "Receipts or records".
3. Click **Book visit**.
4. 📸 Expected: status "Visit booked"; a "Visit" card containing
   "When:" followed by the date in words (it contains "5 Oct 2026" and a time
   like "2:30"; FAIL if it shows `2026-10-05`), "Where: Market stall 4",
   "Bring: e-ID card, Receipts or records".

**FO-AR-04 — start the application → consent is asked**
1. Click **Start application** (header).
2. 📸 Expected: page title "Assisted application"; a step bar with 4 steps
   "Find applicant", "Consent", "Application", "Submit and send" with step 1
   ticked and step 2 current; text "Waiting for hemanth to allow access in their
   portal."; the name is masked like "hemanth C.". Save the URL's last part
   (`GDB-AC-2026-000NN`) as `CONSENT`.
3. Open `PORTAL/field/requests/<REQ>` → 📸 Expected: status "Application started".

**FO-AR-05 — the citizen allows access**
1. CITIZEN: open `PORTAL/` (Dashboard).
2. 📸 Expected: a card "fieldofficer asks to help with your application" with
   **Allow** and **Decline**.
3. Click **Allow**.
4. OFFICER: stay on (or open) `PORTAL/field/assist/<CONSENT>` and wait up to 15 s
   (it refreshes by itself).
5. 📸 Expected: full name "hemanth Chittiprolu"; "In progress";
   "Access until <date 7 days ahead>"; step 2 ticked, step 3 current; tabs
   "Overview", "Application", "Activity"; buttons **New application** and
   **End access**.

---

## 4. Officer fills a Quick Loan and submits it to GDB (OFFICER, CITIZEN, UNDERWRITER)

**FO-QL-01 — the form opens inside the officer's page with the applicant's data**
1. OFFICER on `PORTAL/field/assist/<CONSENT>`: click the **Application** tab.
2. 📸 Expected: "New application" with two choices "Quick Loan" and "SME Loan".
3. Click **Quick Loan** → 📸 Expected: "Before you start" WITHOUT the question
   "How would you like to apply?"; button **Start application**.
4. Click **Start application** → 📸 Expected on "About you": "Full legal name"
   = "hemanth Chittiprolu" and "e-ID number" = "592-1111-0001" (the CITIZEN's,
   never "fieldofficer"). The page header above still shows the step bar and tabs.

**FO-QL-02 — fill it**
1. About you → **Save and continue**.
2. Business description: Business name "E2E Repairs", Region
   **Region 1 — Barima-Waini**, "What does your business sell or do?"
   "Phone repairs at the market" (rule 8 for the text box), "1 to 3 years",
   "Fixed location" → **Save and continue**.
3. Loan details: amount `120000`, purpose "Spare parts" (rule 8), term 6 months →
   **Save and continue**.
4. 📸 Expected: "Proof of business"; the URL now ends with
   `/apply/quick/ACC-LOAP-2026-000NN` → save as `QL1`.
5. Upload `JPG` into the **Proof of business** file box. 📸 Expected:
   "Trading Photo" "Received" with the file name.
6. **Save and continue** → Bank information: if "Confirm account number" is
   empty, type the same number as "Account number" → **Save and review**.
7. 📸 Expected: "Review your application"; "No outstanding items"; buttons
   **Send to applicant** and **Submit to GDB**.

**FO-QL-03 — submit is blocked until the applicant's three confirmations**
1. Click **Submit to GDB** (the Review footer button).
2. 📸 Expected page: title "Submit for hemanth Chittiprolu"; one warning line
   "Can't be edited after submission."; three checkboxes worded as the
   applicant's: "hemanth Chittiprolu confirms the information is accurate.",
   "…understands that submitting does not guarantee a loan.",
   "…consents to GDB obtaining their credit report from EveryData."
3. Without ticking anything, click **Submit to GDB**.
4. 📸 Expected: still on the same page, with three red messages (one per box).

**FO-QL-04 — submit**
1. Tick all three boxes → click **Submit to GDB**.
2. 📸 Expected: "Submitted to GDB for hemanth Chittiprolu"; "Reference `QL1`";
   "They have been notified".
3. Click **Done** → 📸 Expected on the overview: status "Submitted"; a badge
   "Submitted by Field Officer"; step bar with all four steps ticked and the
   last labelled "Submitted to GDB"; a card showing "Under review" and `QL1`.

**FO-QL-05 — the citizen is told and sees everything the officer entered**
1. CITIZEN: click the notification bell. 📸 Expected: "fieldofficer submitted
   your application `QL1` to GDB".
2. Open `PORTAL/apply` → 📸 Expected: the `QL1` row shows "Under review" and
   "Submitted by Field Officer".
3. Open `PORTAL/loans/<QL1>`; open "Application details" if it is folded.
4. 📸 Expected:
   - badge "Submitted by Field Officer" and "Under review"
   - "Submitted for you by fieldofficer on <today>"
   - Amount "G$120,000", Term "6 months", "Terms accepted <today>", Purpose
     "Spare parts"
   - A "BUSINESS" block with Business name "E2E Repairs", "Phone repairs at the
     market", "Region 1 — Barima-Waini", "1 to 3 years", "Fixed location"
   - NO empty SME sections (no "Executive summary", "Market and customers")

**FO-QL-06 — the underwriter sees the tag**
1. UNDERWRITER: open `PORTAL/review`.
2. 📸 Expected: the `QL1` row shows "Submitted by Field Officer", product
   "Quick Loan", "Under review".
3. Open the row → 📸 Expected: header badges include "Submitted by Field
   Officer"; Case facts show "Assisted by fieldofficer" and "Submitted by
   fieldofficer".

---

## 5. Officer sends a Quick Loan back; the citizen submits it (OFFICER, CITIZEN)

A new consent is needed (the last one ended with the submission).

**FO-QS-01 — new consent via "New application"**
1. OFFICER: sidebar **New application** → 📸 Expected: step bar, step 1 current;
   "Find applicant"; the sidebar item **New application** is highlighted and
   **Work queue** is not.
2. Type e-ID `592` `1111` `0001` → **Look up** → 📸 Expected: "hemanth C." (masked).
3. **Ask for consent** → save the new `CONSENT` from the URL.
4. CITIZEN: Dashboard → **Allow**. OFFICER: wait for "In progress".

**FO-QS-02 — fill and send back**
1. OFFICER: **Application** tab → **Quick Loan** → fill exactly as FO-QL-02 but
   business name "E2E Sendback" and amount `90000` → reach Review.
   Save the number as `QL2`.
2. Click **Send to applicant** (accept the confirm).
3. 📸 Expected: "Sent to hemanth Chittiprolu"; "Not submitted to GDB yet".
4. **Done** → 📸 Expected: "Waiting for applicant"; card "With applicant";
   step 4 labelled "Sent to applicant" and NOT ticked.

**FO-QS-03 — the citizen finishes it**
1. CITIZEN: `PORTAL/apply` → 📸 Expected: `QL2` "Ready to submit",
   "Prepared with fieldofficer".
2. Open `PORTAL/loans/<QL2>` → 📸 Expected: "Not yet submitted",
   "Check it, accept the terms and submit.", button **Check and submit**.
   There must be NO red "Accept the terms to submit." message.
3. Click **Check and submit** → 📸 Expected: the Quick Loan form opens on
   "Review your application" (not on an earlier step).
4. **Continue to submit** → tick the three "I confirm / I understand / I consent"
   boxes → **Submit application**.
5. 📸 Expected: "Your application has been submitted". Open
   `PORTAL/loans/<QL2>` → "Under review", and NO "Submitted by Field Officer"
   badge (the citizen submitted it).

---

## 6. Officer submits an SME loan (optional — long form)

**FO-SME-01** — With a live consent (repeat FO-QS-01 if needed): **Application**
tab → **SME Loan** → complete all 8 steps of the form. On "Review your
application" 📸 Expected: buttons **Send to applicant** and **Submit to GDB**.
Click **Submit to GDB** (accept the confirm). 📸 Expected: "Submitted to GDB
for hemanth Chittiprolu". Then verify the tag exactly as FO-QL-05 (citizen) and
FO-QL-06 (underwriter); on the citizen case the SME sections ARE shown.

---

## 7. Underwriter asks for field work (UNDERWRITER, OFFICER)

Use any case the underwriter can review that belongs to the CITIZEN, e.g. `QL1`
(call it `CASE`).

**FO-FT-01 — request a site visit and a reference check**
1. UNDERWRITER: open `PORTAL/loans/<CASE>` → **Request field work**.
2. 📸 Expected: the dialog has fields Task, What to check, Due, **Region**
   ("Applicant's region" by default), Address.
3. Task **Site Visit**, What to check "Confirm the stall", Due tomorrow (rule 8,
   `dialog input[type=date]`), Region **Region 1 — Barima-Waini**,
   Address "Stall 4" → **Send request**.
4. Again: Task **Reference Check**, "Call two references", Region 1 → **Send request**.
5. 📸 Expected: "Field verification" "0 of 2 reported"; both tasks "Open".

**FO-FT-02 — the officer sees both, masked**
1. OFFICER: `PORTAL/field` → click the **FIELD TASKS** card.
2. 📸 Expected: two rows with the applicant name masked ("hemanth C."), "Site
   Visit" and "Reference Check", status "Open", button **Accept task**.

**FO-FT-03 — site visit: guard, no data loss, no fake location**
1. Open the Site Visit → 📸 Expected: no address or full name yet → **Accept task**.
2. 📸 Expected: full name and address now visible; "0 of 5 checks completed";
   a badge "No location yet" — it must NOT say "Location captured" and must NOT
   show "0, 0".
3. Check 1 **Yes**; check 4 **No** → 📸 Expected: a box
   "Note — required for "No"" appears under check 4. Leave it empty.
4. Click **Review report** → 📸 Expected: a card "N missing" listing at least
   "Check 2 not answered", "Check 4 needs a note for "No"", "At least one photo",
   "Captured location", "Summary of what you saw"; **Submit field report** is
   disabled.
5. **Back to edit**. Answer checks 2, 3, 5; type the check-4 note "Table beside
   the stall"; type a Summary (rule 8, `main textarea`).
6. **Data-loss check:** upload `JPG` via **Take photo**. 📸 Expected after the
   photo appears: still "5 of 5 checks completed", the check-4 note still there,
   the Summary still there.
7. Location: set the emulated geolocation to `8.2008,-59.78` and click
   **Capture my location**. If you get "Location was not shared." the browser
   blocked permission — run this, then click again:
   `navigator.geolocation.getCurrentPosition = ok => ok({coords:{latitude:8.2008,longitude:-59.78,accuracy:7},timestamp:Date.now()})`
   📸 Expected: "Location captured", "8.2008, -59.78 · accurate to 7 m".
8. **Review report** → 📸 Expected: "Ready to submit."; all answers listed,
   check 4 shows "No — Table beside the stall".
9. **Submit field report** → 📸 Expected: "Report submitted"; status "Submitted".

**FO-FT-04 — reference check**
1. Open the Reference Check → **Accept task**.
2. Call 1: Reference "Mark R.", Relationship "Supplier", **Reached**, then
   **Positive**. Call 2: "Helen L.", "Market supervisor", **No answer** →
   📸 Expected: the verification row disappears for Call 2; "1 of 2 references
   verified".
3. **Review report** → **Submit field report** → 📸 "Report submitted".

**FO-FT-05 — the underwriter receives both**
1. UNDERWRITER: reload `PORTAL/loans/<CASE>` → **Checks & documents** tab.
2. 📸 Expected: "2 of 2 reported"; the Site Visit report shows check 4 "No" WITH
   the note "Table beside the stall" under it, a map pin "8.2008, -59.78", and the
   summary; the Reference Check shows "Mark R. · Supplier — Reached — Positive"
   and "Helen L. — No answer".

---

## 8. Underwriter asks the applicant for a document; officer uploads it (UNDERWRITER, OFFICER, CITIZEN)

**FO-IR-01**
1. UNDERWRITER on `PORTAL/loans/<CASE>`: **Request info** → What you need
   "Recent photo of the stall" → **Send request**.
2. OFFICER: get a live consent for the citizen (as FO-QS-01) and open its
   Overview. 📸 Expected: card "Information requests" with "1 open" and the item,
   button **Upload**.
3. Click **Upload** → 📸 Expected: the dialog says which formats are accepted
   (e.g. "PDF") — not a fixed "PDF, JPG, PNG".
4. Choose `JPG` → 📸 Expected: "Use PDF." and **Save** disabled. (No request is
   sent; nothing is created.)
5. **Change** → choose `PDF` → 📸 Expected: size shown in KB (not "0.0 MB");
   tick the three checks → **Save**.
6. 📸 Expected: the item now reads "stall-photo.pdf · applicant to send".
7. CITIZEN: `PORTAL/loans/<CASE>` → 📸 Expected under "Information requested by
   GDB": "stall-photo.pdf · added by fieldofficer" and a **Send** button.
   Click **Send** → 📸 Expected: "Satisfied".

---

## 9. Security — the officer can never reach another citizen's records

Run these as **OFFICER** using rule 10. Use `LIVE` = a consent that is currently
"In progress", `ENDED` = an older consent that ended, and `OTHER_APP` = an
application number of a **different** citizen (from the underwriter's Review
queue, a row whose e-ID is NOT `592-1111-0001`).

| Case | Call | Args | Expected |
|---|---|---|---|
| SEC-01 | `profiles.my_profile` | `{acting: LIVE}` | 200, `full_name` "hemanth Chittiprolu" |
| SEC-02 | `profiles.my_profile` | `{acting: ENDED}` | 403, "The applicant has not allowed access." |
| SEC-03 | `profiles.my_profile` | `{acting: "GDB-AC-2026-99999"}` | 403, "not found" |
| SEC-04 | `api.loan_detail` | `{name: OTHER_APP, acting: LIVE}` | 403, "You may only view your own applications." |
| SEC-05 | `documents.list_documents` | `{application: OTHER_APP, acting: LIVE}` | 403 |
| SEC-06 | `api.loan_detail` | `{name: OTHER_APP}` | 403 |
| SEC-07 | `field_officer.submit_assisted_application` | a Quick Loan draft under `LIVE`, `{consent: LIVE, name: <draft>}` with NO `accept_terms` | 417, "Accept the terms to submit." — then `field_officer.assist_consent {name: LIVE}` must still return `status` "Granted" |
| SEC-08 | browser storage | `[Object.keys(localStorage), Object.keys(sessionStorage)]` on the officer page | `[[], []]` |

---

## 10. Look and copy

**FO-UI-01** — On every officer screen you visited: no explanatory paragraphs;
labels are short. 📸 the Work queue, an assist request, the applicant page and
a field task. FAIL if you see a greeting like "Good morning", a "Who does what"
card, or a "What you are asking to see, and why" list.

**FO-UI-02** — The step bar is a horizontal line of numbered circles (ticks for
done steps), not a row of coloured pills.

---

## 11. Report format

Return one table, then a short list of failures with what you saw.

| Case | Verdict (PASS / FAIL / BLOCKED) | Screenshot | What I saw (quote the screen) |
|---|---|---|---|
| FO-REQ-01 | | FO-REQ-01.png | |
| … | | | |

- **BLOCKED** = a precondition failed (say which) so the case could not run.
- Never mark PASS without a screenshot that shows every Expected item.
