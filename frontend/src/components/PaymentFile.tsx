import { useCallback, useEffect, useState } from 'react';
import { ApiError, runReport } from '../api';
import type { ReportColumn } from '../api';
import { formatGyd } from '../utils';

/** The file the bank actually receives.
 *
 *  Rows come from the `GDB Disbursement Payment File` query report — SQL held
 *  in Frappe, not here — so the layout a bank expects is changed by editing
 *  the report, never by editing this component. Nothing is computed on the
 *  client except the CSV serialisation.
 *
 *  A row with no account number is a disbursement with nowhere to send the
 *  money. Those are shown first and excluded from the download: a payment file
 *  containing a beneficiary with no account is rejected by the bank at best,
 *  and misapplied at worst.
 */

const REPORT = 'GDB Disbursement Payment File';

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PaymentFile({ company }: { company: string | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(today);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [bank, setBank] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!company) return;
    setRows(null);
    setError(null);
    setDenied(false);
    try {
      const res = await runReport(REPORT, { company, from_date: from, to_date: to });
      setColumns(res.columns);
      setRows(res.rows);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || /permission|not permitted/i.test(err.message))) {
        setDenied(true);
      } else {
        setError(err instanceof Error ? err.message : 'Could not build the payment file');
      }
    }
  }, [company, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = rows ?? [];
  const payable = all.filter((r) => r.account_number);
  const blocked = all.filter((r) => !r.account_number);
  const banks = [...new Set(payable.map((r) => String(r.bank)))].sort();
  const selected = bank ? payable.filter((r) => r.bank === bank) : payable;
  const total = selected.reduce((t, r) => t + Number(r.amount ?? 0), 0);

  const exportCsv = () => {
    const head = columns.map((c) => csvEscape(c.label)).join(',');
    const body = selected
      .map((r) => columns.map((c) => csvEscape(r[c.fieldname])).join(','))
      .join('\n');
    const tag = (bank || 'all-banks').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    download(`gdb-payment-file-${tag}-${to}.csv`, `${head}\n${body}`);
  };

  if (denied) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">You do not have access to the payment file.</p>
        <p className="mt-1">
          It exposes citizens&rsquo; bank account numbers, so it is restricted to accounting roles.
          Ask an administrator to add your role to the{' '}
          <span className="font-mono">{REPORT}</span> report.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Bank</span>
          <select
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2"
          >
            <option value="">All banks</option>
            {banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportCsv}
          disabled={selected.length === 0}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          Download CSV ({selected.length})
        </button>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!error && !rows && <p className="text-slate-500">Building payment file…</p>}

      {rows && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 sm:max-w-md">
            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs uppercase tracking-wide text-slate-500">To pay</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{formatGyd(total)}</p>
              <p className="text-xs text-slate-500">
                {selected.length} payment{selected.length === 1 ? '' : 's'}
                {bank ? ` · ${bank}` : ''}
              </p>
            </div>
            <div
              className={`rounded-xl p-4 shadow ${blocked.length ? 'bg-red-50' : 'bg-white'}`}
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">Cannot pay</p>
              <p
                className={`mt-1 text-2xl font-bold ${blocked.length ? 'text-red-700' : 'text-slate-800'}`}
              >
                {blocked.length}
              </p>
              <p className="text-xs text-slate-500">no account on file</p>
            </div>
          </div>

          {blocked.length > 0 && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="mb-2 text-sm font-semibold text-red-800">
                Excluded from the file — these citizens have not given bank details
              </p>
              <ul className="space-y-1 text-sm text-red-900">
                {blocked.map((r, i) => (
                  <li key={i}>
                    {String(r.loan)} · {String(r.disbursement)} ·{' '}
                    <strong>{formatGyd(Number(r.amount ?? 0))}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selected.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
              Nothing to pay for this period.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl bg-white shadow">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.fieldname}
                        className={`px-4 py-3 ${c.fieldtype === 'Currency' ? 'text-right' : ''}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {columns.map((c) => (
                        <td
                          key={c.fieldname}
                          className={`px-4 py-2 ${
                            c.fieldtype === 'Currency'
                              ? 'text-right font-semibold tabular-nums text-slate-800'
                              : 'text-slate-600'
                          }`}
                        >
                          {c.fieldtype === 'Currency'
                            ? formatGyd(Number(r[c.fieldname] ?? 0))
                            : String(r[c.fieldname] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
