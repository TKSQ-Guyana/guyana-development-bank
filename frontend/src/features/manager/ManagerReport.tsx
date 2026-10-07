import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { call } from "../../api";
import logo from "../../assets/manager/gdb-logo.png";
import "./manager.css";

/**
 * THE GDB TEAM REPORT — the GDB Manager's page, in the staff layout.
 *
 * GDB_Team_Report_protected.html as a live page: the same sheet, words and
 * tables, every figure read from gdb_bank.api.manager_report
 * (services/manager_report.py) and read again every POLL_MS — short polling,
 * paused while the tab is hidden and resumed the moment it is shown — plus the
 * "SME loans by business registration" card. Figures count to their new value
 * and flash once when they change; the clock ticks every second on the
 * server's (Guyana) time; a fraud lead that was not there before flashes.
 */

const POLL_MS = 15_000;
const RETRY_MS = 30_000;

type Money = { n: number; amt: number };
type Dist = [string, number, number][];
interface Report {
  as_of: string;
  total: Money;
  sme: Money;
  quick: Money;
  by_date: { d: string; sme: [number, number]; quick: [number, number] }[];
  stage: Dist;
  region: Dist;
  sector: Dist;
  age: Dist;
  registration: {
    with: RegSide;
    without: RegSide;
    structures: [string, number, number][];
  };
  no_bank_account: number;
  approved: number;
  duplicate_ids: number;
  bank_checked: boolean;
  fraud: Lead[];
  fraud_total: number;
}
interface RegSide {
  n: number;
  amt: number;
  existing: number;
  new: number;
  other: number;
}
interface Lead {
  type: string;
  risk: "high" | "med" | "low";
  key: string;
  apps: [string, string, "SME" | "Quick", number][];
}

// ---------------------------------------------------------------------------
// formatting — exactly as the report writes its figures
// ---------------------------------------------------------------------------

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const gd = (n: number) =>
  n >= 1e9
    ? "G$" + (n / 1e9).toFixed(2) + "B"
    : "G$" + (n / 1e6).toFixed(n >= 1e6 ? 1 : 2) + "M";
const pct = (a: number, b: number) =>
  b ? ((a / b) * 100).toFixed(1) + "%" : "—";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const two = (n: number) => String(n).padStart(2, "0");

