import { useEffect, useState } from "react";
import { RecordAccountOffer } from "./RecordAccount";
import { call } from "../../api";
import type { BankAccountRecord } from "../../types";
import { ChoiceCard, Notice, SelectField, TextField } from "./fields";

/** Where GDB pays the applicant — the same flow the SME form's Section J runs:
 *  ask the payment switch which accounts this e-ID holds, let the applicant pick
 *  one, fall back to typing it, and check a typed account with the bank. None of
 *  the outcomes stops an application; the server records the check on the
 *  account when it is saved (gdb_bank.api.save_bank_details), and release is
 *  where an unverified account is refused.
 *
 *  Controlled: the parent holds bank / account / branch and saves them.
 *
 *  A typed account's branch is picked from the bank's own list
 *  (gdb_bank.api.bank_branches); its routing number is what the server keeps
 *  as the branch code. A picked account comes with the switch's branch code. */
export interface PayoutValue {
  bank: string;
  accountNo: string;
  branchCode: string;
  /** A GDB Bank Branch of `bank`, for a typed account. */
  branch: string;
  /** Asked only of a typed account — a picked one comes with its holder. */
  holder: string;
  confirmNo: string;
  manual: boolean;
}

/** Whether this person already has a bank account on file — one the payment
 *  switch holds in their name, or one nominated with GDB before. null while
 *  asking. With one on file, "I don't have a bank account" is not offered
 *  (GDB, 2026-10-05). */
export function useAccountOnFile(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      call<BankAccountRecord[]>("gdb_bank.api.my_bank_accounts").catch(
        () => [],
      ),
      call<{ bank_account_no?: string } | null>(
        "gdb_bank.api.my_bank_details",
      ).catch(() => null),
      // The account the cash grant register pays this person into.
      call<{ account_number?: string } | null>(
        "gdb_bank.api.my_kyc_bank_account",
      ).catch(() => null),
    ]).then(([found, saved, register]) => {
      if (live)
        setHas(
          (found?.length ?? 0) > 0 ||
            !!saved?.bank_account_no ||
            !!register?.account_number,
        );
    });
    return () => {
      live = false;
    };
  }, []);
  return has;
}

/** An account on file: the switch's, or the one already nominated with GDB. */
type OnFile = BankAccountRecord & { gdb_branch?: string };

