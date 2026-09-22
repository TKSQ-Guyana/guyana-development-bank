import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { Card } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge, Stepper } from '../components/ui/Stepper';
import { ArrowRightIcon, ChevronDownIcon, ClusterIcon, PlusIcon } from '../components/ui/icons';
import type { Cluster as ClusterType, ClusterInvitation, LoanApplication } from '../types';
import { formatDate, formatGyd } from '../utils';

/** Closed cases: money fully drawn, or a decision that went the other way.
 *  Everything else is still moving. */
const CLOSED_STAGES = new Set(['Disbursed', 'Rejected']);

type Filter = 'all' | 'live' | 'past';

/** The one thing this case is waiting on the APPLICANT for, or nothing.
 *  A row is collapsed by default, so whatever surfaces on the closed row has
 *  to be the fact that would make someone open it — not a summary of the case.
 *  Anything the Bank owns (sitting in the review queue, say) is not an action
 *  and is deliberately not flagged: a badge that means "wait" trains people to
 *  ignore the badge that means "act". */
function attentionFor(loan: LoanApplication): { tag: string; note: string } | null {
  if (loan.offer_status === 'Issued') {
    return {
      tag: 'Offer waiting',
      note: 'Your Letter of Offer is ready. Open the case to read it, then accept or decline.',
    };
  }
  if (loan.stage === 'Draft') {
    return {
      tag: 'Not submitted',
      note: 'This is still your own draft — the Bank cannot see it until you submit it. Nothing is lost in the meantime.',
    };
  }
  if (loan.conditions_outstanding > 0) {
    return {
      tag: `${loan.conditions_outstanding} condition${loan.conditions_outstanding === 1 ? '' : 's'} to clear`,
      note: 'Funds are released once every condition on the offer is satisfied.',
    };
  }
  return null;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

/** One application, closed to a single line by default. The header is the
 *  toggle and holds no other control, so the whole strip is one hit target and
 *  there is no interactive element nested inside the button. */
function ApplicationRow({
  loan,
  open,
  onToggle,
}: {
  loan: LoanApplication;
  open: boolean;
  onToggle: () => void;
}) {
  const attention = attentionFor(loan);
  const bodyId = `case-${loan.name}`;

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
        open ? 'border-brand/30' : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/80 sm:gap-4 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-slate-900">
              {loan.purpose || 'Loan application'}
            </span>
            {attention && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {attention.tag}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {loan.name}
            {loan.cluster ? ' · group application' : ''} · started {formatDate(loan.creation)}
          </p>
        </div>

        <div className="flex-none text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">
            {formatGyd(loan.loan_amount)}
          </p>
          <p className="hidden text-xs text-slate-400 sm:block">{loan.term_months} months</p>
        </div>

        <div className="hidden flex-none sm:block">
          <StageBadge stage={loan.stage} />
        </div>

        <ChevronDownIcon
          className={`h-5 w-5 flex-none text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id={bodyId} className="border-t border-slate-100 px-4 pb-5 pt-5 sm:px-5">
          <div className="mb-5 sm:hidden">
            <StageBadge stage={loan.stage} />
          </div>

          <Stepper stage={loan.stage} label={loan.stage_label} />

          {attention && (
            <p className="mt-5 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
              {attention.note}
            </p>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label="Amount" value={formatGyd(loan.loan_amount)} />
            <Fact label="Term" value={`${loan.term_months} months`} />
            {loan.rate_of_interest !== null && (
              <Fact
                label="Interest"
                value={loan.rate_of_interest === 0 ? '0% — interest-free' : `${loan.rate_of_interest}%`}
              />
            )}
            {loan.monthly_repayment !== null && (
              <Fact label="Monthly repayment" value={formatGyd(loan.monthly_repayment)} />
            )}
            {loan.disbursed_amount > 0 && (
              <Fact label="Disbursed" value={formatGyd(loan.disbursed_amount)} />
            )}
            {loan.monthly_income > 0 && (
              <Fact label="Monthly income declared" value={formatGyd(loan.monthly_income)} />
            )}
            <Fact label="Started" value={formatDate(loan.creation)} />
            <Fact label="Last updated" value={formatDate(loan.modified)} />
          </dl>

          {loan.underwriter_remarks && (
            <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                From the Bank
              </p>
              <p className="mt-1 text-sm text-slate-700">{loan.underwriter_remarks}</p>
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <Link
              to={`/loans/${loan.name}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
            >
              {loan.stage === 'Draft' ? 'Continue this application' : 'Open case'}
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** The cluster entry point. It lives here rather than on the sidebar so a
 *  citizen has one place for everything they have applied for, alone or with a
 *  group. Pending invitations surface here too: `Invitations` only renders on
 *  /cluster for someone who is not yet in one, so without this an invitee who
 *  never thinks to visit that page would never learn they were asked.
 *  The panel itself stays one line — it is a doorway, not a second report. */
function ClusterPanel() {
  const [cluster, setCluster] = useState<ClusterType | null | undefined>(undefined);
  const [invites, setInvites] = useState<ClusterInvitation[]>([]);

  useEffect(() => {
    call<ClusterType | null>('gdb_bank.api.my_cluster')
      .then(setCluster)
      .catch(() => setCluster(null));
    call<ClusterInvitation[]>('gdb_bank.api.my_invitations')
      .then(setInvites)
      .catch(() => setInvites([]));
  }, []);

  // Say nothing until the answer is in, rather than flashing "no cluster".
  if (cluster === undefined) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">My cluster</h3>

      {/* An invitation is the one thing here somebody must answer, so it keeps
          its full card while everything else collapses to a line. */}
      {invites.length > 0 && (
        <Card className="border border-gdb-gold/60">
          <p className="text-base font-semibold text-slate-800">
            You have been invited to {invites.length === 1 ? 'a cluster' : `${invites.length} clusters`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {invites.map((i) => i.cluster_name || i.name).join(', ')} — answer before the head applies
            for the group.
          </p>
          <Link
            to="/cluster"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
          >
            Answer the invitation
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Card>
      )}

      {cluster ? (
        <Link
          to="/cluster"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-colors hover:border-brand/40 hover:bg-slate-50/80 sm:px-5"
        >
          <ClusterIcon className="h-5 w-5 flex-none text-brand" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold text-slate-900">{cluster.name}</span>
              {cluster.is_head && (
                <span className="rounded-full bg-gdb-gold/40 px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
                  You are the head
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {[cluster.region, cluster.sector].filter(Boolean).join(' · ') || 'Cluster'} ·{' '}
              {cluster.members.length} member{cluster.members.length === 1 ? '' : 's'} ·{' '}
              {cluster.applications.length} application
              {cluster.applications.length === 1 ? '' : 's'}
            </p>
          </div>
          <ArrowRightIcon className="h-4 w-4 flex-none text-slate-400" />
        </Link>
      ) : (
        <Link
          to="/cluster"
          className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 px-4 py-3.5 transition-colors hover:border-brand hover:bg-white sm:px-5"
        >
          <ClusterIcon className="h-5 w-5 flex-none text-slate-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-700">Start or join a cluster</p>
            <p className="mt-0.5 text-xs text-slate-400">
              A group applies together — the head applies for the group, every member keeps their own
              record.
            </p>
          </div>
          <ArrowRightIcon className="h-4 w-4 flex-none text-slate-400" />
        </Link>
      )}
    </section>
  );
}

export function Applications() {
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then((rows) => {
        setLoans(rows);
        // Open what is waiting on this person, and nothing else — a page that
        // opens everything is the page we are moving away from. One lone
        // application has nothing to scan past, so it opens too.
        const waiting = rows.filter((l) => attentionFor(l));
        const seed = waiting.length ? waiting : rows.length === 1 ? rows : [];
        setOpenIds(new Set(seed.map((l) => l.name)));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const { live, past, needsAction } = useMemo(() => {
    const all = loans ?? [];
    return {
      live: all.filter((l) => !CLOSED_STAGES.has(l.stage)),
      past: all.filter((l) => CLOSED_STAGES.has(l.stage)),
      needsAction: all.filter((l) => attentionFor(l)).length,
    };
  }, [loans]);

  // Still-moving cases first whichever filter is on: what is live is what the
  // applicant came to check.
  const shown = filter === 'live' ? live : filter === 'past' ? past : [...live, ...past];
  const allOpen = shown.length > 0 && shown.every((l) => openIds.has(l.name));

  function toggle(name: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">My applications</h2>
          <p className="mt-1 text-sm text-slate-500">
            {loans && loans.length > 0 ? (
              <>
                {loans.length} application{loans.length === 1 ? '' : 's'}
                {needsAction > 0 ? (
                  <>
                    {' · '}
                    <span className="font-semibold text-amber-700">
                      {needsAction} waiting on you
                    </span>
                  </>
                ) : (
                  ' · nothing waiting on you'
                )}
              </>
            ) : (
              'Everything you have applied for, and where each one stands today.'
            )}
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
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: `All (${loans.length})` },
                { id: 'live', label: `In progress (${live.length})` },
                { id: 'past', label: `Decided (${past.length})` },
              ]}
            />
            {shown.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setOpenIds(allOpen ? new Set() : new Set(shown.map((l) => l.name)))
                }
                className="text-sm font-semibold text-slate-500 transition-colors hover:text-brand"
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <Card className="border border-dashed border-slate-200 py-10 text-center">
              <p className="text-sm text-slate-500">
                {filter === 'live'
                  ? 'Nothing in progress — every application has been decided.'
                  : 'No decided applications yet.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {shown.map((loan) => (
                <ApplicationRow
                  key={loan.name}
                  loan={loan}
                  open={openIds.has(loan.name)}
                  onToggle={() => toggle(loan.name)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <ClusterPanel />
    </div>
  );
}
