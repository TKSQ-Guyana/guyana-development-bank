import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { ApplicantProfile } from '../components/ApplicantProfile';
import { ClusterMembers } from '../components/ClusterMembers';
import { Conditions } from '../components/Conditions';
import { Disbursement } from '../components/Disbursement';
import { DocumentShelf } from '../components/DocumentShelf';
import { InformationRequests } from '../components/InformationRequests';
import { IssueOffer } from '../components/IssueOffer';
import { LoanAccount } from '../components/LoanAccount';
import { OfferPanel } from '../components/OfferPanel';
import { ApplicantCaseView } from '../features/applications/ApplicantCaseView';
import { QuickDecision } from '../features/quick-loan/QuickDecision';
import { ApplicationTab } from '../features/underwriting/ApplicationTab';
import { DecisionDrawer, RequestInfoDrawer } from '../features/underwriting/CaseDrawers';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StageBadge } from '../components/ui/Stepper';
import type { LoanApplication } from '../types';
import { formatGyd, formatDate } from '../utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** A left-rail card heading, with an optional badge on the right. */
function RailTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
      {aside}
    </div>
  );
}

const STAFF_TABS = [
  { id: 'application', label: 'Application' },
  { id: 'checks', label: 'Checks & documents' },
  { id: 'offer', label: 'Offer' },
  { id: 'facility', label: 'Facility' },
] as const;
type StaffTab = (typeof STAFF_TABS)[number]['id'];

/** A tab panel that stays mounted once its data is fetched, hidden with CSS
 *  rather than unmounted, so switching tabs never re-fetches and the left
 *  rail (which reads state a panel owns, like evidence completeness) stays
 *  accurate no matter which tab is on screen. */
function Panel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? 'space-y-4' : 'hidden'}>{children}</div>;
}

