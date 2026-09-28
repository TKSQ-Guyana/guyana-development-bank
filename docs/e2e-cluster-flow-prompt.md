# E2E test: cluster flow (invite → notify → join → personal evidence → offer)

You are testing the Guyana Development Bank citizen portal end to end in a real
browser, using the **Chrome DevTools MCP tools** (`navigate_page`,
`take_snapshot`, `click`, `fill`, `fill_form`, `upload_file`, `wait_for`,
`take_screenshot`, `list_console_messages`, `list_network_requests`,
`get_network_request`, `evaluate_script`). Drive the UI the way a person would.
Your job is to find out whether the flow works, not to make it work.

## Rules

- Do NOT edit code, run `git`, or run any `docker` / `bench` command.
- Do NOT use the ERPNext desk (`:8080/app`). Test the portal only.
- If a precondition fails, stop and report it. Don't try to fix it.
- Only one person is signed in at a time, because `localhost` shares cookies
  across ports. Log out (sidebar → **Log out**) before switching persona.
- After every step, check `list_console_messages` for errors and
  `list_network_requests` for any 4xx/5xx on `/api/` or `/private/files/`.
  Record anything you find.
- Take a screenshot at every step marked 📸. Save them all in one folder and
  report its path.

## Setup

1. Backend must be up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/method/ping` → `200`.
2. Keycloak must be up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8086/realms/gdb-citizen/.well-known/openid-configuration` → `200`.
3. Start the frontend dev server in the background: `npm run dev` in `frontend/`.
   Then open **http://localhost:5173**. Do not use `:3000`; it serves an old
   bundle.
4. Create a small PDF for uploads (any valid PDF under 1 MB), e.g.:
   ```bash
   printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > e2e-personal-financials.pdf
   ```
5. Pick a unique group name: `E2E Group <HHMMSS>`.

## Personas

| Persona | Sign in with | Credentials |
| --- | --- | --- |
| Head | email | `citizen@example.gy` / `admin` |
| Member | e-ID (three boxes) | `592-3333-0003` / `ChangeMe@123` |
| Underwriter | email | `underwriter@gdb.gov.gy` / `admin` |
| Disbursement officer | email | `finance@gdb.gov.gy` / `admin` |

## Steps and expected results

**A. Preflight (as Head)**
1. Sign in. Using `evaluate_script`, POST `/api/method/gdb_bank.documents.document_settings`.
   The returned `types` must include `"Personal Financials"`. If it doesn't, the
   backend is running old code: **stop and report**.

**B. Head applies as a group**
2. Go to **My applications → Start an application**. Choose to apply **through a cluster**.
   Name the group. Answer "No" to the facilitator question.
3. Fill in the group details. On the **members** step, invite e-ID
   `592-3333-0003`. Expect a row with status "Invitation sent". 📸
4. Complete the rest of the wizard with the simplest valid answers. A **new**
   business avoids the DCRA number, and any bank with a numeric account number
   will do. **Submit**. Note the application ID (`ACC-LOAP-…`).
5. **My applications**: under **Clusters**, the application is listed with the
   group name. Under **Mine**, it is not. 📸

**C. Member is notified and joins**
6. Log out. Sign in as the Member with the e-ID. The header bell shows at least
   1 unread. Opening it shows "Hemanth invited you to join <group>". 📸
7. Click the notification. It lands on `/apply?view=clusters` and the badge
   count drops. An invitation card offers **Join the group** / **Decline**. 📸
8. Click **Join the group**. The card disappears, and the group application
   appears under **Clusters**.

**D. Member files personal financials**
9. Open the group application. The documents panel is titled **"Your documents"**.
   Its type dropdown offers exactly **Identity, Proof of Address, Personal Financials**,
   with no Business Financials or Business Plan. 📸
10. Upload the PDF as **Personal Financials**. It appears with status
    **Received**. Opening its link returns the PDF (HTTP 200, `application/pdf`). 📸

**E. Head cannot see the member's document**
11. Log out. Sign in as Head and open the same application. The member's
    Personal Financials is **not** listed. The type dropdown shows
    **"Business Financials"** (not "Financials") among the head's options. 📸

**F. Underwriter sees member evidence, approves, issues the offer**
12. Log out. Sign in as the Underwriter. Open the application from the
    **Review queue**. Go to the **Verification** tab → cluster members → the
    member → **Documents**. Personal Financials is listed, and opening it
    returns 200. 📸
13. Go to the **Offer & conditions** tab. **Approve**, then **issue the Letter of Offer**.
    Expect the offer to show 2 signature lines: head and member.

**G. Disbursement officer sees member evidence**
14. Log out. Sign in as the Disbursement officer and open `/loans/<application ID>`.
    **Verification** → member → **Documents**: Personal Financials is listed, and
    opening it returns 200. 📸

**H. Everyone signs**
15. Log out. Sign in as the Member. The bell shows "Your Letter of Offer is
    ready to sign". Clicking it lands on `/loans/<application ID>`. 📸
16. Type the name exactly as the screen asks, then **Sign the agreement**. The
    member's line shows Signed, and the offer is still waiting on the head.
17. Log out. Sign in as Head. The bell shows the same offer notification. Sign it.
    The offer now reads **Accepted**, with all lines Signed. 📸

**I. Bell housekeeping**
18. With unread notifications present, **Mark all read** clears the badge, and
    it stays cleared after a page reload.

## Report

Reply with:

1. A table with one row per step: `step | expected | actual | PASS/FAIL | evidence`
   (screenshot filename or failing request).
2. For each FAIL: exact repro steps, the failing request (method, URL, status,
   response body excerpt) and any console error.
3. Anything that worked but looked wrong: copy, layout, or how it behaves on a
   360px-wide viewport (use `resize_page` once on step 7 and once on step 9).
4. The application ID, the group name, and the screenshot folder path.
