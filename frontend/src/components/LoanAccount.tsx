import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call } from '../api';
import type { LoanAccount as LoanAccountType } from '../types';
import { formatGyd, formatDate } from '../utils';

/** Repayment schedule and payments for a booked loan. Shown to the borrower
 *  and, for a cluster facility, to every member of the cluster.
 *
 *  Every figure here comes from frappe/lending — the schedule rows it
 *  generated and the dues it reports. The portal computes nothing.
 *
 *  `canPay` is false for GDB staff. They may read the account — an underwriter
 *  reviewing a case needs to — but the payment box is the borrower's, and a
 *  bank officer recording money that arrived uses Collections, which starts
 *  from a Bank Transaction rather than from a form. The server refuses either
 *  way (api._may_repay); this keeps the button from being there to press. */
export function LoanAccount({
  application,
  canPay = true,
}: {
  application: string;
  canPay?: boolean;
}) {
  const [account, setAccount] = useState<LoanAccountType | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const apply = useCallback((a: LoanAccountType) => {
    setAccount(a);
    // `||`, not `??`: nothing overdue comes back as 0, not null, and a citizen
    // paying on time is the normal case — falling through to the instalment is
    // what makes the box usable before the first demand is raised. The backend
    // posts that as an Advance Payment.
    const due = a?.dues?.overdue_total_amount || a?.loan?.monthly_repayment_amount;
    if (due) setAmount(String(Math.round(due)));
  }, []);

  const load = useCallback(() => {
    call<LoanAccountType>('gdb_bank.api.loan_account', { application })
      .then(apply)
      .catch((err: Error) => setError(err.message));
  }, [application, apply]);

  useEffect(load, [load]);

  if (error && !account) return null;
  if (!account?.loan) return null;

  const loan = account.loan;
  const dues = account.dues ?? {};
  const rows = showAll ? account.schedule : account.schedule.slice(0, 6);

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPaid(null);
    try {
      const updated = await call<LoanAccountType>('gdb_bank.api.make_repayment', {
        application,
        amount: Number(amount),
      });
      apply(updated);
      setPaid(`Payment of ${formatGyd(Number(amount))} recorded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment could not be recorded');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Loan account</h2>
        <span className="font-mono text-xs text-slate-500">
          {loan.name} · {loan.status}
        </span>
      </div>

      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Disbursed</dt>
          <dd className="font-semibold text-slate-800">{formatGyd(loan.disbursed_amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Instalment</dt>
          <dd className="font-semibold text-slate-800">{formatGyd(loan.monthly_repayment_amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Paid so far</dt>
          <dd className="font-semibold text-slate-800">{formatGyd(loan.total_amount_paid)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Principal outstanding</dt>
          <dd className="font-semibold text-slate-800">
            {dues.principal_outstanding !== undefined ? formatGyd(dues.principal_outstanding) : '—'}
          </dd>
        </div>
      </dl>

      <div className="mb-5 rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
          Due now — reported by the lending ledger
        </p>
        <p className="text-slate-800">
          <span className="font-semibold">{formatGyd(dues.overdue_total_amount ?? 0)}</span>
          {dues.oldest_due_date ? (
            <span className="text-slate-600"> · oldest due {formatDate(dues.oldest_due_date)}</span>
          ) : (
            <span className="text-slate-600"> · nothing overdue</span>
          )}
        </p>
        {Boolean(
          dues.overdue_principal_amount || dues.overdue_interest_amount || dues.overdue_charges,
        ) && (
          <p className="mt-1 text-xs text-slate-500">
            principal {formatGyd(dues.overdue_principal_amount ?? 0)} · interest{' '}
            {formatGyd(dues.overdue_interest_amount ?? 0)} · charges {formatGyd(dues.overdue_charges ?? 0)}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Due</th>
              <th className="py-2 text-right font-medium">Instalment</th>
              <th className="py-2 text-right font-medium">Principal</th>
              <th className="py-2 text-right font-medium">Interest</th>
              <th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.payment_date} className="border-b border-slate-100 last:border-0">
                <td className="py-2">{formatDate(r.payment_date)}</td>
                <td className="py-2 text-right font-medium">{formatGyd(r.total_payment)}</td>
                <td className="py-2 text-right text-slate-600">{formatGyd(r.principal_amount)}</td>
                <td className="py-2 text-right text-slate-600">{formatGyd(r.interest_amount)}</td>
                <td className="py-2 text-right text-slate-600">{formatGyd(r.balance_loan_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {account.schedule.length > 6 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium text-gdb-green hover:underline"
        >
          {showAll ? 'Show fewer instalments' : `Show all ${account.schedule.length} instalments`}
        </button>
      )}

      {!canPay && (
        <p className="mt-5 border-t border-slate-200 pt-4 text-sm text-slate-500">
          Payments are recorded by the borrower. Money received at the Bank is applied from
          Collections, against the bank statement it arrived on.
        </p>
      )}

      {canPay && (
      <form onSubmit={(e) => void pay(e)} className="mt-5 border-t border-slate-200 pt-4">
        <p className="mb-3 text-sm font-medium text-slate-700">Make a payment</p>
        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {paid && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{paid}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Amount (GYD)
            <input
              type="number"
              min={1}
              step="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40 rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
          >
            {busy ? 'Recording…' : 'Pay'}
          </button>
        </div>
      </form>
      )}
    </div>
  );
}
