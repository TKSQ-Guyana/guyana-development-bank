import { useEffect, useState } from "react";
import { call } from "../../api";

/** "I don't have a bank account": where to go, and the banks GDB facilitates.
 *
 *  The list is GDB's, kept in the desk (Bank > Facilitated for Applicants
 *  Without an Account) and read from `gdb_bank.api.facilitated_banks` — never
 *  written into the bundle, so it changes without a release. Each links to
 *  the bank's own site (Bank > Website). */
export function FacilitatedBanks() {
  const [banks, setBanks] = useState<
    { name: string; website: string | null }[] | null
  >(null);
  const [failed, setFailed] = useState(false);

  // One retry before giving up: a blip on a slow connection should not leave
  // someone without a bank account looking at "could not be loaded".
  useEffect(() => {
    let live = true;
    const load = (tries: number) =>
      call<{ name: string; website: string | null }[]>(
        "gdb_bank.api.facilitated_bank_sites",
      )
        .then((b) => live && setBanks(b))
        .catch(() => {
          if (!live) return;
          if (tries > 0) window.setTimeout(() => void load(tries - 1), 1500);
          else setFailed(true);
        });
    void load(1);
    return () => {
      live = false;
    };
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
            <li key={b.name}>
              {b.website ? (
                <a
                  href={b.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gdb-indigo underline decoration-1 underline-offset-2 hover:text-brand"
                >
                  {b.name}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                b.name
              )}
            </li>
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
