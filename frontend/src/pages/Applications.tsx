import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { Card } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge } from '../components/ui/Stepper';
import { ApplicationsIcon, PlusIcon } from '../components/ui/icons';
import type { CitizenProfile, ClusterInvitation, LoanApplication } from '../types';
import { formatDate, formatGyd } from '../utils';

/** Closed cases: money fully drawn, or a decision that went the other way.
 *  Everything else is still moving. */
const CLOSED_STAGES = new Set(['Disbursed', 'Rejected']);

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
      // Back into the wizard, at THIS draft. It used to point at the case page,
      // which refuses to render a draft — so the one button labelled "continue
      // this application" was the one place you could not continue it from.
      action: { to: `/apply/${loan.name}`, label: 'Continue this application' },
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
        {invite.invited_by ? (
          <>
            <span className="normal-case">{invite.invited_by}</span> invited you to join
          </>
        ) : (
          'Invitation to join'
        )}{' '}
        {invite.cluster_name || invite.name}
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

/** An unfinished application, kept on the profile until GDB holds a Loan
 *  Application for it (profiles.pending_applications). Only the fields this
 *  page shows are typed. */
interface Pending {
  id: string;
  state: { stage?: string; businessName?: string; amount?: string; step?: string };
  saved_on: string;
}

/** The wizard's sections in order — how far an unfinished draft has got. */
const WIZARD_STEPS = ['route', 'about', 'business', 'operations', 'finances', 'funding', 'evidence'];

