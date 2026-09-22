import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { Card, CardLabel } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge, Stepper } from '../components/ui/Stepper';
import { ArrowRightIcon, PlusIcon } from '../components/ui/icons';
import type { LoanAccount, LoanApplication } from '../types';
import { formatDate, formatGyd } from '../utils';

/** A case still moving through the journey, as opposed to one that has been
 *  declined or fully drawn. These are what the tracker is for. */
const LIVE_STAGES = new Set(['Draft', 'Review', 'Approved', 'Signing']);

const QUICK_LINKS = [
  {
    title: 'Direct bank loan',
    body: 'Borrow in your own name for an existing business or a new venture.',
    to: '/apply/new',
  },
  {
    title: 'Co-financed loan',
    body: 'Apply alongside a partner institution contributing part of the facility.',
    to: '/apply/new',
  },
  {
    title: 'Cluster-supported loan',
    body: 'The cluster head applies for the group. Every member keeps their own record.',
    to: '/cluster',
  },
];

function nextInstalment(account: LoanAccount | null): { date: string; amount: number } | null {
  if (!account?.schedule?.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const row = account.schedule.find((r) => r.payment_date >= today) ?? null;
  return row ? { date: row.payment_date, amount: row.total_payment } : null;
}

export function Dashboard() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [account, setAccount] = useState<LoanAccount | null>(null);
  const [facility, setFacility] = useState<'loans' | 'grants'>('loans');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  const disbursed = useMemo(() => loans?.find((l) => l.stage === 'Disbursed') ?? null, [loans]);
  const active = useMemo(() => loans?.find((l) => LIVE_STAGES.has(l.stage)) ?? null, [loans]);

  // The facility panel needs lending's own figures, so it is a second call and
  // only for a case that has actually been drawn.
  useEffect(() => {
    if (!disbursed) {
      setAccount(null);
      return;
    }
    call<LoanAccount>('gdb_bank.api.loan_account', { application: disbursed.name })
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [disbursed]);

  const firstName = (user?.full_name ?? '').split(' ')[0];
  const due = nextInstalment(account);

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-8">
      {/* Primary call to action. The one thing a citizen arrives here to do. */}
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-dark via-brand to-[#7b5cf0] p-8 text-white shadow-[0_24px_60px_-28px_rgba(46,26,107,0.7)] lg:p-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
              Guyana Development Bank
            </p>
            <h2 className="mt-2 text-3xl font-bold leading-tight lg:text-4xl">
              {firstName ? `Good day, ${firstName}.` : 'Welcome.'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Zero-interest financing for Guyanese businesses. Apply in your own name, with a
              partner, or through a cluster — and follow every step of the decision here.
            </p>
          </div>
          <Link
            to="/apply/new"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-brand-dark shadow-lg transition-transform hover:scale-[1.02]"
          >
            <PlusIcon className="h-4 w-4" />
            Apply for a loan or grant
          </Link>
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/15 sm:grid-cols-4">
          {[
            { label: 'Interest rate', value: '0%' },
            { label: 'Collateral', value: 'None' },
            { label: 'Applications', value: String(loans?.length ?? 0) },
            { label: 'Active facility', value: disbursed ? '1' : '—' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/10 px-4 py-3 backdrop-blur">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-white/60">
                {stat.label}
              </dt>
              <dd className="mt-0.5 text-xl font-bold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Where the live case actually is. The stage and its sentence are the
          server's — see api._stage_for. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Your application</h3>
          <Link to="/apply" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            View all
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>

        {!loans ? (
          <Card className="animate-pulse">
            <div className="h-4 w-48 rounded bg-slate-100" />
            <div className="mt-4 h-2 w-full rounded bg-slate-100" />
          </Card>
        ) : active ? (
          <Card>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardLabel>{active.name}</CardLabel>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {formatGyd(active.loan_amount)}
                </p>
                <p className="text-sm text-slate-500">
                  {active.term_months} months · {active.purpose}
                </p>
              </div>
              <StageBadge stage={active.stage} />
            </div>

            <Stepper stage={active.stage} label={active.stage_label} />

            <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
              <Link
                to={`/loans/${active.name}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
              >
                {active.stage === 'Draft' ? 'Continue application' : 'Open case'}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="border border-dashed border-slate-200 text-center">
            <p className="text-sm font-semibold text-slate-700">No application in progress</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Start one when you are ready. You can save and come back — nothing is sent to the Bank
              until you submit it.
            </p>
            <Link
              to="/apply/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              <PlusIcon className="h-4 w-4" />
              Start an application
            </Link>
          </Card>
        )}
      </section>

      {/* Facilities. Grants are not a product GDB runs through this portal yet,
          so the segment says so rather than inventing figures. */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">Your facilities</h3>
          <SegmentedControl
            options={[
              { id: 'loans', label: 'My loans' },
              { id: 'grants', label: 'My grants' },
            ]}
            value={facility}
            onChange={setFacility}
          />
        </div>

        {facility === 'grants' ? (
          <Card className="border border-dashed border-slate-200 text-center">
            <p className="text-sm font-semibold text-slate-700">No grants yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Grant programmes are not open through this portal. When they are, they will appear
              here beside your loans.
            </p>
          </Card>
        ) : disbursed && account?.loan ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardLabel>Facility {account.loan.name}</CardLabel>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {formatGyd(account.dues?.principal_outstanding ?? 0)}
                </p>
                <p className="text-sm text-slate-500">outstanding balance</p>
              </div>
              <StageBadge stage={disbursed.stage} />
            </div>

            <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Next instalment
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {due ? formatGyd(due.amount) : '—'}
                </dd>
                <dd className="text-xs text-slate-500">{due ? formatDate(due.date) : 'No instalment scheduled'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Disbursed</dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {formatGyd(account.loan.disbursed_amount)}
                </dd>
                <dd className="text-xs text-slate-500">of {formatGyd(account.loan.loan_amount)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Repaid</dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {formatGyd(account.loan.total_amount_paid)}
                </dd>
                <dd className="text-xs text-slate-500">
                  {account.dues?.overdue_total_amount ? (
                    <span className="font-semibold text-rose-600">
                      {formatGyd(account.dues.overdue_total_amount)} overdue
                    </span>
                  ) : (
                    'Nothing overdue'
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
              <Link
                to="/payments"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Make a payment
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link
                to="/statements"
                className="inline-flex items-center rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                Request a statement
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="border border-dashed border-slate-200 text-center">
            <p className="text-sm font-semibold text-slate-700">No active facility</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Once an approved loan is signed and released, your balance, schedule and next
              instalment appear here.
            </p>
          </Card>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold text-slate-900">Ways to apply</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <Link key={link.title} to={link.to} className="group">
              <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_40px_-18px_rgba(46,26,107,0.35)]">
                <p className="font-semibold text-slate-900">{link.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{link.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                  Start
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
