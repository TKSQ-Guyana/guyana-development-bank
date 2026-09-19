import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call } from '../api';
import { Card, CardLabel } from './ui/Card';
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
  className = 'mt-4',
}: {
  application: string;
  canPay?: boolean;
  className?: string;
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
  const overdue = dues.overdue_total_amount ?? 0;

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
    <Card className={className}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <CardLabel>Loan account</CardLabel>
          <p className="mt-1 font-mono text-sm text-slate-500">
            {loan.name} · {loan.status}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          0% interest
        </span>
      </div>

      <dl className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Disbursed', value: formatGyd(loan.disbursed_amount) },
          { label: 'Instalment', value: formatGyd(loan.monthly_repayment_amount) },
          { label: 'Paid so far', value: formatGyd(loan.total_amount_paid) },
          {
            label: 'Principal outstanding',
            value:
              dues.principal_outstanding !== undefined ? formatGyd(dues.principal_outstanding) : '—',
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-slate-50/80 px-3 py-2.5">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {stat.label}
            </dt>
            <dd className="mt-0.5 font-bold tabular-nums text-slate-800">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div
        className={`mb-5 rounded-xl px-4 py-3 text-sm ${
          overdue ? 'bg-rose-50/70' : 'bg-slate-50/80'
        }`}
      >
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Due now — reported by the lending ledger
        </p>
        <p className={overdue ? 'text-rose-700' : 'text-slate-800'}>
          <span className="text-lg font-bold tabular-nums">{formatGyd(overdue)}</span>
          {dues.oldest_due_date ? (
            <span className="ml-2 text-slate-600">oldest due {formatDate(dues.oldest_due_date)}</span>
          ) : (
            <span className="ml-2 text-slate-600">nothing overdue</span>
          )}
        </p>
        {Boolean(
          dues.overdue_principal_amount || dues.overdue_interest_amount || dues.overdue_charges,
        ) && (
          <p className="mt-1 text-xs text-slate-500">
            principal {formatGyd(dues.overdue_principal_amount ?? 0)} · interest{' '}
            {formatGyd(dues.overdue_interest_amount ?? 0)} · charges{' '}
            {formatGyd(dues.overdue_charges ?? 0)}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-2 font-semibold">Due</th>
              <th className="py-2 text-right font-semibold">Instalment</th>
              <th className="py-2 text-right font-semibold">Principal</th>
              <th className="py-2 text-right font-semibold">Interest</th>
              <th className="py-2 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.payment_date} className="border-b border-slate-50 last:border-0">
                <td className="py-2.5 text-slate-600">{formatDate(r.payment_date)}</td>
                <td className="py-2.5 text-right font-semibold tabular-nums text-slate-800">
                  {formatGyd(r.total_payment)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-slate-500">
                  {formatGyd(r.principal_amount)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-slate-500">
                  {formatGyd(r.interest_amount)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-slate-500">
                  {formatGyd(r.balance_loan_amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {account.schedule.length > 6 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-semibold text-brand hover:underline"
        >
          {showAll ? 'Show fewer instalments' : `Show all ${account.schedule.length} instalments`}
        </button>
      )}

      {!canPay && (
        <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-500">
          Payments are recorded by the borrower. Money received at the Bank is applied from
          Collections, against the bank statement it arrived on.
        </p>
      )}

      {canPay && (
        <form onSubmit={(e) => void pay(e)} className="mt-5 border-t border-slate-100 pt-5">
          <p className="mb-3 text-sm font-bold text-slate-800">Make a payment</p>
          {error && (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          {paid && (
            <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{paid}</p>
          )}
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
                className="w-40 rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {busy ? 'Recording…' : 'Pay'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
