import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { Card, CardLabel } from '../components/ui/Card';
import { StageBadge, Stepper } from '../components/ui/Stepper';
import { ArrowRightIcon, PlusIcon } from '../components/ui/icons';
import type { LoanApplication } from '../types';
import { formatDate, formatGyd } from '../utils';

/** Closed cases: money fully drawn, or a decision that went the other way.
 *  Everything else is still moving and belongs at the top of the page. */
const CLOSED_STAGES = new Set(['Disbursed', 'Rejected']);

function ApplicationCard({ loan }: { loan: LoanApplication }) {
  return (
    <Card className="transition-shadow hover:shadow-[0_16px_40px_-18px_rgba(46,26,107,0.35)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <CardLabel>{loan.name}</CardLabel>
          <p className="mt-1 text-2xl font-bold text-slate-900">{formatGyd(loan.loan_amount)}</p>
          <p className="truncate text-sm text-slate-500">
            {loan.term_months} months · {loan.purpose}
          </p>
        </div>
        <StageBadge stage={loan.stage} />
      </div>

      <Stepper stage={loan.stage} label={loan.stage_label} />

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <Link
          to={`/loans/${loan.name}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          {loan.stage === 'Draft' ? 'Continue' : 'Open case'}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        {loan.conditions_outstanding > 0 && (
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
            {loan.conditions_outstanding} condition{loan.conditions_outstanding === 1 ? '' : 's'} outstanding
          </span>
        )}
        {loan.offer_status === 'Issued' && (
          <span className="rounded-full bg-brand-light px-3 py-1.5 text-xs font-semibold text-brand-text">
            Letter of Offer waiting for you
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">Started {formatDate(loan.creation)}</span>
      </div>
    </Card>
  );
}

export function Applications() {
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  const { live, past } = useMemo(() => {
    const all = loans ?? [];
    return {
      live: all.filter((l) => !CLOSED_STAGES.has(l.stage)),
      past: all.filter((l) => CLOSED_STAGES.has(l.stage)),
    };
  }, [loans]);

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">My applications</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everything you have applied for, and where each one stands today.
          </p>
        </div>
        <Link
          to="/apply/new"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          <PlusIcon className="h-4 w-4" />
          Start an application
        </Link>
      </div>

      {!loans ? (
        <Card className="animate-pulse">
          <div className="h-4 w-40 rounded bg-slate-100" />
          <div className="mt-4 h-2 w-full rounded bg-slate-100" />
        </Card>
      ) : loans.length === 0 ? (
        <Card className="border border-dashed border-slate-200 py-12 text-center">
          <p className="text-base font-semibold text-slate-700">No applications yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            An application is saved as you go. Nothing reaches the Bank until you submit it, and you
            can attach your documents before or after.
          </p>
          <Link
            to="/apply/new"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <PlusIcon className="h-4 w-4" />
            Start your first application
          </Link>
        </Card>
      ) : (
        <>
          {live.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
                In progress
              </h3>
              <div className="grid gap-4 xl:grid-cols-2">
                {live.map((loan) => (
                  <ApplicationCard key={loan.name} loan={loan} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
                Past applications
              </h3>
              <Card className="overflow-hidden p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-6 py-3">Application</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3">Term</th>
                      <th className="px-6 py-3">Started</th>
                      <th className="px-6 py-3">Outcome</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {past.map((loan) => (
                      <tr key={loan.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="px-6 py-3">
                          <Link to={`/loans/${loan.name}`} className="font-semibold text-brand hover:underline">
                            {loan.name}
                          </Link>
                          <span className="block truncate text-xs text-slate-400">{loan.purpose}</span>
                        </td>
                        <td className="px-6 py-3 text-right font-semibold tabular-nums text-slate-800">
                          {formatGyd(loan.loan_amount)}
                        </td>
                        <td className="px-6 py-3 text-slate-600">{loan.term_months} months</td>
                        <td className="px-6 py-3 text-slate-600">{formatDate(loan.creation)}</td>
                        <td className="px-6 py-3">
                          <StageBadge stage={loan.stage} />
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Link
                            to={`/loans/${loan.name}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand"
                          >
                            Open
                            <ArrowRightIcon className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
