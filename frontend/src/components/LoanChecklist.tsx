import { useCallback, useEffect, useState } from "react";
import { call } from "../api";

/** One item of the loan officer's checklist (gdb_bank.api.loan_checklist). */
export interface ChecklistItem {
  key: "eid" | "national_id" | "bank_account" | "payslip";
  label: string;
  status: "ok" | "requested" | "missing";
  detail: string | null;
  request_type: string | null;
  request_item: string;
  /** This item is what keeps the case from the disbursement officer. */
  blocking: boolean;
}

export interface Checklist {
  items: ChecklistItem[];
  ready: boolean;
  outstanding: string[];
}

const STATUS: Record<
  ChecklistItem["status"],
  { text: string; tone: string; dot: string }
> = {
  ok: {
    text: "In place",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  requested: {
    text: "Requested",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  missing: {
    text: "Missing",
    tone: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
};

/** The checklist before a case moves to the disbursement officer — e-ID,
 *  National ID, bank account, payslip. The server holds the rule
 *  (services/checklist) and refuses booking until it is ready; this shows it,
 *  and lets the loan officer ask the applicant for what is missing. */
export function LoanChecklist({
  application,
  canRequest,
  onChange,
}: {
  application: string;
  /** The loan officer: may ask the applicant for a missing item. */
  canRequest: boolean;
  onChange?: () => void;
}) {
  const [list, setList] = useState<Checklist | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Checklist>("gdb_bank.api.loan_checklist", { application })
      .then(setList)
      .catch((err: Error) => setError(err.message));
  }, [application]);

  useEffect(load, [load]);

  const ask = async (item: ChecklistItem) => {
    setBusy(item.key);
    setError(null);
    try {
      await call("gdb_bank.documents.request_information", {
        application,
        item: item.request_item,
        document_type: item.request_type ?? undefined,
      });
      load();
      onChange?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the request.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!list) {
    return error ? (
      <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    ) : null;
  }

  return (
    <section
      aria-label="Loan officer's checklist"
      className={`mt-4 overflow-hidden rounded-xl border bg-white shadow-sm ${
        list.ready ? "border-emerald-200" : "border-amber-200"
      }`}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 ${
          list.ready ? "bg-emerald-50/70" : "bg-amber-50/70"
        }`}
      >
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Checklist before approval and disbursement
          </h2>
          <p className="text-xs text-slate-600">
            {list.ready
              ? "Complete — the case can be approved and disbursed."
              : `Approval and disbursement wait on ${list.outstanding.join(", ")}.`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
            list.ready
              ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
              : "bg-amber-100 text-amber-800 ring-amber-200"
          }`}
        >
          {list.items.filter((i) => !i.blocking).length} of {list.items.length}{" "}
          done
        </span>
      </header>

      <ul className="divide-y divide-slate-100">
        {list.items.map((item) => {
          const s = STATUS[item.status];
          return (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 flex-none rounded-full ${s.dot}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {item.label}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {item.status === "ok"
                      ? item.detail
                      : item.status === "requested"
                        ? item.key === "eid"
                          ? "Asked for — the borrower has 90 days to get it."
                          : "Asked for — waiting on the applicant."
                        : item.request_item}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${s.tone}`}
                >
                  {s.text}
                </span>
                {canRequest && item.status === "missing" && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void ask(item)}
                    className="rounded-lg border border-brand px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
                  >
                    {busy === item.key ? "Sending…" : "Ask applicant"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="border-t border-slate-100 px-5 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
