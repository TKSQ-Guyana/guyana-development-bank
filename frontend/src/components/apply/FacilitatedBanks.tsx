import { useEffect, useState } from "react";
import { call } from "../../api";

/** "I don't have a bank account": where to go, and the banks GDB facilitates.
 *
 *  The list is GDB's, kept in the desk (Bank > Facilitated for Applicants
 *  Without an Account) and read from `gdb_bank.api.facilitated_banks` — never
 *  written into the bundle, so it changes without a release. */
export function FacilitatedBanks() {
  const [banks, setBanks] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    call<string[]>("gdb_bank.api.facilitated_banks")
      .then(setBanks)
      .catch(() => setFailed(true));
  }, []);

  return (
    <section
      aria-label="No bank account"
      className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-base font-extrabold text-amber-900">
        Please reach out to the Help Desk for assistance.
      </p>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Facilitated Banks
      </p>
      {failed ? (
        <p className="mt-1 text-sm text-slate-600">
          The list could not be loaded. The Help Desk can tell you which banks
          are facilitated.
        </p>
      ) : banks === null ? (
        <p className="mt-1 text-sm text-slate-500">Loading…</p>
      ) : banks.length ? (
        <ul className="mt-1.5 list-disc pl-5 text-sm font-semibold text-slate-800">
          {banks.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-slate-600">
          The Help Desk can tell you which banks are facilitated.
        </p>
      )}
    </section>
  );
}
