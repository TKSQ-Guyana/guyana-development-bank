import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getList, runReport } from '../../api';
import type { ReportColumn } from '../../api';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import {
  reportColumns,
  reportRowClass,
  reportTotal,
  type ReportRow,
} from '../../shared/reportTable';

/** The ledger: ERPNext's own accounting reports, rendered in the portal.
 *
 *  Every figure here comes from `frappe.desk.query_report.run` against the
 *  stock reports the desk uses, so there is exactly one implementation of the
 *  numbers and nothing to drift. The chart of accounts is read straight off
 *  /api/resource/Account. No new backend endpoint, and no arithmetic here.
 *
 *  Access is Frappe's to decide, not this page's: a user without an accounts
 *  role gets a 403 from the API and the explanation below, rather than an
 *  empty table that looks like a balanced book.
 */

type TabId = 'trial_balance' | 'general_ledger' | 'balance_sheet' | 'profit_and_loss' | 'accounts';

const TABS: { id: TabId; label: string }[] = [
  { id: 'trial_balance', label: 'Trial Balance' },
  { id: 'general_ledger', label: 'General Ledger' },
  { id: 'balance_sheet', label: 'Balance Sheet' },
  { id: 'profit_and_loss', label: 'Profit & Loss' },
  { id: 'accounts', label: 'Chart of Accounts' },
];

interface AccountRow {
  name: string;
  account_name: string;
  root_type: string | null;
  account_type: string | null;
  is_group: number;
}

interface View {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Frappe's own total row when the report carries one. Never summed here. */
  total: ReportRow | null;
}

export function Ledger() {
  const [tab, setTab] = useState<TabId>('trial_balance');
  const [company, setCompany] = useState<string | null>(null);
  const [fiscalYear, setFiscalYear] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const year = new Date().getFullYear();
  const period = useMemo(() => ({ from: `${year}-01-01`, to: `${year}-12-31` }), [year]);

  useEffect(() => {
    Promise.all([
      getList<{ name: string }>('Company', { fields: ['name'], limit: 1 }),
      getList<{ name: string }>('Fiscal Year', {
        fields: ['name', 'year_start_date', 'year_end_date'],
        orderBy: 'year_start_date desc',
      }),
    ])
      .then(([companies, years]) => {
        setCompany(companies[0]?.name ?? null);
        const today = new Date().toISOString().slice(0, 10);
        const covering = (
          years as unknown as { name: string; year_start_date: string; year_end_date: string }[]
        ).find((y) => y.year_start_date <= today && today <= y.year_end_date);
        setFiscalYear(covering?.name ?? years[0]?.name ?? null);
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && (err.status === 403 || /permission/i.test(err.message))) {
          setDenied(true);
        } else {
          setError(err.message);
        }
      });
  }, []);

  const load = useCallback(async () => {
    if (!company || !fiscalYear) return;
    setView(null);
    setError(null);
    setDenied(false);

    const base = {
      company,
      fiscal_year: fiscalYear,
      from_date: period.from,
      to_date: period.to,
      period_start_date: period.from,
      period_end_date: period.to,
      filter_based_on: 'Date Range',
      periodicity: 'Yearly',
    };

    try {
      if (tab === 'accounts') {
        const rows = await getList<AccountRow>('Account', {
          fields: ['name', 'account_name', 'root_type', 'account_type', 'is_group'],
          filters: { company },
          orderBy: 'lft asc',
        });
        setView({
          columns: [
            { label: 'Account', fieldname: 'name' },
            { label: 'Type', fieldname: 'root_type' },
            { label: 'Account Type', fieldname: 'account_type' },
            { label: 'Group', fieldname: 'is_group' },
          ],
          rows: rows as unknown as ReportRow[],
          total: null,
        });
        return;
      }

      const report = {
        trial_balance: 'Trial Balance',
        general_ledger: 'General Ledger',
        balance_sheet: 'Balance Sheet',
        profit_and_loss: 'Profit and Loss Statement',
      }[tab];

      const extra =
        tab === 'general_ledger'
          ? { group_by: 'Group by Voucher (Consolidated)' }
          : tab === 'trial_balance'
            ? { with_period_closing_entry_for_opening: 0 }
            : {};

      const { columns, rows, total } = await runReport(report, { ...base, ...extra });
      setView({ columns, rows, total });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || /permission/i.test(err.message))) {
        setDenied(true);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load the report');
      }
    }
  }, [company, fiscalYear, tab, period]);

  useEffect(() => {
    void load();
  }, [load]);

  // The account tree indents its first column the way the desk does; every
  // other rule a Frappe report column needs lives in reportColumns.
  const columns = useMemo(
    () => reportColumns(view?.columns ?? [], { indentFirst: true }),
    [view],
  );

  return (
    <div>
      <p className="text-sm text-slate-500">
        The bank&rsquo;s books for {year}, straight from the accounting ledger.
      </p>

      <div className="mt-3">
        <SegmentedControl value={tab} onChange={setTab} options={TABS} />
      </div>

      {denied && (
        <Card className="mt-3 border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">You do not have accounting access.</p>
          <p className="mt-1">
            Viewing the ledger needs an accounts role on your Frappe user — ERPNext ships{' '}
            <span className="font-mono">Accounts User</span> for read access. Ask an administrator to
            grant it.
          </p>
        </Card>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!denied && !error && !view && <p className="mt-3 text-slate-500">Loading…</p>}

      {view && (
        <div className="mt-3">
          <DataTable
            caption={`${TABS.find((t) => t.id === tab)?.label ?? 'Ledger'} for ${year}`}
            columns={columns}
            rows={view.rows}
            rowKey={(_, i) => String(i)}
            total={reportTotal(view.columns, view.total)}
            rowClassName={reportRowClass}
            dense
            minWidth={`${Math.max(48, columns.length * 9)}rem`}
            empty="Nothing posted for this period."
          />
        </div>
      )}
    </div>
  );
}
