import { useEffect, useState } from "react";
import { call } from "../../api";
import { FacilitatedBanks } from "../apply/FacilitatedBanks";
import {
  PayoutAccount,
  useAccountOnFile,
  type PayoutValue,
} from "../apply/PayoutAccount";
import { ChoiceCard, Notice } from "../apply/fields";

const EMPTY: PayoutValue = {
  bank: "",
  accountNo: "",
  branchCode: "",
  branch: "",
  holder: "",
  confirmNo: "",
  manual: false,
};

const digits = (v: string) => v.replace(/\D/g, "");

/** My details → Bank account: where GDB pays the citizen, asked as the loan
 *  forms ask it (PayoutAccount) and saved on its own with
 *  gdb_bank.api.save_bank_details — the account every application of theirs
 *  is paid into, and the "Bank account" item of the loan officer's checklist. */
export function BankAccountForm() {
  const [value, setValue] = useState<PayoutValue>(EMPTY);
  const [accountType, setAccountType] = useState("");
  const [none, setNone] = useState(false);
  const accountOnFile = useAccountOnFile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    call<{ account_type?: string | null } | null>(
      "gdb_bank.api.my_bank_details",
    )
      .then((d) => {
        const t = d?.account_type;
        if (t === "Checking" || t === "Savings")
          setAccountType((cur) => cur || t);
      })
      .catch(() => {});
  }, []);

  const problem = (): string | null => {
    if (!value.bank || !value.accountNo.trim())
      return "Tell us the bank account GDB should pay you into.";
    if (!accountType)
      return "Choose the type of account — Checking or Savings.";
    if (value.manual) {
      if (!value.branch) return "Choose your branch.";
      if (!value.holder.trim()) return "Enter the account holder name.";
      if (digits(value.confirmNo) !== digits(value.accountNo))
        return "The account numbers do not match.";
    }
    return null;
  };

  const save = async () => {
    const p = problem();
    setSaved(false);
    if (p) return setError(p);
    setBusy(true);
    setError(null);
    try {
      await call("gdb_bank.api.save_bank_details", {
        bank: value.bank,
        bank_account_no: value.accountNo,
        branch_code: value.branchCode,
        branch: value.manual ? value.branch : undefined,
        account_name: value.holder.trim() || undefined,
        account_type: accountType,
      });
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your account.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    // Its own save: Enter here must not submit the rest of My details.
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT")
          e.preventDefault();
      }}
    >
      {accountOnFile === false && (
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={none}
            onChange={(e) => setNone(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
          />
          <span className="text-sm font-bold text-slate-900">
            I don't have a bank account
          </span>
        </label>
      )}
      {none && !accountOnFile ? (
        <FacilitatedBanks />
      ) : (
        <>
          <PayoutAccount
            value={value}
            onChange={(next) => {
              setError(null);
              setSaved(false);
              setValue(next);
            }}
            onAccountType={setAccountType}
          />
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-800">
              Type of account
              <span className="ml-0.5 text-rose-500">*</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {["Checking", "Savings"].map((t) => (
                <ChoiceCard
                  key={t}
                  title={t}
                  selected={accountType === t}
                  onSelect={() => {
                    setSaved(false);
                    setAccountType(t);
                  }}
                />
              ))}
            </div>
          </fieldset>
          {error && <Notice tone="warn">{error}</Notice>}
          {saved && (
            <Notice tone="good">
              Saved. GDB checks the account before any payment is released.
            </Notice>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-full bg-brand-dark px-5 py-2 text-sm font-bold text-white hover:bg-[#071a3d] disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save bank account"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
