import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getList, runReport } from '../../api';
import type { ReportColumn } from '../../api';
import { formatGyd } from '../../utils';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';

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

const CURRENCY_TYPES = new Set(['Currency', 'Float']);

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
  rows: Record<string, unknown>[];
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
          rows: rows as unknown as Record<string, unknown>[],
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

      const { columns, rows } = await runReport(report, { ...base, ...extra });
      setView({ columns, rows });
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

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Finance</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Ledger</h1>
      <p className="mt-2 text-sm text-slate-500">The bank&rsquo;s books for {year}, straight from the accounting ledger.</p>

      <div className="mt-6">
        <SegmentedControl value={tab} onChange={setTab} options={TABS} />
      </div>

      {denied && (
        <Card className="mt-6 border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">You do not have accounting access.</p>
          <p className="mt-1">
            Viewing the ledger needs an accounts role on your Frappe user — ERPNext ships{' '}
            <span className="font-mono">Accounts User</span> for read access. Ask an administrator to
            grant it.
          </p>
        </Card>
      )}
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!denied && !error && !view && <p className="mt-4 text-slate-500">Loading…</p>}
      {view && view.rows.length === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Nothing posted for this period.
        </p>
      )}

      {view && view.rows.length > 0 && (
        <Card className="mt-4 overflow-x-auto p-0">
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
                  {view.columns.map((c, j) => (
                    <Cell key={c.fieldname} column={c} row={row} first={j === 0} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Cell({
  column,
  row,
  first,
}: {
  column: ReportColumn;
  row: Record<string, unknown>;
  first: boolean;
}) {
  const value = row[column.fieldname];
  const isMoney = CURRENCY_TYPES.has(column.fieldtype ?? '');
  const indent = first ? Number(row.indent ?? 0) : 0;
  const bold = Boolean(row.is_group) || /total/i.test(String(row[column.fieldname] ?? ''));

  let text: string;
  if (value === null || value === undefined || value === '') text = first ? '' : '—';
  else if (isMoney) text = formatGyd(Number(value));
  else if (typeof value === 'number' && column.fieldname === 'is_group') text = value ? 'Group' : 'Ledger';
  else text = String(value);

  return (
    <td
      className={`px-5 py-2 ${isMoney ? 'text-right tabular-nums' : ''} ${bold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}
      style={indent ? { paddingLeft: `${1 + indent * 1.25}rem` } : undefined}
    >
      {text}
    </td>
  );
}
