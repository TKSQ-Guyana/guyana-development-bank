import { useCallback, useEffect, useState } from "react";
import { call } from "../../api";
import { formatPhone } from "../../components/PhoneInput";
import { Card } from "../../components/ui/Card";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { formatDate } from "../../utils";

/** The GDB Representative's queue: the appointment requests from the public
 *  site ("Book appointment" on the home page) and from sign-up (no National ID,
 *  or a phone on record that is not theirs). Newest first; a representative
 *  calls the person back and moves the request on with a note.
 *  gdb_bank.api.appointment_queue / update_appointment. */

const STATUSES = ["New", "Contacted", "Booked", "Closed"] as const;
type Status = (typeof STATUSES)[number];
type Tab = Status | "All";
const PAGE = 20;

interface Appointment {
  name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  region: string | null;
  industry_sector: string | null;
  reason: string | null;
  national_id: string | null;
  status: Status;
  requested_on: string | null;
  handled_by_name: string | null;
  outcome_note: string | null;
  /** How the "we received your request" text went (integrations/sms). */
  sms_status: string | null;
  sms_error: string | null;
}

interface Queue {
  rows: Appointment[];
  total: number;
  counts: Record<Status, number>;
}

const TONE: Record<Status, string> = {
  New: "bg-amber-50 text-amber-800 ring-amber-200",
  Contacted: "bg-sky-50 text-sky-800 ring-sky-200",
  Booked: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Closed: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function AppointmentDesk() {
  const [tab, setTab] = useState<Tab>("New");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(0);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Queue>("gdb_bank.api.appointment_queue", {
      status: tab === "All" ? undefined : tab,
      search: query || undefined,
      start,
      page_length: PAGE,
    })
      .then((q) => {
        setQueue(q);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [tab, query, start]);

  useEffect(load, [load]);

  // Search as they stop typing.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setStart(0);
      setQuery(search.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const counts = queue?.counts;
  const tabs = [
    ...STATUSES.map((s) => ({
      id: s as Tab,
      label: counts ? `${s} ${counts[s]}` : s,
    })),
    { id: "All" as Tab, label: "All" },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">
            GDB Representative
          </p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">
            Appointment requests
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            People who asked GDB to call them. Call them back, book a time, and
            record what was agreed.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone or reference"
          aria-label="Search appointment requests"
          className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm sm:w-72"
        />
      </header>

      <div className="overflow-x-auto">
        <SegmentedControl
          options={tabs}
          value={tab}
          onChange={(t) => {
            setStart(0);
            setTab(t);
          }}
        />
      </div>

      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {!queue ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-500">
          {query
            ? "No request matches your search."
            : tab === "New"
              ? "No new requests. You are up to date."
              : "No requests here."}
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.rows.map((row) => (
            <AppointmentRow key={row.name} row={row} onSaved={load} />
          ))}
        </div>
      )}

      {queue && queue.total > PAGE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {start + 1}–{Math.min(start + PAGE, queue.total)} of {queue.total}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={start === 0}
              onClick={() => setStart(Math.max(start - PAGE, 0))}
              className="rounded-full border border-slate-300 px-4 py-1.5 font-semibold disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={start + PAGE >= queue.total}
              onClick={() => setStart(start + PAGE)}
              className="rounded-full border border-slate-300 px-4 py-1.5 font-semibold disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function AppointmentRow({
  row,
  onSaved,
}: {
  row: Appointment;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<Status>(row.status);
  const [note, setNote] = useState(row.outcome_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = status !== row.status || note !== (row.outcome_note ?? "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("gdb_bank.api.update_appointment", {
        name: row.name,
        status,
        note,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string][] = [
    ["Phone", `+592 ${formatPhone(row.phone)}`],
    ...(row.email ? ([["Email", row.email]] as [string, string][]) : []),
    ...(row.region ? ([["Region", row.region]] as [string, string][]) : []),
    ...(row.industry_sector
      ? ([["Industry", row.industry_sector]] as [string, string][])
      : []),
    ...(row.national_id
      ? ([["National ID", row.national_id]] as [string, string][])
      : []),
    ...(row.sms_status
      ? ([
          [
            "Text message",
            row.sms_status === "Failed" && row.sms_error
              ? `Failed — ${row.sms_error}`
              : row.sms_status,
          ],
        ] as [string, string][])
      : []),
  ];

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-base font-extrabold text-slate-900">
            {row.first_name} {row.last_name}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${TONE[row.status]}`}
            >
              {row.status}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono text-brand">{row.name}</span>
            {" · "}
            {row.reason || "Appointment"}
            {row.requested_on ? ` · ${formatDate(row.requested_on)}` : ""}
            {row.handled_by_name ? ` · ${row.handled_by_name}` : ""}
          </p>
        </div>
        <a
          href={`tel:${row.phone}`}
          className="rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white hover:bg-brand-dark"
        >
          Call
        </a>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {k}
            </dt>
            <dd className="break-words font-semibold text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <label className="block text-xs font-semibold text-slate-600">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Booked for Tuesday 10am at the Georgetown office"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void save()}
          className="rounded-full bg-brand-dark px-5 py-2 text-sm font-bold text-white hover:bg-[#022c19] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Card>
  );
}
