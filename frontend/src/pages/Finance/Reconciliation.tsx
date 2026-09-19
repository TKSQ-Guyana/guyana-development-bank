import { useCallback, useEffect, useState } from 'react';
import { ApiError, applyReceipt, suggestLoans, unreconciledReceipts } from '../../api';
import type { BankReceipt, ReceiptCandidate } from '../../types';
import { formatGyd, formatDate } from '../../utils';
import { Card, CardLabel } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Collections } from '../../components/Collections';

/** Money in, matched to the loan it belongs to.
 *
 *  Every figure here is a stock Bank Transaction; the matching runs through
 *  gdb_bank.collections, which already does the ranking and the posting.
 *  Nothing here guesses — a receipt only moves when Finance picks a loan.
 */
export function Reconciliation() {
  const [tab, setTab] = useState<'transactions' | 'upload'>('transactions');
  const [receipts, setReceipts] = useState<BankReceipt[]>([]);
  const [totalUnapplied, setTotalUnapplied] = useState(0);
  const [selected, setSelected] = useState<BankReceipt | null>(null);
  const [candidates, setCandidates] = useState<ReceiptCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setDenied(false);
    unreconciledReceipts()
      .then(({ receipts, total_unapplied }) => {
        setReceipts(receipts);
        setTotalUnapplied(total_unapplied);
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && (err.status === 403 || /permission/i.test(err.message))) {
          setDenied(true);
        } else {
          setError(err.message);
        }
      });
  }, []);

  useEffect(load, [load]);

  const openReceipt = (receipt: BankReceipt) => {
    setSelected(receipt);
    setCandidates(null);
    suggestLoans(receipt.name)
      .then(({ candidates }) => setCandidates(candidates))
      .catch((err: Error) => setError(err.message));
  };

  const apply = async (loan: string) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await applyReceipt(selected.name, loan);
      setSelected(null);
      setCandidates(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply this receipt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Finance</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Reconciliation</h1>
      <p className="mt-2 text-sm text-slate-500">
        What has come in from the banks, matched to the loan it belongs to.
      </p>

      {denied && (
        <Card className="mt-6 border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">You do not have Finance access.</p>
          <p className="mt-1">Reconciling receipts needs the Finance Officer role. Ask an administrator to grant it.</p>
        </Card>
      )}
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {!denied && (
        <div className="mt-6">
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { id: 'transactions', label: 'Bank Transactions' },
              { id: 'upload', label: 'CSV Upload' },
            ]}
          />
        </div>
      )}

      {!denied && tab === 'upload' && (
        <Card className="mt-6">
          <Collections onPosted={load} />
        </Card>
      )}

      {!denied && tab === 'transactions' && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 sm:max-w-md">
          <Card>
            <CardLabel>Unapplied receipts</CardLabel>
            <p className="mt-1 text-2xl font-bold text-slate-800">{receipts.length}</p>
          </Card>
          <Card>
            <CardLabel>Total unapplied</CardLabel>
            <p className="mt-1 text-2xl font-bold text-slate-800">{formatGyd(totalUnapplied)}</p>
          </Card>
        </div>
      )}

      {!denied && tab === 'transactions' && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card className="p-0">
            {receipts.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">Nothing waiting to be matched.</p>
            ) : (
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Reference</th>
                    <th className="px-5 py-3 text-right">Unapplied</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receipts.map((r) => (
                    <tr
                      key={r.name}
                      className={selected?.name === r.name ? 'bg-brand-light/40' : 'hover:bg-slate-50'}
                    >
                      <td className="px-5 py-3 text-slate-600">{formatDate(r.date)}</td>
                      <td className="px-5 py-3">
                        <p className="text-slate-700">{r.reference_number || r.description || '—'}</p>
                        <p className="text-xs text-slate-400">{r.name}</p>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-800">
                        {formatGyd(r.unallocated_amount)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="secondary" onClick={() => openReceipt(r)}>
                          Match
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            {!selected && (
              <p className="text-sm text-slate-500">Pick a receipt to see which loans it might belong to.</p>
            )}
            {selected && (
              <>
                <CardLabel>Candidates for {selected.name}</CardLabel>
                <p className="mt-1 text-lg font-semibold text-slate-800">
                  {formatGyd(selected.unallocated_amount)}
                </p>
                {candidates === null && <p className="mt-4 text-sm text-slate-500">Ranking loans…</p>}
                {candidates?.length === 0 && (
                  <p className="mt-4 text-sm text-slate-500">No open loan looks like a match.</p>
                )}
                <div className="mt-4 space-y-3">
                  {candidates?.map((c) => (
                    <div key={c.loan} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-800">{c.borrower ?? c.loan}</p>
                          <p className="text-xs text-slate-400">
                            {c.loan} · outstanding {formatGyd(c.outstanding)}
                          </p>
                        </div>
                        <Button disabled={busy} onClick={() => void apply(c.loan)}>
                          Apply
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.why.map((reason) => (
                          <Badge key={reason} tone="brand">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
