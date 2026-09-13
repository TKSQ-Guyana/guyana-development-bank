import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call } from '../api';
import type { LoanAccount as LoanAccountType } from '../types';
import { formatGyd } from '../utils';

/** Booking and disbursement — the bank's side of an approved application.
 *
 *  Underwriters only, and the server decides that independently of this
 *  component. Both actions are lending's own (`create_loan`, then a Loan
 *  Disbursement): the only figure this offers is what is still undrawn, and
 *  even that is a default lending is free to refuse. */
export function Disbursement({
  application,
  onChange,
}: {
  application: string;
  onChange: () => void;
}) {
  const [account, setAccount] = useState<LoanAccountType | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const apply = useCallback((a: LoanAccountType) => {
    setAccount(a);
    // The server tells us what is drawable; the client never works it out.
    const drawable = a.disbursable ?? 0;
    if (drawable > 0) setAmount(String(Math.round(drawable)));
  }, []);

  useEffect(() => {
    call<LoanAccountType>('gdb_bank.api.loan_account', { application })
      .then(apply)
      .catch((err: Error) => setError(err.message));
  }, [application, apply]);

  const run = async (method: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      apply(await call<LoanAccountType>(method, { application, ...args }));
      setNote(done);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (!account) return null;

  const loan = account.loan;
  const drawable = account.disbursable ?? 0;
  const disbursable =
    !!loan && drawable > 0 && (loan.status === 'Sanctioned' || loan.status === 'Partially Disbursed');

  const disburse = (e: FormEvent) => {
    e.preventDefault();
    void run('gdb_bank.api.disburse_loan', { amount: Number(amount) }, 'Disbursement recorded.');
  };

  return (
    <div className="mt-4 rounded-xl border border-gdb-gold/60 bg-white p-6 shadow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Booking &amp; disbursement</h2>
        {loan && (
          <span className="font-mono text-xs text-slate-500">
            {loan.name} · {loan.status}
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {note && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{note}</p>}

      {!loan && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            Approved, but no loan account exists yet. Booking creates the loan and its terms.
          </p>
          <button
            disabled={busy}
            onClick={() => void run('gdb_bank.api.book_loan', {}, 'Loan booked.')}
            className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
          >
            Book loan
          </button>
        </>
      )}

      {disbursable && (
        <form onSubmit={disburse}>
          <p className="mb-3 text-sm text-slate-600">
            {formatGyd(drawable)} of {formatGyd(loan.loan_amount)} is available to disburse.
            Disbursing generates the repayment schedule.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Amount (GYD)</span>
              <input
                type="number"
                min="1"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
            >
              Disburse
            </button>
          </div>
        </form>
      )}

      {loan && !disbursable && (
        <p className="text-sm text-slate-600">
          {formatGyd(loan.disbursed_amount)} disbursed. Nothing further is awaiting release.
        </p>
      )}
    </div>
  );
}
