import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call } from '../api';
import { useAuth } from '../auth';
import type { LoanAccount as LoanAccountType } from '../types';
import { formatGyd } from '../utils';

/** Booking and disbursement — the bank's side of an approved application.
 *
 *  TWO OFFICERS, ONE PANEL. Booking belongs to the underwriter and release to
 *  the finance officer, so each sees their own half and is told who owns the
 *  other. The server decides both independently of this component, and refuses
 *  release outright to the person who approved the case.
 *
 *  Both actions are lending's own (`create_loan`, then a Loan Disbursement):
 *  the only figure this offers is what is still undrawn, and even that is a
 *  default lending is free to refuse. */
export function Disbursement({
  application,
  onChange,
}: {
  application: string;
  onChange: () => void;
}) {
  const { user } = useAuth();
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
  const awaitingRelease =
    !!loan && drawable > 0 && (loan.status === 'Sanctioned' || loan.status === 'Partially Disbursed');
  const mayBook = Boolean(user?.is_underwriter);
  // Release authority is is_disbursement, split out from is_finance (books
  // only) — see api.DISBURSEMENT_ROLES. A pure Finance Officer should read
  // this exactly like the underwriter does: told who releases, not offered
  // the form.
  const mayRelease = Boolean(user?.is_disbursement);

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

      {!loan && mayBook && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            Approved, but no loan account exists yet. Booking creates the loan and its terms.
          </p>
          <button
            disabled={busy}
            onClick={() => void run('gdb_bank.api.book_loan', {}, 'Loan booked.')}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Book loan
          </button>
        </>
      )}

      {!loan && !mayBook && (
        <p className="text-sm text-slate-600">
          Approved, but no loan account exists yet. An underwriter books the loan before funds
          can be released.
        </p>
      )}

      {awaitingRelease && !mayRelease && (
        <p className="text-sm text-slate-600">
          {formatGyd(drawable)} is awaiting release. Funds are released by the disbursement officer,
          who must be someone other than the officer who approved this application.
        </p>
      )}

      {awaitingRelease && mayRelease && (
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
                className="w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              Disburse
            </button>
          </div>
        </form>
      )}

      {loan && !awaitingRelease && (
        <p className="text-sm text-slate-600">
          {formatGyd(loan.disbursed_amount)} disbursed. Nothing further is awaiting release.
        </p>
      )}
    </div>
  );
}