export function LoanDetail() {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const [loan, setLoan] = useState<LoanApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server's list of expected documents not yet on file, handed up by the
  // shelf. Only ever displayed — it gates nothing, on either side of the desk.
  // null (not []) until the shelf answers, so the evidence card never claims
  // "complete" before it actually knows that.
  const [missing, setMissing] = useState<string[] | null>(null);
  // Bumped when the bank books, disburses or asks for something, so the
  // panels below remount and refetch instead of showing stale state.
  const [accountKey, setAccountKey] = useState(0);
  const [tab, setTab] = useState<StaffTab>('application');
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(() => {
    if (!name) return;
    call<LoanApplication>('gdb_bank.api.loan_detail', { name })
      .then(setLoan)
      .catch((err: Error) => setError(err.message));
  }, [name]);

  useEffect(load, [load]);

  if (error && !loan) return <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>;
  if (!loan) return <p className="text-slate-500">Loading…</p>;

  const reviewable = loan.status === 'Submitted';
  // A Quick Loan has no underwriter decision and no Letter of Offer: the
  // Disbursement Officer decides and pays it in one act (QuickDecision).
  const quick = loan.product === 'quick';
  const underwriterDecides = Boolean(user?.is_underwriter) && reviewable && !quick;
  const quickDecides = quick && reviewable && Boolean(user?.is_disbursement);
  const trade = (key: string) => (loan.sections?.[key] as string | null) || '—';
  const mine = loan.applicant === user?.user;
  // NOT shared/personas.isStaff, and the difference is deliberate: that one
  // answers "is this a staff account?" for barring the citizen pages, and it
  // counts the Platform Admin. This asks who gets the CASE WORKSPACE, and the
  // Platform Admin is in none of the authority sets (utils/constants.py) —
  // every credit and money gate refuses it server-side, so handing it the
  // underwriter's workspace would draw controls that only answer with a
  // permission error.
  const staff = Boolean(user?.is_underwriter || user?.is_finance || user?.is_disbursement);
  // A staff account applying for their own loan reads this the way any
  // citizen does — the dense case workspace below is for deciding SOMEBODY
  // ELSE's case, never a mirror held up to your own.
  const workspace = staff && !mine;
  const backTo = user?.is_underwriter ? '/review' : user?.is_disbursement ? '/disbursements' : '/apply';
  const backLabel = user?.is_underwriter ? 'Queue' : user?.is_disbursement ? 'Disbursements' : 'Back';

  const bump = () => setAccountKey((k) => k + 1);

  // The applicant's own case — or a group member reading the head's.
  if (!workspace) {
    return <ApplicantCaseView loan={loan} backTo={backTo} onChange={load} />;
  }

  // ------------------------------------------------------------------------
  // Staff case workspace — deciding somebody else's case. Header with the
  // decision actions, a sticky left rail (case facts, evidence, prior
  // decision) and a tabbed right column.
  // ------------------------------------------------------------------------
  const evidenceComplete = missing !== null && missing.length === 0;
  const canSeeFacility = Boolean(user?.is_finance || user?.is_disbursement);

  return (
    <div>
      <Link to={backTo} className="text-sm font-medium text-brand hover:underline">
        ← {backLabel}
      </Link>

      {/* ------------------------------------------------------------ header */}
      <div className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{loan.applicant_name}</h1>
            <StageBadge stage={loan.stage} />
            <Badge tone={quick ? 'warning' : 'neutral'}>{quick ? 'Quick Loan' : 'SME Loan'}</Badge>
            {loan.cluster && <Badge tone="brand">Cluster {loan.cluster}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[loan.business_name, loan.name].filter(Boolean).join(' · ')}
            <span className="ml-2 font-mono text-xs">{loan.applicant_eid ?? 'no e-ID on file'}</span>
          </p>
        </div>
        {user?.is_underwriter && (
          <div className="flex flex-wrap gap-2">
            {loan.status !== 'Draft' && (
              <Button variant="secondary" onClick={() => setAsking(true)}>
                Request info
              </Button>
            )}
            {underwriterDecides && (
              <>
                <Button variant="danger" onClick={() => setDeciding('reject')}>
                  Decline
                </Button>
                <Button onClick={() => setDeciding('approve')}>Approve</Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {/* ---------------------------------------------------- LEFT: case at a glance */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <Card>
            <RailTitle>Case facts</RailTitle>
            <Row label="Requested" value={`${formatGyd(loan.loan_amount)} · ${loan.term_months} months`} />
            {loan.approved_amount != null && (
              <Row label="Approved (offer)" value={`${formatGyd(loan.approved_amount)} · ${loan.approved_term} months`} />
            )}
            {loan.sanctioned_amount != null && (
              <Row
                label="Booked in lending"
                value={
                  loan.booked_on_offer === false ? (
                    <span className="text-rose-700">{formatGyd(loan.sanctioned_amount)} — not the offer</span>
                  ) : (
                    formatGyd(loan.sanctioned_amount)
                  )
                }
              />
            )}
            {loan.disbursed_amount > 0 && <Row label="Disbursed" value={formatGyd(loan.disbursed_amount)} />}
            {loan.monthly_repayment != null && (
              <Row label="Monthly repayment" value={formatGyd(loan.monthly_repayment)} />
            )}
            {quick ? (
              <>
                <Row label="Location" value={trade('trade_location')} />
                <Row label="In business" value={trade('trading_since')} />
                <Row label="Terms accepted" value={loan.terms_accepted_on ? formatDate(loan.terms_accepted_on) : '—'} />
              </>
            ) : (
              <>
                <Row label="Business" value={loan.business_stage || '—'} />
                <Row label="DCRA" value={loan.dcra_number || '—'} />
                <Row label="Monthly income" value={loan.monthly_income ? formatGyd(loan.monthly_income) : '—'} />
              </>
            )}
            <Row label="Phone" value={loan.phone || '—'} />
            <Row label="Submitted" value={formatDate(loan.creation)} />
            {loan.purpose && (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="text-sm text-slate-500">Purpose</p>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{loan.purpose}</p>
              </div>
            )}
          </Card>

          <Card>
            <RailTitle
              aside={
                missing === null ? (
                  <span className="text-xs text-slate-400">Checking…</span>
                ) : (
                  <Badge tone={evidenceComplete ? 'success' : 'warning'}>
                    {evidenceComplete ? 'Complete' : `${missing.length} outstanding`}
                  </Badge>
                )
              }
            >
              Evidence
            </RailTitle>
            {missing && missing.length > 0 && (
              <ul className="space-y-1.5">
                {missing.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                      !
                    </span>
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(loan.underwriter_remarks || loan.reviewed_by) && (
            <Card>
              <RailTitle>Prior decision</RailTitle>
              {loan.underwriter_remarks && (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{loan.underwriter_remarks}</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {loan.reviewed_by} · {formatDate(loan.reviewed_on)}
              </p>
            </Card>
          )}
        </div>

        {/* ---------------------------------------------------------- RIGHT: tabs */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
            {STAFF_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-brand text-brand'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                {/* The Quick Loan decision lives in the Offer tab; a dot here
                    tells the officer one is waiting. */}
                {t.id === 'offer' && quickDecides && (
                  <span className="h-1.5 w-1.5 rounded-full bg-gdb-gold" aria-label="Decision needed" title="Decision needed" />
                )}
              </button>
            ))}
          </div>

          <Panel active={tab === 'application'}>
            {quick ? (
              <Card>
                <RailTitle>Business</RailTitle>
                <Row label="Business name" value={loan.business_name || '—'} />
                <Row label="Region" value={trade('trade_region')} />
                <Row label="What the business sells or does" value={trade('trade_activity')} />
                <Row label="Business location" value={trade('trade_location')} />
                <Row label="In business" value={trade('trading_since')} />
              </Card>
            ) : (
              <ApplicationTab loan={loan} />
            )}
          </Panel>

          <Panel active={tab === 'checks'}>
            <ApplicantProfile user={loan.applicant} />
            {loan.cluster && name && <ClusterMembers cluster={loan.cluster} application={name} />}
            {name && (
              <DocumentShelf
                key={`docs-${accountKey}`}
                application={name}
                onChange={setMissing}
                title="Documents"
              />
            )}
            {name && loan.status !== 'Draft' && (
              <InformationRequests key={`req-${accountKey}`} application={name} onChange={bump} />
            )}
          </Panel>

          <Panel active={tab === 'offer'}>
            {quickDecides && <QuickDecision loan={loan} onDecided={load} />}

            {quick ? null : loan.status === 'Approved' && name ? (
              <>
                {user?.is_underwriter && <IssueOffer application={name} onIssued={bump} />}
                <OfferPanel key={`offer-${accountKey}`} application={name} onExecuted={bump} />
                <Conditions key={`cp-${accountKey}`} application={name} onChange={bump} />
              </>
            ) : (
              <Card>
                <p className="text-sm text-slate-500">Available once the case is approved.</p>
              </Card>
            )}
          </Panel>

          <Panel active={tab === 'facility'}>
            {loan.status === 'Approved' && name ? (
              <>
                <Disbursement application={name} onChange={bump} />
                {canSeeFacility && <LoanAccount key={accountKey} application={name} canPay={false} />}
              </>
            ) : (
              <Card>
                <p className="text-sm text-slate-500">Booking and release open once the case is approved.</p>
              </Card>
            )}
          </Panel>
        </div>
      </div>

      <DecisionDrawer
        loan={loan}
        action={deciding}
        onClose={() => setDeciding(null)}
        onDecided={(updated) => {
          setLoan(updated);
          setDeciding(null);
          // An approval is followed by the Letter of Offer — take them there.
          if (updated.status === 'Approved') setTab('offer');
        }}
      />
      {name && (
        <RequestInfoDrawer
          application={name}
          open={asking}
          onClose={() => setAsking(false)}
          onSent={bump}
        />
      )}
    </div>
  );
}
