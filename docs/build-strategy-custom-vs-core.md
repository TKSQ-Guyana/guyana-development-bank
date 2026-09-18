# Custom app or core modification? — the evaluation

Question: can GDB be built by writing custom code in the `gdb_bank` app, or must
we modify frappe / erpnext / lending core?

**Verdict: custom code. Zero core edits are required for any of the 210
requirements.** One requirement pair (R-145/R-147) forces an architectural
choice rather than a core edit — detail below.

Evidence base: the full 36-method API surface exercised end to end, the pinned
source read in the container, and a live mutation test rolled back. See
`docs/test-coverage-vs-requirements.md`.

## Why the verdict is safe: six mechanisms, each proven — not assumed

| # | Mechanism | Proof |
|---|---|---|
| 1 | **Custom Fields on core doctypes** | `install.py` already plants them on `Loan Application`, `User` and erpnext doctypes via `create_custom_fields` — in production, today |
| 2 | **Property Setters** (reshape core fields) | I extended `Loan Application.status` from 3 to **5 options live**, then rolled back. `install.py` already calls `make_property_setter` |
| 3 | **Permissions on core doctypes** | `install.py` uses `add_permission` / `update_permission_property` / `Custom DocPerm` to grant `Citizen` read on lending's `Loan` |
| 4 | **Row-level scoping** | `permission_query_conditions` + `has_permission` wired for `Loan` in `hooks.py`; proven by 9/9 negative tests returning 403 |
| 5 | **Cross-app `doc_events` / class overrides** | **Lending itself does this to erpnext** in this very deployment — hooking `Company`, `Sales Invoice`, `Journal Entry`, `Custom Field` without editing erpnext. The same pattern points gdb_bank at lending |
| 6 | **Scheduler control** | All 10 lending background jobs are rows in `Scheduled Job Type` with a `stopped` flag — behaviour we don't want is switched off as data |

Point 5 is the important one. The precedent for "one app reshapes another app's
behaviour without touching its source" is already running in this stack.

## The 30 tested failures, mapped to what fixes them

Not one needs a core edit:

| Failure group | Examples | Fix | Core edit? |
|---|---|---|---|
| **Our own code is wrong** | R-037 leaks `underwriter_remarks`; R-066 leaks `monthly_income`; R-111 rationale optional; R-024/R-112 no ceiling; R-021 no draft | Edit `gdb_bank` — a field whitelist, a validation, a status | No |
| **Missing domain model** | Evidence (R-027–R-031), checks register (R-088), assessment (R-092–R-097), decision event (R-115), person/GUIN (R-009, R-203), consent (R-012), configuration (R-151) | New doctypes in `gdb_bank` | No |
| **Missing roles / states** | 9 personas vs 2 (R-155, R-181); four outcomes (R-110); queue states (R-102) | Roles + Custom DocPerm + Property Setter + Workflow | No — config |
| **Missing rules** | Four-eyes (R-131); no auto-decision (R-114); file type/size (R-030) | Validation in `gdb_bank`, `doc_events` on `File` | No |
| **Region/sector scoping** | R-053, R-171, R-212 | User Permissions + the query hooks already in use | No |
| **Broken permission** | R-050 — underwriter lacks `Loan Lead` access | One `add_permission` line in `install.py` | No |
| **External systems** | Coursera, GRA, NIS, credit bureau, sanctions, My Guyana, bank channels | Adapters in `gdb_bank/integrations/` — two already exist and work | No |
| **Not code at all** | R-175 audit immutability, R-177 encryption, R-153 build gate, R-169/R-211 dual session | DB grants, volume encryption, CI, token auth or a second hostname | No |

## The one genuine fork in the road: R-145 and R-147

These are the only requirements that conflict with lending *by design*, and the
conflict is real, not a misreading:

- R-145 — "Store no balance, no overdue flag and no ageing bucket."
- R-147 — "Compute days past due at query time."

Tested fact: lending stores `total_amount_paid`, `total_principal_paid`,
`total_payment` and `days_past_due` on `Loan`, and a nightly
`create_process_loan_classification` job writes the last one. A Property Setter
can *hide* those fields; it cannot stop them being written. **No amount of
custom code satisfies the literal wording while lending owns the loan.**

Three ways out, none of which is "patch lending":

| Option | What it means | Cost |
|---|---|---|
| **A — Derive and ignore** *(recommended)* | Keep lending. Every displayed figure is folded from the ledger at read time; lending's fields are an internal cache nothing reads. Stop the classification job. | Low. Already half-built — `loan_account.dues` calls lending's `calculate_amounts()` at read time today |
| **B — Own the ledger** | Build a gdb append-only ledger; use lending only for schedule generation, or not at all. | High. Forfeits demands, allocation, restructuring, GL posting — all of which work today |
| **C — Fork lending** | Pin a GDB fork in `backend/Dockerfile`. | Avoid. Permanent upgrade tax for a wording problem |

This needs a client answer, not an engineering decision: does R-145 mean
*"nothing is persisted anywhere"* or *"no figure we show comes from a stored
balance"*? Option A satisfies the second reading completely. Ask before C8.

## What *would* have forced a core edit — and doesn't apply

So the verdict is credible, here is what genuinely requires forking, none of
which GDB needs:

- Changing lending's interest or EMI **math**. Not needed — 0% is a first-class path (`get_monthly_repayment_amount` has an explicit zero-rate branch, and live loans carry `interest_amount 0.0`).
- Changing how GL entries are **posted**. Not needed — accounting is enabled and posting correctly (2 entries per disbursement).
- **Removing** a core field or table. Not needed — see the R-145 options.
- Changing frappe's permission engine so `Administrator` stops bypassing checks. Pointless — anyone with bench access reaches the DB anyway, which is why R-175 is an infra control.

## Recommendation

Build entirely in `gdb_bank`. Keep lending pinned at 16.5.0 as it is in
`backend/Dockerfile`, and keep every customization as **data or hooks** so
`bench migrate` re-applies it — which `install.py` already does via
`after_migrate`.

If a core change ever does become unavoidable, the escape hatch is cheap
*because* of that pinning: fork the app, point the Dockerfile at the fork. Never
edit files inside the container.

## Where the real risk is

It is not core modification — that question is settled and low-risk. Testing put
the risk somewhere else:

1. **Volume.** 112 of 210 requirements have **no implementation at all** — verified against the complete API surface, not guessed. Coursera (7), assessment (8), evidence management (5), governance reporting (13) are untouched. The build is far larger than the "custom vs core" question implies.
2. **Correctness of what exists.** A single account moved **G$99,000,000** from application to disbursement unaided. Rules, not plumbing, are what's missing.
3. **Upgrade drift.** Heavy reliance on lending's internals (`calculate_amounts`, `get_disbursal_amount`) means a lending upgrade can break us silently. The pin protects us; a test suite would prove it. There is none yet.
