import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { Card } from '../components/ui/Card';
import { ArrowRightIcon } from '../components/ui/icons';
import type { LoanAccount, LoanApplication } from '../types';
import { formatDate, formatGyd } from '../utils';

const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

/** Statement of account for a period.
 *
 *  Every figure is the loan ledger's: the schedule lending generated and the
 *  dues it reports. Two things are deliberately kept apart on the page —
 *  instalments SCHEDULED in the period, and what has actually been PAID to
 *  date — because conflating a plan with a receipt is how a statement stops
 *  being a statement. */
export function Statements() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [account, setAccount] = useState<LoanAccount | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  const facilities = useMemo(
    () => (loans ?? []).filter((l) => l.stage === 'Disbursed' || l.disbursed_amount > 0),
    [loans],
  );
  const active = selected ?? facilities[0]?.name ?? null;

  useEffect(() => {
    if (!active) {
      setAccount(null);
      return;
    }
    call<LoanAccount>('gdb_bank.api.loan_account', { application: active })
      .then(setAccount)
      .catch((err: Error) => setError(err.message));
  }, [active]);

  const period = useMemo(() => {
    const schedule = account?.schedule ?? [];
    const inPeriod = schedule.filter((r) => r.payment_date >= from && r.payment_date <= to);
    const firstIndex = schedule.findIndex((r) => r.payment_date >= from);
    // The balance carried into the period is the one left by the instalment
    // before it — or the whole facility, if the period starts before the first.
    const opening =
      firstIndex > 0
        ? schedule[firstIndex - 1].balance_loan_amount
        : (account?.loan?.disbursed_amount ?? 0);
    const closing = inPeriod.length
      ? inPeriod[inPeriod.length - 1].balance_loan_amount
      : opening;
    const due = inPeriod.reduce((sum, r) => sum + r.total_payment, 0);
    return { rows: inPeriod, opening, closing, due };
  }, [account, from, to]);

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Statements</h2>
          <p className="mt-1 text-sm text-slate-500">
            A statement of account for any period, generated from the loan ledger.
          </p>
        </div>
        {account?.loan && (
          <button
            onClick={() => window.print()}
            className="rounded-full bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200"
          >
            Print or save as PDF
          </button>
        )}
      </div>

      {!loans ? (
        <Card className="animate-pulse">
          <div className="h-4 w-40 rounded bg-slate-100" />
        </Card>
      ) : facilities.length === 0 ? (
        <Card className="border border-dashed border-slate-200 py-12 text-center">
          <p className="text-base font-semibold text-slate-700">No facility to report on</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Statements cover a released facility. Once funds are disbursed, you can request a
            statement for any period here.
          </p>
          <Link
            to="/apply"
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            See my applications
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Card>
      ) : (
        <>
          <Card className="print:hidden">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1.5 block font-medium text-slate-600">Facility</span>
                <select
                  value={active ?? ''}
                  onChange={(e) => setSelected(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  {facilities.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name} — {formatGyd(f.loan_amount)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block font-medium text-slate-600">From</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block font-medium text-slate-600">To</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
            </div>
          </Card>

          {account?.loan && (
            <Card className="p-8 lg:p-10">
              {/* Formal document treatment: this is the instrument a borrower
                  takes to another institution, not a dashboard panel. */}
              <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-5">
                <div>
                  <p className="text-lg font-bold text-slate-900">Guyana Development Bank</p>
                  <p className="text-sm text-slate-500">Statement of account</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-mono font-semibold text-slate-800">{account.loan.name}</p>
                  <p className="text-slate-500">
                    {formatDate(from)} — {formatDate(to)}
                  </p>
                  <p className="text-xs text-slate-400">Generated {formatDate(today())}</p>
                </div>
              </header>

              <dl className="grid gap-x-8 gap-y-3 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Borrower</dt>
                  <dd className="font-medium text-slate-800">{user?.full_name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">e-ID</dt>
                  <dd className="font-mono text-slate-800">{user?.eid ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Facility amount</dt>
                  <dd className="font-medium tabular-nums text-slate-800">
                    {formatGyd(account.loan.loan_amount)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Interest rate</dt>
                  <dd className="font-medium text-slate-800">0% — interest free</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Term</dt>
                  <dd className="font-medium text-slate-800">
                    {account.loan.repayment_periods} months
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-medium text-slate-800">{account.loan.status}</dd>
                </div>
              </dl>

              <div className="grid gap-4 border-b border-slate-200 py-5 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Opening balance
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                    {formatGyd(period.opening)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Instalments scheduled
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                    {formatGyd(period.due)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Closing balance
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                    {formatGyd(period.closing)}
                  </p>
                </div>
              </div>

              <div className="py-5">
                <p className="mb-3 text-sm font-bold text-slate-800">
                  Instalments falling due in this period
                </p>
                {period.rows.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    No instalment falls due between {formatDate(from)} and {formatDate(to)}.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 font-semibold">Due date</th>
                        <th className="py-2 text-right font-semibold">Principal</th>
                        <th className="py-2 text-right font-semibold">Interest</th>
                        <th className="py-2 text-right font-semibold">Instalment</th>
                        <th className="py-2 text-right font-semibold">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {period.rows.map((r) => (
                        <tr key={r.payment_date} className="border-b border-slate-100 last:border-0">
                          <td className="py-2.5 text-slate-600">{formatDate(r.payment_date)}</td>
                          <td className="py-2.5 text-right tabular-nums text-slate-600">
                            {formatGyd(r.principal_amount)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-slate-600">
                            {formatGyd(r.interest_amount)}
                          </td>
                          <td className="py-2.5 text-right font-semibold tabular-nums text-slate-900">
                            {formatGyd(r.total_payment)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-slate-600">
                            {formatGyd(r.balance_loan_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Position as at today, kept visually apart from the period
                  above: these are current ledger facts, not period movements. */}
              <div className="border-t border-slate-200 pt-5">
                <p className="mb-3 text-sm font-bold text-slate-800">
                  Position as at {formatDate(today())}
                </p>
                <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Total received to date</dt>
                    <dd className="font-medium tabular-nums text-slate-800">
                      {formatGyd(account.loan.total_amount_paid)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Principal outstanding</dt>
                    <dd className="font-medium tabular-nums text-slate-800">
                      {formatGyd(account.dues?.principal_outstanding ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Amount overdue</dt>
                    <dd
                      className={`font-medium tabular-nums ${
                        account.dues?.overdue_total_amount ? 'text-rose-600' : 'text-slate-800'
                      }`}
                    >
                      {formatGyd(account.dues?.overdue_total_amount ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Oldest amount due since</dt>
                    <dd className="font-medium text-slate-800">
                      {account.dues?.oldest_due_date ? formatDate(account.dues.oldest_due_date) : '—'}
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-400">
                Balances are derived from the loan ledger at the time this statement was generated.
                Instalments listed above are amounts falling due; amounts received are shown in the
                position as at today.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
