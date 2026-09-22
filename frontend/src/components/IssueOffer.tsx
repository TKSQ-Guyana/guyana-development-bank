import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import type { LoanOffer } from '../types';

/** Underwriter-side: issue the Letter of Offer on an approved application.
 *
 *  Hidden once an offer is live, because reissuing over an outstanding offer
 *  is refused server-side anyway — a borrower should never be holding two
 *  different sets of terms for the same application.
 */
export function IssueOffer({
  application,
  onIssued,
}: {
  application: string;
  onIssued?: () => void;
}) {
  const [existing, setExisting] = useState<LoanOffer | null | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('');
  const [validDays, setValidDays] = useState('14');
  const [conditions, setConditions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<LoanOffer | null>('gdb_bank.offers.my_offer', { application })
      .then(setExisting)
      .catch(() => setExisting(null));
  }, [application]);

  useEffect(load, [load]);

  if (existing === undefined) return null;
  // An offer that is live or already executed is not reissuable.
  if (existing && ['Issued', 'Accepted'].includes(existing.status)) return null;

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      await call<LoanOffer>('gdb_bank.offers.issue_offer', {
        application,
        offered_amount: amount ? Number(amount) : undefined,
        term_months: term ? Number(term) : undefined,
        valid_days: validDays ? Number(validDays) : undefined,
        conditions,
      });
      onIssued?.();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue the offer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow">
      <h2 className="mb-1 font-semibold text-slate-800">Issue Letter of Offer</h2>
      <p className="mb-4 text-sm text-slate-500">
        {existing
          ? `The previous offer was ${existing.status.toLowerCase()}. Issuing a new one replaces it.`
          : 'The applicant cannot be booked or funded until they accept an offer.'}
      </p>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Amount (blank = as applied)</span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Term in months (blank = as applied)</span>
          <input
            type="number"
            min={1}
            max={360}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. 12"
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Valid for (days)</span>
          <input
            type="number"
            min={1}
            value={validDays}
            onChange={(e) => setValidDays(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
        </label>
      </div>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-slate-600">
          Additional conditions precedent (one per line — the standard three are always included)
        </span>
        <textarea
          rows={3}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          placeholder="e.g. Quotation for the equipment being financed."
          className="w-full rounded-xl border border-slate-200 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => void issue()}
        className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {busy ? 'Issuing…' : 'Issue offer'}
      </button>
    </div>
  );
}
