import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getList, runReport } from '../../api';
import type { ReportColumn } from '../../api';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { reportColumns, reportTotal, type ReportRow } from '../../shared/reportTable';

/** The portfolio: what the Bank has lent, what has come back, what is still to come.
 *
 *  Every figure comes from frappe/lending's OWN standard reports through
 *  `frappe.desk.query_report.run` — the same reports the ERPNext desk shows.
 *  The portal computes nothing and stores nothing: one implementation of the
 *  numbers, nothing to drift, and a figure here can always be traced to the
 *  desk report it came from. See install.ensure_lending_reports_read for the
 *  grant that makes this readable at all.
 */

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
  rows: ReportRow[];
  /** Frappe's own total row when the report has Add Total Row set. Displayed,
   *  never computed here — the Bank's books have one implementation. */
  total: ReportRow | null;
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
      const { columns, rows, total } = await runReport(active.report, filters);
      setView({ columns, rows, total });
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

  const columns = useMemo(() => reportColumns(view?.columns ?? []), [view]);

  return (
    <div>
      {/* No page title: the layout header already says FINANCE / Portfolio,
          and repeating it pushed the first row of data below the fold. */}
      <p className="text-sm text-slate-500">
        What GDB has lent and what is coming back, as at {today}.
      </p>

      <div className="mt-3">
        <SegmentedControl value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label }))} />
      </div>

      <p className="mt-3 rounded-lg border border-brand-light bg-brand-light/30 px-3 py-2 text-xs leading-relaxed text-slate-700">
        <span className="font-semibold text-brand-text">{active.label}.</span> {active.blurb}
      </p>

      {denied && (
        <Card className="mt-3 border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">You do not have portfolio access.</p>
          <p className="mt-1">Reading the loan book needs the Finance Officer role. Ask an administrator to grant it.</p>
        </Card>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!denied && !error && !view && <p className="mt-3 text-slate-500">Loading…</p>}

      {view && (
        <div className="mt-3">
          <DataTable
            caption={`${active.label} — ${active.blurb}`}
            columns={columns}
            rows={view.rows}
            rowKey={(_, i) => String(i)}
            total={reportTotal(view.columns, view.total)}
            // Wide reports scroll rather than crushing a loan reference into
            // four wrapped lines, which is what the old table did.
            minWidth={`${Math.max(48, columns.length * 9)}rem`}
            empty="Nothing to show here yet."
          />
        </div>
      )}
    </div>
  );
}
