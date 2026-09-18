import { useCallback, useEffect, useState } from 'react';
import { ApiError, getList, runReport } from '../api';
import type { ReportColumn } from '../api';
import { formatGyd } from '../utils';

/** The portfolio: what the Bank has lent, what has come back, what is still to come.
 *
 *  Every figure comes from frappe/lending's OWN standard reports through
 *  `frappe.desk.query_report.run` — the same reports the ERPNext desk shows.
 *  The portal computes nothing and stores nothing: one implementation of the
 *  numbers, nothing to drift, and a figure here can always be traced to the
 *  desk report it came from.
 *
 *  These reports shipped with lending and were unreachable from the portal
 *  until now — granted to `Loan Manager`/`Employee`, which the disbursement
 *  officer held only by accident of the demo seed. `install.ensure_lending_
 *  reports_read` puts them on the Finance Officer role properly, read and
 *  report only.
 *
 *  Each tab carries a sentence saying what question it answers, because a
 *  column called "Total Principal Paid" means nothing to somebody who has not
 *  been told what the table is for.
 *
 *  The four Loan Security reports are deliberately absent: this build takes no
 *  collateral, so they would render an empty table that reads like a portfolio
 *  with nothing pledged rather than a feature that does not apply.
 */

const CURRENCY_TYPES = new Set(['Currency', 'Float']);

type TabId = 'outstanding' | 'future' | 'past' | 'closure';

interface Tab {
  id: TabId;
  label: string;
  report: string;
  /** What this report answers, in the words an officer would use. */
  blurb: string;
}

const TABS: Tab[] = [
  {
    id: 'outstanding',
    label: 'Loan Outstanding',
    report: 'Loan Outstanding Report',
    blurb:
      'Every loan on the books as at today: what was sanctioned, what has actually been paid out, and how much principal has come back. This is the Bank’s exposure — start here.',
  },
  {
    id: 'future',
    label: 'Future Cashflow',
    report: 'Future Cashflow Report',
    blurb:
      'What borrowers are scheduled to pay GDB from today onwards, taken from the repayment schedules issued at disbursement. What the Bank expects to receive.',
  },
  {
    id: 'past',
    label: 'Past Cashflow',
    report: 'Past Cashflow Report',
    blurb:
      'What has actually been received up to today. Read against Future Cashflow, the gap between expected and received is where collections work lives.',
  },
  {
    id: 'closure',
    label: 'Repayment & Closure',
    report: 'Loan Repayment and Closure',
    blurb:
      'Individual repayments as they were posted, and the loans they closed. The audit trail behind the totals on the other three tabs.',
  },
];

interface View {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export function Portfolio() {
  const [tab, setTab] = useState<TabId>('outstanding');
  const [company, setCompany] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const active = TABS.find((t) => t.id === tab) as Tab;

  useEffect(() => {
    getList<{ name: string }>('Company', { fields: ['name'], limit: 1 })
      .then((companies) => setCompany(companies[0]?.name ?? null))
      .catch((err: Error) => {
        if (err instanceof ApiError && (err.status === 403 || /permission/i.test(err.message))) {
          setDenied(true);
        } else {
          setError(err.message);
        }
      });
  }, []);

  const load = useCallback(async () => {
    if (!company) return;
    setView(null);
    setError(null);
    setDenied(false);

    // Each report demands its own filters and throws by name without them:
    // Loan Outstanding and Past Cashflow want an as-on date, Future Cashflow
    // wants the company as well. Sent explicitly rather than hopefully.
    const filters: Record<string, unknown> = { company, as_on_date: today };

    try {
      const { columns, rows } = await runReport(active.report, filters);
      setView({ columns, rows });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || /permission/i.test(err.message))) {
        setDenied(true);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load the report');
      }
    }
  }, [company, active, today]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Portfolio</h1>
      <p className="mb-6 text-sm text-slate-500">
        What GDB has lent and what is coming back, as at {today}. Straight from the loan ledger.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t.id
                ? 'bg-gdb-green text-white'
                : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* What the table below is for. Shown above the data, not tucked in a
          tooltip — the officer reading this may be seeing it for the first time. */}
      <div className="mb-4 rounded-xl border border-gdb-gold/50 bg-gdb-gold/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-gdb-green-dark">{active.label}</h2>
        <p className="mt-1 text-sm text-slate-700">{active.blurb}</p>
      </div>

      {denied && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">You do not have portfolio access.</p>
          <p className="mt-1">
            Reading the loan book needs the{' '}
            <span className="font-mono">Finance Officer</span> role on your Frappe user. Ask an
            administrator to grant it. Nothing on this page works around that check.
          </p>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!denied && !error && !view && <p className="text-slate-500">Loading…</p>}
      {view && view.rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Nothing to show here yet.
        </p>
      )}

      {view && view.rows.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {view.rows.length} {view.rows.length === 1 ? 'row' : 'rows'}
          </p>
          <div className="overflow-x-auto rounded-xl bg-white shadow">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {view.columns.map((c) => (
                    <th
                      key={c.fieldname}
                      className={`px-4 py-3 ${
                        CURRENCY_TYPES.has(c.fieldtype ?? '') ? 'text-right' : ''
                      }`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {view.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {view.columns.map((c) => (
                      <Cell key={c.fieldname} column={c} row={row} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ column, row }: { column: ReportColumn; row: Record<string, unknown> }) {
  const value = row[column.fieldname];
  const isMoney = CURRENCY_TYPES.has(column.fieldtype ?? '');

  let text: string;
  if (value === null || value === undefined || value === '') text = '—';
  else if (isMoney) text = formatGyd(Number(value));
  else text = String(value);

  return (
    <td className={`px-4 py-2 ${isMoney ? 'text-right tabular-nums' : ''} text-slate-700`}>
      {text}
    </td>
  );
}
