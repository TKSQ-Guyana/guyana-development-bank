import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { Card } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge, Stepper } from '../components/ui/Stepper';
import { ArrowRightIcon, ChevronDownIcon, ClusterIcon, PlusIcon } from '../components/ui/icons';
import type { CitizenProfile, ClusterInvitation, LoanApplication } from '../types';
import { formatDate, formatGyd } from '../utils';

/** Closed cases: money fully drawn, or a decision that went the other way.
 *  Everything else is still moving. */
const CLOSED_STAGES = new Set(['Disbursed', 'Rejected']);

type Filter = 'all' | 'live' | 'past';

/** Mine = applications a person made alone; Clusters = their groups' ones.
 *  Kept in the URL (?view=clusters) so a notification can link straight to it. */
type View = 'mine' | 'clusters';

/** The one thing this case is waiting on the APPLICANT for, or nothing.
 *  A row is collapsed by default, so whatever surfaces on the closed row has
 *  to be the fact that would make someone open it — not a summary of the case.
 *  Anything the Bank owns (sitting in the review queue, say) is not an action
 *  and is deliberately not flagged: a badge that means "wait" trains people to
 *  ignore the badge that means "act". */
interface Attention {
  tag: string;
  note: string;
  /** Where the row's button goes instead of the case, when the task has its own page. */
  action?: { to: string; label: string };
}

