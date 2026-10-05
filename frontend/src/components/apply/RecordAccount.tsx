import { useEffect, useState } from "react";
import { call } from "../../api";

/** The bank account the KYC register already holds for this person
 *  (gdb_bank.api.my_kyc_bank_account), offered as a choice on the payout step:
 *  use it — the form fills itself — or give a different one. Asked once per
 *  mount; nothing is filled until the person chooses. */

export interface RecordAccount {
  bank: string | null;
  bank_on_register: string;
  bank_known: boolean;
  branch: string | null;
  branch_name: string;
  routing_number: string | null;
  account_number: string;
  masked: string;
  holder: string;
  account_type: string;
}

export function RecordAccountOffer({
  currentAccountNo,
  onUse,
}: {
  /** The account number the form holds now — the card says so when it is this one. */
  currentAccountNo: string;
  onUse: (account: RecordAccount) => void;
}) {
  const [account, setAccount] = useState<RecordAccount | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    call<RecordAccount | null>("gdb_bank.api.my_kyc_bank_account")
      .then((a) => setAccount(a ?? null))
      .catch(() => setAccount(null));
  }, []);

  if (!account || dismissed) return null;
  const inUse =
    currentAccountNo.replace(/\D/g, "") ===
    account.account_number.replace(/\D/g, "");
  const where = [account.bank ?? account.bank_on_register, account.branch_name]
    .filter(Boolean)
    .join(" · ");

  if (inUse) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-sm text-emerald-900">
        <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-brand text-[11px] font-black text-white">
          ✓
        </span>
        <span>
          Using the account on record — <b className="font-bold">{where}</b>{" "}
          {account.masked}
        </span>
      </p>
    );
  }

  return (
    <section
      aria-label="Bank account on record"
      className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-4"
    >
      <p className="text-[11px] font-black uppercase tracking-wider text-emerald-800">
        We have a bank account on record for you
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-slate-900">{where}</p>
          <p className="font-mono text-sm font-bold tracking-wider text-slate-700">
            {account.masked}
            {account.account_type ? (
              <span className="ml-2 font-sans text-xs font-semibold tracking-normal text-slate-500">
                {account.account_type}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500">
            In the name of {account.holder || "—"}
          </p>
        </div>
        {account.bank_known ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onUse(account)}
              className="rounded-lg bg-black px-3.5 py-2 text-sm font-bold text-white hover:bg-[#262626]"
            >
              Use this account
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Use a different account
            </button>
          </div>
        ) : (
          <p className="max-w-xs text-xs font-semibold text-amber-800">
            GDB can't pay into {account.bank_on_register}. Enter an account at
            another bank below.
          </p>
        )}
      </div>
    </section>
  );
}
