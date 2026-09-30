# Chrome DevTools MCP — form-fill playbook

Fill the GDB citizen portal (`/apply/new`, `/cluster`) fast and reliably.
Learned from live runs against `http://34.93.232.46:3000`.

## 1. Golden rules

1. **Always `take_snapshot` first.** Use the returned `uid`s — never guess them.
2. **`fill` / `fill_form` do NOT stick on React controlled fields.** They set the
   DOM value but React state never updates, so the wizard shows the text and
   then wipes it on Continue with “required” errors.
   Use `evaluate_script` with the native setter + `input`/`change` events ( §3 ).
   Exception: e-ID 3-box login and simple `<select>` sometimes work with `fill`,
   but if Continue wipes it, redo it via §3.
3. **One persona per browser context.** `localhost` shares cookies across ports.
   For two users at once (head + member), open the second with:
   `new_page(url, isolatedContext="member-asha")`. Otherwise log out before switching.
4. **Verify via API, not just pixels.** After each step, POST via `evaluate_script`
   to `my_clusters`, `my_invitations`, `whoami` — it catches state bugs the UI hides.

## 2. Login (e-ID, 3 boxes)

URL: `/login` → redirects from `/apply/new` when logged out.

- Snapshot → `textbox "e-ID digits, group 1 of 3"` etc + `textbox "Password"` + `button "Sign in with e-ID"`.
- `fill_form` works here:
  `592 | 1111 | 0001` + `ChangeMe@123` (head Hemanth), or
  `592 | 3333 | 0003` + `ChangeMe@123` (member Asha Persaud).
- Click Sign in → snapshot should show `/apply/new` or `/`.

Staff tab (`GDB staff`) uses work email + same password, realm `gdb-staff`.

## 3. The setter that actually works

Paste into `evaluate_script`. Works for `input[type=text|number]` and `textarea`:

```js
async () => {
  const setVal = (el, v) => {
    el.focus();
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, '');
    el.dispatchEvent(new Event('input', {bubbles: true}));
    setter?.call(el, v);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  };
  // example: fill by fuzzy label
  const all = [...document.querySelectorAll('input'), ...document.querySelectorAll('textarea')];
  const find = (n) => all.find(e =>
    ((e.getAttribute('aria-label')||'')+' '+(e.labels?.[0]?.innerText||'')+' '+(e.placeholder||'')).toLowerCase().includes(n));
  setVal(find('executive summary'), 'Your text…');
  return 'done';
}
```

Selects (`Sector`, `Bank`, `Operating region`) are native `<select>`:

```js
async () => {
  const sel = [...document.querySelectorAll('select')]
    .find(s => s.innerHTML.includes('Republic Bank'));
  sel.value = 'Republic Bank (Guyana)';
  sel.dispatchEvent(new Event('change', {bubbles: true}));
  return sel.value;
}
```

If a step wipes values on Continue (“Write the executive summary…”, “Describe what
the business sells…”), it means §3 was skipped — redo with the setter, then Continue.

## 4. `/apply/new` cluster path — copy-paste values that pass

Logged in as `592-6666-0006` (Rani Singh) in the last run; head flow is the same.
Steps are 11 for a cluster (`group, members, plan` extra), 8 for solo.

**Step 6 — The shared plan (7 textareas, first + fifth required):**
- Executive summary: `E2E Cluster brings together 3 agro-processors from Region 4 to build a shared cold store at Stabroek Market, cutting spoilage and letting members sell together to Georgetown buyers.`
- How formed / Governance / Market / Operations / Impact: any ≥1 sentence (see §3).
- Shared project (required): `Build a 20x30 ft shared cold store and buy a cassava grater and press for collective use at Lot 12 Market Street, Georgetown.`
- Click Continue → must land on Step 7. If it stays on 6 with an alert, the setter missed a required box.

**Step 7 — Your business:**
- Proposed business name: `E2E Cold Store Services`
- Sector: `Agro-processing` (select; if `fill` fails use §3 select snippet)
- Sub-sector: `Cold storage and cassava processing`
- Products or services (required): `Shared cold storage and cassava flour processing for cluster members and nearby farmers.`
- Employment / Customer segments / Target market / Competitors: 1 line each.

**Step 8 — Operations (all optional, fill anyway):**
- Operating region select: `Region 4 — Demerara-Mahaica`
- Production: `Cassava received daily, washed, grated and pressed, then dried and packed for wholesale dispatch twice a week.`
- Equipment: `Have 1 grater and drying racks; loan adds cold store shelving, second press and delivery crates.`
- Suppliers / Permits: 1 line each.

**Step 9 — Financial information (new venture, all optional):**
- Expected sales volume, projected revenue `4800000`, costs `3200000`, start-up `850000`, cash `130000`, assumptions: 1 line.

**Step 10 — Funding request (required):**
- Amount `750000`, Term `24`, Purpose 1–2 sentences, Bank `Republic Bank (Guyana)`,
  Account `0123456789`, Branch `001`, Monthly income `95000`, Phone `623 4567`.
- Use-of-funds row 1: item `Cold store materials` + amount spinbutton (second
  `input[type=number]` on the page — set via setter, e.g. `450000`).
- Button reads **Save and continue** (not Continue). Click → Step 11 Documents and submit.

## 5. Cluster invite → accept (two contexts)

Head (page 1, `/cluster`, tab = your group):
1. Snapshot → invite form (`Member e-ID` 3 boxes + name + `Send invitation` disabled).
2. `fill_form`: `592 | 3333 | 0003` + `Asha Persaud` → button enables → click.
3. Expect: `Invitation sent to 592-3333-0003…` + roster row `INVITED` + `Withdraw`.

Member (page 2, `isolatedContext="member-asha"`, `/cluster`):
1. Banner `You have been invited to a cluster — <name> … invited by Hemanth` + Accept/Decline.
2. Click Accept → banner disappears, new tab `<name>` appears.
3. Head reloads → row flips `INVITED` → `ACTIVE`, `joined_count` 0→1.

API check (either page, `evaluate_script`):
```js
async () => {
  const post = async (m,b) => (await fetch('/api/method/gdb_bank.api.'+m,
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})})).json();
  return {who: await post('whoami'), clusters: await post('my_clusters'), invites: await post('my_invitations')};
}
```

Fresh group for tests (the `/cluster` page only shows StartCluster when you have
zero groups, so create via API):
```js
async () => (await fetch('/api/method/gdb_bank.api.create_cluster',
  {method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({cluster_name:'E2E Cluster '+Date.now(),region:'Region 4 — Demerara-Mahaica',sector:'Agro-processing'})})).json()
```

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Continue stays on same step + red alert | React state empty — redo with §3 setter, don't use `fill`. |
| `fill` on Sector/Operating region “not interactive” | It's a native select — use §3 select snippet. |
| Logged in as wrong user (`Rani Singh`?) | Previous session in same context — log out or use fresh `isolatedContext`. |
| No StartCluster form on `/cluster` | By design — shown only when `clusters.length===0`. Create via API above or via Apply wizard “Start a new group”. |
| e-ID login “refused” for `592-2222-0002` | By design — staff-mailbox e-IDs are refused on citizen door; use staff tab. |
| `my_clusters` shows `joined_count:0, invited_count:1` but UI says “2 members” | UI counts rows; backend split counts Active-only. Trust `joined_count` for offer roster. |

Related: `docs/e2e-cluster-flow-prompt.md` (full PASS/FAIL protocol),
`docs/testing.md` (credentials, smoke test, guards), `backend/…/tests/test_cluster_flow.py`.
