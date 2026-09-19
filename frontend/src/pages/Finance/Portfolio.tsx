import { useCallback, useEffect, useState } from 'react';
import { ApiError, getList, runReport } from '../../api';
import type { ReportColumn } from '../../api';
import { formatGyd } from '../../utils';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';

/** The portfolio: what the Bank has lent, what has come back, what is still to come.
 *
 *  Every figure comes from frappe/lending's OWN standard reports through
 *  `frappe.desk.query_report.run` — the same reports the ERPNext desk shows.
 *  The portal computes nothing and stores nothing: one implementation of the
 *  numbers, nothing to drift, and a figure here can always be traced to the
 *  desk report it came from. See install.ensure_lending_reports_read for the
 *  grant that makes this readable at all.
 */

const CURRENCY_TYPES = new Set(['Currency', 'Float']);

type TabId = 'outstanding' | 'future' | 'past' | 'closure';

interface Tab {
  id: TabId;
  label: string;
  report: string;
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
    blurb: 'Individual repayments as they were posted, and the loans they closed. The audit trail behind the totals on the other three tabs.',
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
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Finance</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Portfolio</h1>
      <p className="mt-2 text-sm text-slate-500">
        What GDB has lent and what is coming back, as at {today}.
      </p>

      <div className="mt-6">
        <SegmentedControl value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label }))} />
      </div>

      <Card className="mt-6 border border-brand-light bg-brand-light/30">
        <h2 className="text-sm font-semibold text-brand-text">{active.label}</h2>
        <p className="mt-1 text-sm text-slate-700">{active.blurb}</p>
      </Card>

      {denied && (
        <Card className="mt-6 border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">You do not have portfolio access.</p>
          <p className="mt-1">Reading the loan book needs the Finance Officer role. Ask an administrator to grant it.</p>
        </Card>
      )}
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!denied && !error && !view && <p className="mt-4 text-slate-500">Loading…</p>}
      {view && view.rows.length === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Nothing to show here yet.
        </p>
      )}

      {view && view.rows.length > 0 && (
        <>
          <p className="mt-4 mb-2 text-xs text-slate-500">
            {view.rows.length} {view.rows.length === 1 ? 'row' : 'rows'}
          </p>
          <Card className="overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  {view.columns.map((c) => (
                    <th
                      key={c.fieldname}
                      className={`px-5 py-3 ${CURRENCY_TYPES.has(c.fieldtype ?? '') ? 'text-right' : ''}`}
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
          </Card>
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
    <td className={`px-5 py-3 ${isMoney ? 'text-right tabular-nums' : ''} text-slate-700`}>{text}</td>
  );
}