const savedLabel = (value: string) =>
  new Date(value.replace(' ', 'T')).toLocaleString('en-GY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One application, whatever state it is in: the same row for an unfinished
 *  draft, a draft GDB holds, and a case with the Bank. */
interface Row {
  key: string;
  title: string;
  reference: string;
  product: string;
  status: ReactNode;
  /** Draft progress, 0..1 — drawn as a bar under the status. */
  progress?: number;
  detail: string;
  amount: number | null;
  flag?: string;
  primary: { to: string; label: string };
  secondary?: { to: string; label: string };
  /** A submitted case still in review: add what was left out. */
  edit?: string;
  onDelete?: () => void;
}

function ApplicationCard({ row, deleting }: { row: Row; deleting: boolean }) {
  return (
    // Fixed columns from md up, so status, amount and actions line up down the
    // list however many buttons a row has; stacked on a phone.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_14rem_8rem_15rem]">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-brand-light text-brand">
        <ApplicationsIcon className="h-4 w-4" />
      </span>

      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="truncate">{row.title}</span>
          {row.flag && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              {row.flag}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          <span className="font-mono text-brand">{row.reference}</span> · {row.product}
        </p>
      </div>

      <div className="col-span-2 md:col-span-1">
        {row.status}
        <p className="mt-1 truncate text-xs text-slate-500">{row.detail}</p>
        {row.progress !== undefined && (
          <div className="mt-1.5 h-1 w-full rounded-full bg-slate-100">
            <div className="h-1 rounded-full bg-brand" style={{ width: `${Math.round(row.progress * 100)}%` }} />
          </div>
        )}
      </div>

      <div>
        <p className="text-[11px] text-slate-400">Requested</p>
        <p className="text-sm font-bold tabular-nums text-slate-900">
          {row.amount ? formatGyd(row.amount) : '—'}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {row.secondary && (
          <Link
            to={row.secondary.to}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
          >
            {row.secondary.label}
          </Link>
        )}
        {row.edit && (
          <Link
            to={row.edit}
            className="rounded-full border border-brand px-4 py-1.5 text-xs font-semibold text-brand hover:bg-brand-light"
          >
            Edit
          </Link>
        )}
        <Link
          to={row.primary.to}
          className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {row.primary.label}
        </Link>
        {row.onDelete && (
          <button
            type="button"
            onClick={row.onDelete}
            disabled={deleting}
            className="rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

const draftPill = (
  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
    Draft
  </span>
);

/** A draft a GDB Field Officer filled with the applicant and handed back. */
const readyPill = (
  <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
    Ready to submit
  </span>
);

export function Applications() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [invites, setInvites] = useState<ClusterInvitation[]>([]);
  const [financialsDone, setFinancialsDone] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'current' | 'past'>('current');
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
    call<Pending[]>('gdb_bank.profiles.pending_applications')
      .then((rows) => setPending(rows ?? []))
      .catch(() => setPending([]));
    call<ClusterInvitation[]>('gdb_bank.api.my_invitations')
      .then(setInvites)
      .catch((err: Error) => setError(err.message));
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((p) => setFinancialsDone(Boolean(p.financials_updated_on)))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  /** Delete a draft — confirmed first, because it cannot be undone. Drafts
   *  only: the server refuses anything submitted. */
  const remove = async (key: string, label: string, run: () => Promise<unknown>) => {
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeleting(key);
    try {
      await run();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That draft could not be deleted.');
    } finally {
      setDeleting(null);
    }
  };

  const productOf = (loan: LoanApplication) =>
    loan.product === 'quick' ? 'Quick Loan' : loan.cluster ? 'Group loan' : 'SME Direct Loan';

  const pendingRows: Row[] = pending.map((p) => {
    const done = Math.max(0, WIZARD_STEPS.indexOf(p.state.step ?? 'route'));
    const title = p.state.businessName || 'New application';
    return {
      key: `pending-${p.id}`,
      title,
      reference: `DRAFT-${p.id.slice(0, 8).toUpperCase()}`,
      product: 'SME Direct Loan',
      status: draftPill,
      progress: done / WIZARD_STEPS.length,
      detail: `${done} of ${WIZARD_STEPS.length} sections · Saved ${savedLabel(p.saved_on)}`,
      amount: p.state.amount ? Number(p.state.amount) : null,
      primary: { to: `/apply/draft/${p.id}`, label: 'Resume draft' },
      onDelete: () =>
        void remove(`pending-${p.id}`, title, () =>
          call('gdb_bank.profiles.discard_pending_application', { id: p.id }),
        ),
    };
  });

  const loanRow = (loan: LoanApplication): Row => {
    // A member (not the head) owes their personal financials on each group case.
    const attention = attentionFor(
      loan,
      Boolean(loan.cluster) && loan.applicant !== user?.user && !financialsDone,
    );
    const draft = loan.stage === 'Draft';
    const title = loan.cluster || loan.business_name || 'Loan application';
    return {
      key: loan.name,
      title,
      reference: loan.name,
      product: productOf(loan),
      status: draft ? (loan.handed_off_on ? readyPill : draftPill) : <StageBadge stage={loan.stage} />,
      // A Loan Application draft exists only once Funding is saved.
      progress: draft ? 6 / WIZARD_STEPS.length : undefined,
      detail: draft
        ? loan.handed_off_on
          ? `Prepared with ${loan.assisted_by_name ?? 'a GDB Field Officer'} · check and submit`
          : `6 of ${WIZARD_STEPS.length} sections · Saved ${savedLabel(loan.modified)}`
        : loan.stage_label,
      amount: loan.loan_amount,
      flag: !draft && attention ? attention.tag : undefined,
      primary: draft
        ? {
            to: loan.product === 'quick' ? `/apply/quick/${loan.name}` : `/apply/${loan.name}`,
            label: 'Resume draft',
          }
        : { to: `/loans/${loan.name}`, label: 'View' },
      secondary: !draft && attention?.action ? attention.action : undefined,
      edit:
        loan.stage === 'Review' && !loan.cluster && loan.applicant === user?.user
          ? `/loans/${loan.name}?edit=1`
          : undefined,
      // The head cannot delete a group's draft — its facilitator manages it.
      onDelete:
        draft && !loan.cluster
          ? () => void remove(loan.name, title, () => call('gdb_bank.api.discard_application', { name: loan.name }))
          : undefined,
    };
  };

  const all = loans ?? [];
  const current = [...pendingRows, ...all.filter((l) => !CLOSED_STAGES.has(l.stage)).map(loanRow)];
  const past = all.filter((l) => CLOSED_STAGES.has(l.stage)).map(loanRow);
  const shown = tab === 'current' ? current : past;

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-3 text-xl font-bold text-slate-900">
            My applications
            <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-text">
              {current.length} active application{current.length === 1 ? '' : 's'}
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">Your GDB loan applications. Drafts have not been sent to GDB.</p>
        </div>
        <Link
          to="/apply/new"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          <PlusIcon className="h-4 w-4" />
          Start an application
        </Link>
      </div>

      {invites.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-slate-700">
            {invites.length === 1 ? 'Group invitation' : 'Group invitations'}
          </h3>
          {invites.map((invite) => (
            <InvitationCard key={invite.name} invite={invite} onAnswered={load} />
          ))}
        </section>
      )}

      <SegmentedControl<'current' | 'past'>
        value={tab}
        onChange={setTab}
        options={[
          { id: 'current', label: `Current ${current.length}` },
          { id: 'past', label: `Past ${past.length}` },
        ]}
      />

      {!loans ? (
        <Card className="animate-pulse">
          <div className="h-4 w-40 rounded bg-slate-100" />
          <div className="mt-4 h-2 w-full rounded bg-slate-100" />
        </Card>
      ) : shown.length === 0 ? (
        <Card className="border border-dashed border-slate-200 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {tab === 'current' ? 'No applications in progress' : 'No past applications'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((row) => (
            <ApplicationCard key={row.key} row={row} deleting={deleting === row.key} />
          ))}
        </div>
      )}

      <Link
        to="/"
        className="inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