export function PayoutAccount({
  value,
  onChange,
  onAccountType,
  onAccountOnFile,
}: {
  value: PayoutValue;
  onChange: (next: PayoutValue) => void;
  /** Checking / Savings, when the account on record says which. */
  onAccountType?: (type: string) => void;
  /** Whether the person already has an account on file (GDB, 2026-10-05):
   *  the parent then drops "I don't have a bank account". */
  onAccountOnFile?: (has: boolean) => void;
}) {
  const [banks, setBanks] = useState<string[]>([]);
  const [mine, setMine] = useState<OnFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(false);
  // The cash grant register's account, once "Use this account" is chosen: its
  // fields fill themselves and are read-only (GDB, 2026-10-05).
  const [fromRecord, setFromRecord] = useState<string | null>(null);
  // The branch the register named, when the portal matched it — fixed too.
  const [recordBranch, setRecordBranch] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [check, setCheck] = useState<BankAccountRecord | null>(null);
  const [checking, setChecking] = useState(false);
  const [branches, setBranches] = useState<
    { name: string; branch_name: string; routing_number: string | null }[]
  >([]);

  // The chosen bank's branches. A branch only ever belongs to one bank, so a
  // change of bank clears it.
  useEffect(() => {
    if (!value.bank) {
      setBranches([]);
      return;
    }
    call<
      { name: string; branch_name: string; routing_number: string | null }[]
    >("gdb_bank.api.bank_branches", {
      bank: value.bank,
    })
      .then((rows) => {
        setBranches(rows ?? []);
        // A bank with one branch ("Any") has nothing to choose.
        if (rows?.length === 1 && value.branch !== rows[0].name)
          onChange({ ...value, branch: rows[0].name });
      })
      .catch(() => setBranches([]));
  }, [value.bank]);

  const pick = (a: OnFile) => {
    onChange({
      ...value,
      bank: a.bank,
      accountNo: a.account_number,
      branchCode: a.branch_code ?? "",
      branch: a.gdb_branch ?? value.branch,
      holder: a.account_name ?? value.holder,
      confirmNo: a.account_number,
      manual: false,
    });
    if (a.account_type) onAccountType?.(a.account_type);
    setCheck(null);
    setNote(null);
  };

  // The parent validates holder and confirmation only for a typed account.
  useEffect(() => {
    if (value.manual !== manual) onChange({ ...value, manual });
  }, [manual]);

  useEffect(() => {
    call<string[]>("gdb_bank.api.bank_options")
      .then(setBanks)
      .catch(() => setBanks([]));
    (async () => {
      try {
        // The accounts on file: what the payment switch holds in this
        // person's name, and the one they already nominated with GDB.
        const [found, saved] = await Promise.all([
          call<BankAccountRecord[]>("gdb_bank.api.my_bank_accounts"),
          call<{
            bank: string;
            bank_account_no: string;
            branch_code: string;
            account_name?: string | null;
            account_type?: string | null;
            gdb_bank_branch?: string | null;
          } | null>("gdb_bank.api.my_bank_details").catch(() => null),
        ]);
        const onFile: OnFile[] = [...(found ?? [])];
        if (
          saved?.bank_account_no &&
          !onFile.some((a) => a.account_number === saved.bank_account_no)
        ) {
          onFile.push({
            bank: saved.bank,
            account_number: saved.bank_account_no,
            account_name: saved.account_name ?? null,
            account_type: saved.account_type ?? undefined,
            branch_code: saved.branch_code,
            gdb_branch: saved.gdb_bank_branch ?? undefined,
            status: "Active",
            source: "bank_registry",
          });
        }
        setMine(onFile);
        onAccountOnFile?.(onFile.length > 0);
        // An account on file is offered as a choice, never as a form to fill:
        // the form is for "Use a different bank account" only.
        if (onFile.length === 1 && !value.accountNo) pick(onFile[0]);
        if (!onFile.length) setManual(true);
      } catch {
        setMine([]);
        setManual(true);
        setNote("Bank unreachable. Enter your account below.");
      } finally {
        setLoading(false);
      }
    })();
    // Loaded once per mount; `value` seeds the choice but is not a dependency.
  }, []);

  const checkTyped = async () => {
    if (!value.bank || !value.accountNo) return;
    setChecking(true);
    try {
      setCheck(
        await call<BankAccountRecord>("gdb_bank.api.verify_bank_account", {
          bank: value.bank,
          bank_account_no: value.accountNo,
        }),
      );
    } catch {
      setCheck(null);
    } finally {
      setChecking(false);
    }
  };

  if (loading)
    return <p className="text-sm text-slate-500">Finding your accounts…</p>;

  if (!manual && (mine?.length ?? 0) > 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">
          {mine?.length === 1 ? "Your bank account" : "Choose an account"}
        </p>
        {mine?.map((a) => {
          const payable = a.status === "Active";
          return (
            <ChoiceCard
              key={`${a.bank}-${a.account_number}`}
              title={a.bank}
              body={`••••${a.account_number.slice(-4)}${a.account_type ? ` · ${a.account_type}` : ""} · ${a.account_name ?? ""}`}
              note={
                payable ? undefined : `${a.status} — cannot receive payments`
              }
              disabled={!payable}
              selected={value.accountNo === a.account_number}
              onSelect={() => pick(a)}
            />
          );
        })}
        {mine?.[0]?.source !== "bank_registry" && (
          <p className="text-xs text-slate-500">Test data</p>
        )}
        <button
          type="button"
          onClick={() => {
            setManual(true);
            setNote(null);
          }}
          className="text-xs font-semibold text-brand underline"
        >
          Use a different bank account
        </button>
      </div>
    );
  }

  const locked =
    !!fromRecord &&
    value.accountNo.replace(/\D/g, "") === fromRecord.replace(/\D/g, "");

  return (
    <div className="space-y-4">
      <RecordAccountOffer
        currentAccountNo={value.accountNo}
        onUse={(a) => {
          setManual(true);
          setCheck(null);
          setNote(null);
          setFromRecord(a.account_number);
          setRecordBranch(a.branch ?? "");
          onChange({
            ...value,
            bank: a.bank ?? "",
            branch: a.branch ?? "",
            branchCode: a.routing_number ?? "",
            accountNo: a.account_number,
            confirmNo: a.account_number,
            holder: a.holder,
            manual: true,
          });
          if (a.account_type) onAccountType?.(a.account_type);
        }}
      />
      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-900">
          <span>
            From the cash grant register. These details cannot be changed here.
          </span>
          <button
            type="button"
            onClick={() => {
              setFromRecord(null);
              onChange({
                ...value,
                bank: "",
                branch: "",
                branchCode: "",
                accountNo: "",
                confirmNo: "",
                holder: "",
                manual: true,
              });
            }}
            className="text-xs font-semibold text-brand underline"
          >
            Use a different bank account
          </button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Bank"
          required
          disabled={locked}
          value={value.bank}
          onChange={(bank) => {
            onChange({ ...value, bank, branch: "" });
            setCheck(null);
          }}
          options={banks}
          placeholder="Choose a bank"
          hint="Banks that can receive Ministry of Finance payments."
        />
        <SelectField
          label="Branch"
          required
          value={value.branch}
          onChange={(branch) => onChange({ ...value, branch })}
          options={branches.map((b): [string, string] => [
            b.name,
            b.branch_name,
          ])}
          placeholder={value.bank ? "Choose a branch" : "Choose the bank first"}
          // A branch the register named and the portal matched is fixed; one
          // it could not match is left to choose.
          disabled={!value.bank || (locked && !!recordBranch)}
          hint={(() => {
            const b = branches.find((x) => x.name === value.branch);
            return b?.routing_number
              ? `Routing number ${b.routing_number}`
              : undefined;
          })()}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div onBlur={() => void checkTyped()}>
          <TextField
            label="Account number"
            required
            disabled={locked}
            inputMode="numeric"
            value={value.accountNo}
            onChange={(accountNo) => {
              onChange({ ...value, accountNo });
              setCheck(null);
            }}
            placeholder="Enter the account number"
          />
        </div>
        <TextField
          label="Confirm account number"
          required
          disabled={locked}
          inputMode="numeric"
          value={value.confirmNo}
          onChange={(confirmNo) => onChange({ ...value, confirmNo })}
          placeholder="Enter it again"
        />
      </div>
      <TextField
        label="Account holder name"
        required
        disabled={locked}
        value={value.holder}
        onChange={(holder) => onChange({ ...value, holder })}
        hint="As it appears on your bank records."
      />
      {checking && <p className="text-xs text-slate-500">Checking…</p>}
      {check && !checking && check.result !== "Not Found" && (
        <Notice tone={check.result === "Verified" ? "good" : "warn"}>
          {check.result === "Verified" && `Verified — ${check.account_name}`}
          {check.result === "Name Mismatch" &&
            "Name differs from your bank record"}
          {check.result === "Inactive Account" &&
            `Account ${check.status?.toLowerCase()} — use another`}
          {check.result === "Unavailable" && "Could not check with your bank"}
        </Notice>
      )}
      {note && <Notice tone="warn">{note}</Notice>}
      {(mine?.length ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => {
            setManual(false);
            setCheck(null);
            setNote(null);
          }}
          className="text-xs font-semibold text-brand underline"
        >
          Use my account on file
        </button>
      )}
    </div>
  );
}