function attentionFor(loan: LoanApplication, owesFinancials = false): Attention | null {
  if (loan.offer_status === 'Issued') {
    return loan.cluster
      ? { tag: 'Offer to sign', note: 'Your group’s Letter of Offer is ready. Open the case to sign it.' }
      : {
          tag: 'Offer waiting',
          note: 'Your Letter of Offer is ready. Open the case to read it, then accept or decline.',
        };
  }
  if (owesFinancials) {
    return {
      tag: 'Add your financials',
      note: 'Your part in this group application: your personal financials.',
      action: { to: `/loans/${loan.name}/my-financials`, label: 'Add your financials' },
    };
  }
  if (loan.stage === 'Draft') {
    return {
      tag: 'Not submitted',
      note: 'This is still a draft — the Bank cannot see it until it is submitted. Nothing is lost in the meantime.',
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
  attention,
  open,
  onToggle,
}: {
  loan: LoanApplication;
  attention: Attention | null;
  open: boolean;
  onToggle: () => void;
}) {
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
            {/* Identify the case by who it's for — the cluster if it's the
                group's, else the business — never by `purpose`: that's a
                free-text field with no length limit, and nothing stops it
                holding a whole pasted business plan instead of a sentence. */}
            <span className="truncate text-sm font-semibold text-slate-900">
              {loan.cluster || loan.business_name || 'Loan application'}
            </span>
            {attention && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {attention.tag}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {loan.name} · started {formatDate(loan.creation)}
          </p>
        </div>

        <div className="flex-none text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">
            {formatGyd(loan.facility_amount)}
          </p>
          <p className="hidden text-xs text-slate-400 sm:block">{loan.facility_term} months</p>
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
            <Fact label="Amount requested" value={formatGyd(loan.loan_amount)} />
            {loan.approved_amount != null && (
              <Fact label="Amount approved" value={formatGyd(loan.approved_amount)} />
            )}
            <Fact label="Term" value={`${loan.facility_term} months`} />
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
              to={attention?.action?.to ?? `/loans/${loan.name}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
            >
              {attention?.action?.label ?? (loan.stage === 'Draft' ? 'Continue this application' : 'Open case')}
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** An invitation to a group, answered right here. */
function InvitationCard({
  invite,
  onAnswered,
}: {
  invite: ClusterInvitation;
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.api.respond_to_invitation', { cluster: invite.name, accept: accept ? 1 : 0 });
      onAnswered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your answer');
      setBusy(false);
    }
  };

  const facts = [invite.region, invite.sector].filter(Boolean).join(' · ');

  return (
    <Card className="border border-gdb-gold/60">
      <p className="text-base font-semibold text-slate-800">
        {invite.head_name} invited you to join {invite.cluster_name || invite.name}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {facts ? `${facts} · ` : ''}invited {formatDate(invite.invited_on)}
      </p>
      {error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(true)}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          Join the group
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(false)}
          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </Card>
  );
}

export function Applications() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'clusters' ? 'clusters' : 'mine';
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [invites, setInvites] = useState<ClusterInvitation[]>([]);
  const [financialsDone, setFinancialsDone] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
    call<ClusterInvitation[]>('gdb_bank.api.my_invitations')
      .then(setInvites)
      .catch((err: Error) => setError(err.message));
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((p) => setFinancialsDone(Boolean(p.financials_updated_on)))
      .catch((err: Error) => setError(err.message));
  }, []);

  // A member (not the head) owes their personal financials on each group case.
  const attention = (loan: LoanApplication) =>
    attentionFor(loan, Boolean(loan.cluster) && loan.applicant !== user?.user && !financialsDone);

  useEffect(load, [load]);

  const setView = (next: View) =>
    setParams(next === 'clusters' ? { view: 'clusters' } : {}, { replace: true });

  const { own, group } = useMemo(() => {
    const all = loans ?? [];
    return { own: all.filter((l) => !l.cluster), group: all.filter((l) => l.cluster) };
  }, [loans]);

  const inView = view === 'clusters' ? group : own;
  const live = inView.filter((l) => !CLOSED_STAGES.has(l.stage));
  const past = inView.filter((l) => CLOSED_STAGES.has(l.stage));
  const needsAction = inView.filter((l) => attention(l)).length;
  // Still-moving cases first whichever filter is on: what is live is what the
  // applicant came to check.
  const shown = filter === 'live' ? live : filter === 'past' ? past : [...live, ...past];
  const allOpen = shown.length > 0 && shown.every((l) => openIds.has(l.name));
  const clustersWaiting = invites.length > 0 || group.some((l) => attention(l));

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">My applications</h2>
          <p className="mt-1 text-sm text-slate-500">
            {needsAction > 0 ? (
              <span className="font-semibold text-amber-700">{needsAction} waiting on you</span>
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

      <SegmentedControl<View>
        value={view}
        onChange={setView}
        options={[
          { id: 'mine', label: `Mine (${own.length})` },
          {
            id: 'clusters',
            label: (
              <span className="inline-flex items-center gap-1.5">
                Clusters ({group.length})
                {clustersWaiting && (
                  <span className="h-1.5 w-1.5 rounded-full bg-gdb-gold" aria-label="Something is waiting on you" />
                )}
              </span>
            ),
          },
        ]}
      />

      {view === 'clusters' && invites.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Invitations</h3>
          {invites.map((invite) => (
            <InvitationCard key={invite.name} invite={invite} onAnswered={load} />
          ))}
        </section>
      )}

      {!loans ? (
        <Card className="animate-pulse">
          <div className="h-4 w-40 rounded bg-slate-100" />
          <div className="mt-4 h-2 w-full rounded bg-slate-100" />
        </Card>
      ) : inView.length === 0 ? (
        view === 'clusters' ? (
          <Link
            to="/cluster"
            className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 px-4 py-3.5 transition-colors hover:border-brand hover:bg-white sm:px-5"
          >
            <ClusterIcon className="h-5 w-5 flex-none text-slate-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700">No group applications yet</p>
              <p className="mt-0.5 text-xs text-slate-400">Start a cluster, or join one you are invited to.</p>
            </div>
            <ArrowRightIcon className="h-4 w-4 flex-none text-slate-400" />
          </Link>
        ) : (
          <Card className="border border-dashed border-slate-200 py-12 text-center">
            <p className="text-base font-semibold text-slate-700">No applications yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              An application is saved as you go. Nothing reaches the Bank until you submit it.
            </p>
            <Link
              to="/apply/new"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              <PlusIcon className="h-4 w-4" />
              Start your first application
            </Link>
          </Card>
        )
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: `All (${inView.length})` },
                { id: 'live', label: `In progress (${live.length})` },
                { id: 'past', label: `Decided (${past.length})` },
              ]}
            />
            {shown.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenIds(allOpen ? new Set() : new Set(shown.map((l) => l.name)))}
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
                  attention={attention(loan)}
                  open={openIds.has(loan.name)}
                  onToggle={() => toggle(loan.name)}
                />
              ))}
            </div>
          )}

          {view === 'clusters' && (
            <Link to="/cluster" className="inline-block text-sm font-semibold text-brand hover:underline">
              Manage your groups →
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