/** The server's local time (America/Guyana), read as written. */
function serverMs(iso: string): number {
  const [d, t = "00:00:00"] = iso.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min, sec = 0] = t.split(":").map((v) => Math.floor(Number(v)));
  return Date.UTC(y, m - 1, day, h, min, sec);
}
function stamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h % 12 || 12}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} ${h < 12 ? "AM" : "PM"}`;
}

/** The server's wall clock, ticking every second between readings. */
function useServerClock(asOf: string): string {
  const at = serverMs(asOf);
  const offset = useRef(0);
  useEffect(() => {
    offset.current = at - Date.now();
  }, [at]);
  const [now, setNow] = useState(at);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset.current);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return stamp(now);
}

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A figure that counts from what it showed to `value` (from zero on the first
 *  reading) and flashes once when a later reading changes it. */
function Count({
  value,
  render,
}: {
  value: number;
  render: (n: number) => ReactNode;
}) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  const [bump, setBump] = useState(0);
  const from = useRef(reducedMotion() ? value : 0);
  const seen = useRef(false);

  useEffect(() => {
    const start = from.current;
    if (seen.current && start !== value) setBump((b) => b + 1);
    seen.current = true;
    if (start === value || reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1200);
      const v = start + (value - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span key={bump} className={bump ? "bump" : undefined}>
      {render(shown)}
    </span>
  );
}
const N = (v: number) => <Count value={v} render={fmt} />;
const G = (v: number) => <Count value={v} render={gd} />;

// ---------------------------------------------------------------------------
// polling
// ---------------------------------------------------------------------------

function useLiveReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      window.clearTimeout(timer);
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      let next = POLL_MS;
      try {
        setReport(await call<Report>("gdb_bank.api.manager_report"));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not refresh");
        next = RETRY_MS;
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = window.setTimeout(tick, next);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return { report, error };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

export function ManagerReport() {
  const { report, error } = useLiveReport();

  useEffect(() => {
    const before = document.title;
    document.title = "GDB Team Report";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <div className="mgr">
      {report ? (
        <Sheet r={report} error={error} />
      ) : (
        <div className="wrap">
          <p
            className="note"
            style={{ textAlign: "center", padding: "80px 0" }}
          >
            {error ?? "Loading the report…"}
          </p>
        </div>
      )}
    </div>
  );
}

const leadKey = (f: Lead) =>
  `${f.type}|${f.key}|${f.apps.map((a) => a[0]).join(",")}`;

function Sheet({ r, error }: { r: Report; error: string | null }) {
  const now = useServerClock(r.as_of);

  // Leads not in the previous reading flash once.
  const seenLeads = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  const keys = r.fraud.map(leadKey);
  if (seenLeads.current)
    keys.forEach((k) => !seenLeads.current!.has(k) && fresh.add(k));
  useEffect(() => {
    seenLeads.current = new Set(keys);
  });

  const kp: [ReactNode, string][] = [
    [N(r.total.n), "Applications"],
    [G(r.total.amt), "Total requested"],
    [N(r.sme.n), "SME Loans · " + gd(r.sme.amt)],
    [N(r.quick.n), "Quick Loans · " + gd(r.quick.amt)],
    [G(r.total.n ? r.total.amt / r.total.n : 0), "Average loan size"],
    [N(r.fraud_total), "Fraud leads to review"],
  ];
  const nApps = r.fraud.reduce((s, f) => s + f.apps.length, 0);
  const hi = r.fraud.filter((f) => f.risk === "high").length;
  const rl = {
    high: ["High", "p-high"],
    med: ["Medium", "p-med"],
    low: ["Low", "p-low"],
  } as const;

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <img className="logo" src={logo} alt="Guyana Development Bank" />
          <div>
            <div className="eyebrow">
              Guyana Development Bank · Loan applications
            </div>
            <h1>
              GDB Team Report<span className="dot">.</span>
            </h1>
          </div>
        </div>
        <div className="asof">
          Data as of
          <br />
          {now} (Guyana time)
          <br />
          <span className={`live${error ? " off" : ""}`} aria-live="polite">
            <i className="pulse" aria-hidden="true" />
            {error ? "Reconnecting…" : `Live · every ${POLL_MS / 1000}s`}
          </span>
        </div>
      </header>

      <div className="kpis">
        {kp.map(([v, l], i) => (
          <div
            className={`kpi${i === kp.length - 1 ? " alert" : ""}`}
            key={l.split(" ")[0] + i}
          >
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>

      <div className="grid2">
        <section>
          <h2>Applications by created date</h2>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="n">SME</th>
                  <th className="n">Quick</th>
                  <th className="n">Total</th>
                  <th className="n">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.by_date.map((d) => (
                  <tr key={d.d}>
                    <td className="mono">{d.d}</td>
                    <td className="n">{N(d.sme[0])}</td>
                    <td className="n">{N(d.quick[0])}</td>
                    <td className="n">{N(d.sme[0] + d.quick[0])}</td>
                    <td className="n">{G(d.sme[1] + d.quick[1])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="n">{N(r.sme.n)}</td>
                  <td className="n">{N(r.quick.n)}</td>
                  <td className="n">{N(r.total.n)}</td>
                  <td className="n">{G(r.total.amt)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        <section>
          <h2>New vs existing business</h2>
          <DistTable rows={r.stage} label="Stage" total={r.total.n} />
          <p className="note">
            Business stage is only captured on the SME application form. Quick
            Loans don&apos;t ask it.
          </p>
        </section>
      </div>

      <Registration r={r} />

      <div className="grid2">
        <section>
          <h2>By region</h2>
          <DistTable rows={r.region} label="Region" total={r.total.n} />
        </section>
        <section>
          <h2>By sector</h2>
          <DistTable rows={r.sector} label="Sector" total={r.total.n} />
        </section>
      </div>
      <div className="grid2">
        <section>
          <h2>By applicant age</h2>
          <DistTable rows={r.age} label="Age band" total={r.total.n} />
          <p className="note">
            Age from date of birth on the applicant profile, as of the report
            date.
          </p>
        </section>
        <section>
          <h2>Average loan size</h2>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="n">Apps</th>
                  <th className="n">Total</th>
                  <th className="n">Average</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="pill p-sme">SME Loan</span>
                  </td>
                  <td className="n">{N(r.sme.n)}</td>
                  <td className="n">{G(r.sme.amt)}</td>
                  <td className="n">{G(r.sme.n ? r.sme.amt / r.sme.n : 0)}</td>
                </tr>
                <tr>
                  <td>
                    <span className="pill p-quick">Quick Loan</span>
                  </td>
                  <td className="n">{N(r.quick.n)}</td>
                  <td className="n">{G(r.quick.amt)}</td>
                  <td className="n">
                    {G(r.quick.n ? r.quick.amt / r.quick.n : 0)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>All products</td>
                  <td className="n">{N(r.total.n)}</td>
                  <td className="n">{G(r.total.amt)}</td>
                  <td className="n">
                    {G(r.total.n ? r.total.amt / r.total.n : 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>

      <section>
        <h2>Potential fraud — review list</h2>
        <div className="callout">
          {r.bank_checked ? (
            <>
              <b>Bank account comparison runs on approved cases.</b>{" "}
              {fmt(r.approved)} case
              {r.approved === 1 ? " is" : "s are"} approved so far; any bank
              account nominated by two borrowers is listed below as High.{" "}
              {fmt(r.no_bank_account)} applicants declared they have no bank
              account.
            </>
          ) : (
            <>
              <b>Bank account comparison not yet possible.</b> The portal only
              shows the nominated bank account on the Facility tab after a case
              is approved, and every application is still Under Review. This
              check will run automatically once cases are approved.{" "}
              {fmt(r.no_bank_account)} applicants declared they have no bank
              account.
            </>
          )}
        </div>
        <p className="note">
          {fmt(r.fraud_total)} groups covering {fmt(nApps)} applications ({hi}{" "}
          high priority). Checks run: shared household address, shared phone
          number, duplicate national ID (
          {r.duplicate_ids ? `${r.duplicate_ids} found` : "none found"}), and
          repeated names
          {r.bank_checked ? ", and shared bank accounts on approved cases" : ""}
          .
          {r.fraud_total > r.fraud.length
            ? ` Showing the first ${r.fraud.length}.`
            : ""}
        </p>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Risk</th>
                <th>Signal</th>
                <th>Matched on</th>
                <th>Applications</th>
                <th className="n">Combined</th>
              </tr>
            </thead>
            <tbody>
              {r.fraud.map((f) => (
                <tr
                  key={leadKey(f)}
                  className={fresh.has(leadKey(f)) ? "fresh" : undefined}
                >
                  <td>
                    <span className={`pill ${rl[f.risk][1]}`}>
                      {rl[f.risk][0]}
                    </span>
                  </td>
                  <td>{f.type}</td>
                  <td>{f.key}</td>
                  <td>
                    <div className="who">
                      {f.apps.map((a) => (
                        <div key={a[0]}>
                          <span className="mono">{a[0]}</span> · {a[1]}{" "}
                          <span
                            className={`pill ${a[2] === "SME" ? "p-sme" : "p-quick"}`}
                          >
                            {a[2]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="n">
                    {gd(f.apps.reduce((s, a) => s + a[3], 0))}
                  </td>
                </tr>
              ))}
              {!r.fraud.length && (
                <tr>
                  <td colSpan={5} className="note">
                    No leads right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="note">
          Shared address: applicants whose normalised address (lot number +
          street, same village/town) matches another applicant with a different
          name. High = same surname at the same lot (likely one household).
          Medium = different surnames at the same lot. Low = matched on an area
          name only, with no lot number. These are leads for a loan officer, not
          findings.
        </p>
      </section>
    </div>
  );
}

function DistTable({
  rows,
  label,
  total,
}: {
  rows: Dist;
  label: string;
  total: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="tbl">
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th className="n">Apps</th>
            <th className="n">Share</th>
            <th className="n">Amount</th>
            <th className="n">Avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, n, a]) => (
            <tr key={k}>
              <td>
                {k}
                <div
                  className="bar grow-x"
                  style={{ width: `${Math.max(2, (n / max) * 100)}%` }}
                >
                  <i />
                </div>
              </td>
              <td className="n">{N(n)}</td>
              <td className="n">{pct(n, total)}</td>
              <td className="n">{G(a)}</td>
              <td className="n">{G(n ? a / n : 0)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="note">
                No applications yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SME loans by business registration (added 2026-10-07)
// ---------------------------------------------------------------------------

function Registration({ r }: { r: Report }) {
  const { with: w, without: wo, structures } = r.registration;
  const sme = w.n + wo.n;
  const max = Math.max(1, w.n, wo.n);
  const box = (side: RegSide, kind: "with" | "without", title: string) => (
    <div className={`regbox${kind === "without" ? " without" : ""}`}>
      <div className="lbl">{title}</div>
      <div className="big">{N(side.n)}</div>
      <dl>
        <dt>Share of SME</dt>
        <dd>{sme ? Math.round((side.n / sme) * 100) : 0}%</dd>
        <dt>Requested</dt>
        <dd>{G(side.amt)}</dd>
        <dt>Avg loan</dt>
        <dd>{G(side.n ? side.amt / side.n : 0)}</dd>
      </dl>
    </div>
  );
  const bar = (side: RegSide, label: string) => (
    <div className="regbar">
      <span className="rl">{label}</span>
      <div className="track">
        {[
          ["existing", side.existing, "sw-ex", "Existing business"],
          ["new", side.new, "sw-new", "New venture"],
          ["other", side.other, "sw-other", "Stage not stated"],
        ]
          .filter(([, n]) => (n as number) > 0)
          .map(([k, n, cls, title]) => (
            <div
              key={k as string}
              className={`seg ${cls}`}
              title={`${title}: ${n}`}
              style={{ width: `${((n as number) / max) * 100}%` }}
            >
              {(n as number) / max > 0.06 ? fmt(n as number) : ""}
            </div>
          ))}
      </div>
      <span className="tot">{N(side.n)}</span>
    </div>
  );
  return (
    <section className="regcard" aria-labelledby="h-reg">
      <div className="rh">
        <h3 id="h-reg">SME loans by business registration</h3>
        <span className="tag">DCRA registration number provided</span>
      </div>
      <p className="rs">
        SME applications split by whether a valid business registration number
        was supplied. Entries such as “N/A”, “NIL”, “NONE” or “0000000” count as
        not registered.
      </p>
      <div className="regbody">
        <div className="regboxes">
          {box(w, "with", "With registration")}
          {box(wo, "without", "Without registration")}
        </div>
        <div className="regside">
          <div className="reglegend">
            <span>
              <i className="sw-ex" />
              Existing business
            </span>
            <span>
              <i className="sw-new" />
              New venture
            </span>
            {w.other + wo.other > 0 && (
              <span>
                <i className="sw-other" />
                Stage not stated
              </span>
            )}
          </div>
          <div className="regbars">
            {bar(w, "With reg.")}
            {bar(wo, "Without reg.")}
          </div>
          <div className="regtable">
            <table>
              <thead>
                <tr>
                  <th>Legal structure</th>
                  <th className="n">With reg.</th>
                  <th className="n">Without reg.</th>
                </tr>
              </thead>
              <tbody>
                {structures.map(([k, a, b]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="n">{N(a)}</td>
                    {/* An incorporated business without a registration is a contradiction. */}
                    <td
                      className={`n${k === "Incorporated (Inc.)" && b > 0 ? " flag" : ""}`}
                    >
                      {N(b)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
