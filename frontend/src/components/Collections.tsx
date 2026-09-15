import { useState } from 'react';
import { call } from '../api';
import { formatGyd } from '../utils';

/** Collections — repayments arriving from a bank rather than the portal.
 *
 *  Treasury pastes or uploads the file the bank sent, previews what it would
 *  do, and only then posts. Money never moves on a file nobody has looked at,
 *  and a row that cannot be matched is held back for a human rather than
 *  guessed at — a payment applied to the wrong loan is far worse than one that
 *  waits.
 *
 *  The CSV shape is the same one the outbound payment file uses in reverse:
 *  a reference that identifies the loan, an amount, and the bank's value date.
 */

interface Row {
  reference: string;
  amount: number;
  value_date: string;
  loan: string | null;
  borrower: string | null;
  repayment_type: string | null;
  outstanding: number | null;
  problem: string | null;
  repayment?: string;
}

interface Preview {
  rows: Row[];
  postable: number;
  rejected: number;
  total_amount: number;
}

const SAMPLE = `reference,amount,value_date
ACC-LOAN-2026-00017,36112,2026-10-13
ACC-LOAN-2026-00016,25000,2026-10-13`;

/** Minimal CSV read: header row naming the columns, then one row per payment.
 *  Deliberately forgiving about column order and case — every bank lays its
 *  file out differently and that is not the borrower's problem. */
function parseCsv(text: string): { reference: string; amount: number; value_date?: string }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iRef = head.findIndex((h) => /ref|loan|account/.test(h));
  const iAmt = head.findIndex((h) => /amount|credit|value/.test(h) && !/date/.test(h));
  const iDate = head.findIndex((h) => /date/.test(h));
  if (iRef < 0 || iAmt < 0) return [];
  return lines.slice(1).map((l) => {
    const c = l.split(',').map((x) => x.trim());
    return {
      reference: c[iRef] ?? '',
      amount: Number((c[iAmt] ?? '').replace(/[^0-9.-]/g, '')) || 0,
      value_date: iDate >= 0 ? c[iDate] : undefined,
    };
  });
}

export function Collections({ onPosted }: { onPosted?: () => void }) {
  const [text, setText] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ posted: Row[]; skipped: Row[]; total_posted: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = parseCsv(text);

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await call<Preview>('gdb_bank.collections.preview_collections', { rows }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file');
    } finally {
      setBusy(false);
    }
  };

  const doPost = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ posted: Row[]; skipped: Row[]; total_posted: number }>(
        'gdb_bank.collections.post_collections',
        { rows, bank_reference: bankRef },
      );
      setResult(res);
      setPreview(null);
      onPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the file');
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setPreview(null);
      setResult(null);
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Repayments collected by a bank — standing orders, direct debits, over-the-counter. Preview
        first; nothing is posted until you say so.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Collections file (CSV)</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
            className="text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Bank&rsquo;s file reference</span>
          <input
            value={bankRef}
            onChange={(e) => setBankRef(e.target.value)}
            placeholder="e.g. DEM-COLL-2026-09-13"
            className="w-56 rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
      </div>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-slate-600">
          …or paste it here ({rows.length} row{rows.length === 1 ? '' : 's'} read)
        </span>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setResult(null);
          }}
          placeholder={SAMPLE}
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
        />
      </label>

      <div className="mb-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || rows.length === 0}
          onClick={() => void doPreview()}
          className="rounded-md border border-gdb-green px-4 py-2 text-sm font-semibold text-gdb-green hover:bg-gdb-green/5 disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Preview'}
        </button>
        <button
          type="button"
          disabled={busy || !preview || preview.postable === 0}
          onClick={() => void doPost()}
          className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-50"
        >
          Post {preview ? `${preview.postable} payment${preview.postable === 1 ? '' : 's'}` : ''}
        </button>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {preview && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:max-w-md">
            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs uppercase tracking-wide text-slate-500">Will post</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">
                {formatGyd(preview.total_amount)}
              </p>
              <p className="text-xs text-slate-500">{preview.postable} payments</p>
            </div>
            <div className={`rounded-xl p-4 shadow ${preview.rejected ? 'bg-red-50' : 'bg-white'}`}>
              <p className="text-xs uppercase tracking-wide text-slate-500">Held back</p>
              <p
                className={`mt-1 text-2xl font-bold ${preview.rejected ? 'text-red-700' : 'text-slate-800'}`}
              >
                {preview.rejected}
              </p>
              <p className="text-xs text-slate-500">need a human</p>
            </div>
          </div>
          <RowTable rows={preview.rows} />
        </>
      )}

      {result && (
        <>
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Posted {result.posted.length} payment{result.posted.length === 1 ? '' : 's'} totalling{' '}
            <strong>{formatGyd(result.total_posted)}</strong>.
            {result.skipped.length > 0 && ` ${result.skipped.length} held back.`}
          </p>
          <RowTable rows={[...result.posted, ...result.skipped]} />
        </>
      )}
    </div>
  );
}

function RowTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Reference</th>
            <th className="px-4 py-3">Borrower</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3">Value date</th>
            <th className="px-4 py-3">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className={r.problem ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.reference}</td>
              <td className="px-4 py-2 text-slate-600">{r.borrower ?? '—'}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">
                {formatGyd(r.amount)}
              </td>
              <td className="px-4 py-2 text-slate-500">{r.value_date}</td>
              <td className="px-4 py-2">
                {r.problem ? (
                  <span className="text-red-700">{r.problem}</span>
                ) : r.repayment ? (
                  <span className="text-green-800">
                    Posted · {r.repayment} · {r.repayment_type}
                  </span>
                ) : (
                  <span className="text-slate-600">
                    {r.repayment_type} → {r.loan}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
