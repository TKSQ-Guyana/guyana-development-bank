import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { call } from "../../api";
import { formatDate } from "../../utils";

interface FieldOfficerRequest {
  name: string;
  region: string;
  business_type: string;
  phone: string;
  status: string;
  requested_on: string;
}

interface InformationRequest {
  name: string;
  application: string;
  document_type: string | null;
  item: string;
  requested_on: string | null;
}

interface MyRequests {
  field_officer: FieldOfficerRequest | null;
  information: InformationRequest[];
}

/** How a field officer request reads to the person who made it; statuses not
 *  listed (finished ones) are not shown on the dashboard. */
const FIELD_STATUS: Record<
  string,
  { label: string; tone: string; text: (r: FieldOfficerRequest) => string }
> = {
  Waiting: {
    label: "Sent",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
    text: (r) =>
      `A GDB field officer from ${r.region.split(" — ")[0]} will reach out to you soon.`,
  },
  Accepted: {
    label: "With a field officer",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    text: () =>
      "A field officer has taken your request and will contact you to arrange a time.",
  },
  "Visit booked": {
    label: "Visit booked",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    text: () => "Your visit with a GDB field officer is booked.",
  },
  "Couldn't reach": {
    label: "Couldn't reach you",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    text: (r) =>
      `We couldn't reach you on ${r.phone}. You can ask for a field officer again.`,
  },
};

/** "Your requests" on the dashboard: a field officer the citizen asked for, and
 *  anything GDB has asked them for that is still open — each with the way to
 *  act on it. Renders nothing when there is nothing open. */
export function YourRequests() {
  const [data, setData] = useState<MyRequests | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<MyRequests>("gdb_bank.api.my_requests")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  useEffect(load, [load]);

  if (!data) return null;
  const fo = data.field_officer;
  const foStatus = fo ? FIELD_STATUS[fo.status] : undefined;
  if (!foStatus && data.information.length === 0) return null;

  const cancel = async () => {
    if (!fo) return;
    setBusy(true);
    setError(null);
    try {
      await call("gdb_bank.api.cancel_field_officer_request", {
        name: fo.name,
      });
      load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not cancel the request.",
      );
    } finally {
      setBusy(false);
    }
  };

  const count = (foStatus ? 1 : 0) + data.information.length;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white shadow-xs"
      aria-label="Your requests"
    >
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <h3 className="text-base font-extrabold tracking-tight text-slate-900">
          Your requests
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
          {count}
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {fo && foStatus && (
          <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 gap-3">
              <span
                className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-emerald-50 text-brand-dark ring-1 ring-emerald-200"
                aria-hidden
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4.5 w-4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                  Field officer help
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${foStatus.tone}`}
                  >
                    {foStatus.label}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {foStatus.text(fo)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {fo.business_type} · {fo.region} · sent{" "}
                  {formatDate(fo.requested_on)} ·{" "}
                  <span className="font-mono font-semibold text-slate-500">
                    {fo.name}
                  </span>
                </p>
              </div>
            </div>
            {fo.status === "Waiting" && (
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Cancel request"}
              </button>
            )}
          </li>
        )}

        {data.information.map((r) => (
          <li
            key={r.name}
            className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
          >
            <div className="flex min-w-0 gap-3">
              <span
                className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                aria-hidden
              >
                !
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                  GDB needs{" "}
                  {r.document_type
                    ? `your ${r.document_type}`
                    : "something from you"}
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                    Action needed
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-slate-600">{r.item}</p>
                <p className="mt-1 text-xs text-slate-400">
                  On{" "}
                  <span className="font-mono font-semibold text-slate-500">
                    {r.application}
                  </span>
                  {r.requested_on
                    ? ` · asked ${formatDate(r.requested_on)}`
                    : ""}
                </p>
              </div>
            </div>
            <Link
              to={`/loans/${r.application}`}
              className="rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white hover:bg-[#262626]"
            >
              Respond
            </Link>
          </li>
        ))}
      </ul>
      {error && (
        <p className="border-t border-slate-100 px-5 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
