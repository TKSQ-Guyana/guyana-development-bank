import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { LoanAccount } from '../components/LoanAccount';
import { Card } from '../components/ui/Card';
import { ArrowRightIcon } from '../components/ui/icons';
import type { LoanApplication } from '../types';
import { formatGyd } from '../utils';

/** Loan servicing. A facility exists once money has actually been released, so
 *  this page keys off the disbursed stage rather than off approval — an
 *  approved case with nothing drawn has nothing to repay. */
export function Payments() {
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Payments</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your repayment schedule and what is due, straight from the loan ledger. GDB lends at zero
          interest — every instalment is principal.
        </p>
      </div>

      {!loans ? (
        <Card className="animate-pulse">
          <div className="h-4 w-40 rounded bg-slate-100" />
          <div className="mt-4 h-2 w-full rounded bg-slate-100" />
        </Card>
      ) : facilities.length === 0 ? (
        <Card className="border border-dashed border-slate-200 py-12 text-center">
          <p className="text-base font-semibold text-slate-700">Nothing to repay yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            A repayment schedule is created when GDB releases funds. Until then there is no balance
            and no instalment due.
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
          {/* Only worth a chooser when there is more than one facility. */}
          {facilities.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {facilities.map((f) => (
                <button
                  key={f.name}
                  onClick={() => setSelected(f.name)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    active === f.name
                      ? 'border-brand bg-white shadow-sm shadow-brand/20'
                      : 'border-slate-200 bg-white/60 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-xs font-medium text-slate-400">{f.name}</span>
                  <span className="block font-bold text-slate-800">{formatGyd(f.loan_amount)}</span>
                  <span className="block truncate text-xs text-slate-500">{f.purpose}</span>
                </button>
              ))}
            </div>
          )}

          {active && <LoanAccount key={active} application={active} className="" />}

          <Card className="bg-white/70">
            <p className="text-sm font-bold text-slate-800">How your payments are applied</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              Payments are allocated by the loan ledger against the oldest amount due first. A
              payment made before an instalment falls due is held as an advance and applied on the
              due date. For a complete history of what was received and how it was allocated,
              request a statement.
            </p>
            <Link
              to="/statements"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
            >
              Go to statements
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Card>
        </>
      )}
    </div>
  );
}
