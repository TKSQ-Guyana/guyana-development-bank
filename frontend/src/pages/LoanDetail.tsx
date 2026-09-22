import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { ApplicantProfile } from '../components/ApplicantProfile';
import { ApplicationSections } from '../components/ApplicationSections';
import { ClusterMembers } from '../components/ClusterMembers';
import { Conditions } from '../components/Conditions';
import { Disbursement } from '../components/Disbursement';
import { DocumentShelf } from '../components/DocumentShelf';
import { InformationRequests } from '../components/InformationRequests';
import { IssueOffer } from '../components/IssueOffer';
import { LoanAccount } from '../components/LoanAccount';
import { OfferPanel } from '../components/OfferPanel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardLabel } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge, Stepper } from '../components/ui/Stepper';
import type { LoanApplication } from '../types';
import { formatGyd, formatDate } from '../utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

const STAFF_TABS = [
  { id: 'application', label: 'Application' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'verification', label: 'Verification' },
  { id: 'offer', label: 'Offer & conditions' },
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
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The server's list of expected documents not yet on file, handed up by the
  // shelf. Only ever displayed — it gates nothing, on either side of the desk.
  // null (not []) until the shelf answers, so the evidence card never claims
  // "complete" before it actually knows that.
  const [missing, setMissing] = useState<string[] | null>(null);
  // Bumped when the bank books or disburses, so the borrower-facing account
  // below remounts and refetches instead of showing a stale schedule.
  const [accountKey, setAccountKey] = useState(0);
  const [tab, setTab] = useState<StaffTab>('application');

  const load = useCallback(() => {
    if (!name) return;
    call<LoanApplication>('gdb_bank.api.loan_detail', { name })
      .then(setLoan)
      .catch((err: Error) => setError(err.message));
  }, [name]);

  useEffect(load, [load]);

  const review = async (action: 'approve' | 'reject') => {
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      setLoan(await call<LoanApplication>('gdb_bank.api.review_loan', { name, action, remarks }));
      setRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !loan) return <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>;
  if (!loan) return <p className="text-slate-500">Loading…</p>;

  const reviewable = loan.status === 'Submitted';
  const isDraft = loan.status === 'Draft';
  const mine = loan.applicant === user?.user;
  const isStaff = Boolean(user?.is_underwriter || user?.is_finance || user?.is_disbursement);
  // A staff account applying for their own loan reads this the way any
  // citizen does — the dense case workspace below is for deciding SOMEBODY
  // ELSE's case, never a mirror held up to your own.
  const workspace = isStaff && !mine;
  const backTo = user?.is_underwriter ? '/review' : user?.is_disbursement ? '/disbursements' : '/apply';

  const submitDraft = async () => {
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      setLoan(await call<LoanApplication>('gdb_bank.api.submit_application', { name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  };

  const bump = () => setAccountKey((k) => k + 1);

  // ------------------------------------------------------------------------
  // Applicant's own case — a personal record, read top to bottom. Everyone
  // who is not staff-reviewing-somebody-else lands here: the applicant, and a
  // cluster member reading the head's facility.
  // ------------------------------------------------------------------------
  if (!workspace) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to={backTo} className="text-sm font-medium text-brand hover:underline">
          ← Back
        </Link>
        <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{loan.name}</h1>
          <StageBadge stage={loan.stage} />
        </div>

        <Card className="mb-4">
          <Stepper stage={loan.stage} label={loan.stage_label} />
        </Card>

        <Card>
          <Row
            label="Applicant"
            value={
              <>
                {loan.applicant_name}
                <span className="ml-2 font-mono text-xs text-slate-500">
                  {loan.applicant_eid ?? 'no e-ID on file'}
                </span>
              </>
            }
          />
          <Row label="Loan amount" value={formatGyd(loan.loan_amount)} />
          <Row label="Term" value={`${loan.term_months} months`} />
          <Row label="Monthly income" value={loan.monthly_income ? formatGyd(loan.monthly_income) : '—'} />
          <Row label="Phone" value={loan.phone || '—'} />
          <Row label="Submitted on" value={formatDate(loan.creation)} />
          <div className="py-2 text-sm">
            <span className="text-slate-500">Purpose</span>
            <p className="mt-1 whitespace-pre-wrap font-medium text-slate-800">{loan.purpose}</p>
          </div>
        </Card>

        {!isDraft && (
          <div className="mt-4">
            <ApplicationSections sections={loan.sections} businessStage={loan.business_stage} />
          </div>
        )}

        {name && (
          <DocumentShelf
            key={`docs-${accountKey}`}
            application={name}
            canUpload={mine}
            onChange={setMissing}
            title="Documents on this application"
          />
        )}

        {isDraft && mine && (
          <div className="mt-4 rounded-xl border border-gdb-gold/60 bg-white p-6 shadow">
            <h2 className="mb-2 font-semibold">Not yet submitted</h2>
            <p className="mb-3 text-sm text-slate-600">
              {missing && missing.length > 0
                ? `You can submit now. GDB will ask for your ${missing.join(', ')} during review — attaching it above first usually means a faster decision.`
                : 'Everything GDB expects is attached. Submit when you are ready — an underwriter reviews it next.'}
            </p>
            <Button disabled={busy} onClick={() => void submitDraft()}>
              {busy ? 'Submitting…' : 'Submit application'}
            </Button>
          </div>
        )}

        {name && loan.status !== 'Draft' && (
          <InformationRequests key={`req-${accountKey}`} application={name} onChange={bump} />
        )}

        {loan.status === 'Approved' && name && (
          <OfferPanel key={`offer-${accountKey}`} application={name} onExecuted={bump} />
        )}

        {/* No conditions-precedent checklist here. Clearing a condition is
            GDB's own verification work — the applicant can neither tick one
            off nor act on most of them — so the list lives in the staff case
            workspace only. What the applicant is asked to supply reaches them
            as an information request, which is a question they can answer. */}

        {loan.status === 'Approved' && name && (
          <LoanAccount key={accountKey} application={name} canPay />
        )}

        {(loan.underwriter_remarks || loan.reviewed_by) && (
          <div className="mt-4 rounded-xl bg-white p-6 shadow">
            <h2 className="mb-2 font-semibold">Underwriter review</h2>
            {loan.underwriter_remarks && (
              <p className="mb-2 whitespace-pre-wrap text-sm text-slate-700">{loan.underwriter_remarks}</p>
            )}
            <p className="text-xs text-slate-500">
              {loan.reviewed_by} · {formatDate(loan.reviewed_on)}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------------
  // Staff case workspace — deciding somebody else's case. Sticky left column
  // (who, what, where the evidence stands, and the decision itself) plus a
  // tabbed right column, so approving a loan is not an exercise in scrolling
  // past every panel that does not bear on the decision at hand.
  // ------------------------------------------------------------------------
  const evidenceComplete = missing !== null && missing.length === 0;
  const canSeeFacility = Boolean(user?.is_finance || user?.is_disbursement);

  return (
    <div>
      <Link to={backTo} className="text-sm font-medium text-brand hover:underline">
        ← Back
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{loan.name}</h1>
          <p className="text-sm text-slate-500">{loan.applicant_name}</p>
        </div>
        <StageBadge stage={loan.stage} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {/* ---------------------------------------------------- LEFT: case at a glance */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <Card>
            <CardLabel>Applicant</CardLabel>
            <p className="mt-1 font-semibold text-slate-800">{loan.applicant_name}</p>
            <p className="font-mono text-xs text-slate-500">{loan.applicant_eid ?? 'no e-ID on file'}</p>
            {loan.cluster && (
              <span className="mt-2 inline-flex rounded-full bg-gdb-gold/20 px-2 py-0.5 text-xs font-semibold text-brand-dark">
                Cluster {loan.cluster}
              </span>
            )}
          </Card>

          <Card>
            <CardLabel>Case facts</CardLabel>
            <div className="mt-2">
              <Row label="Amount requested" value={formatGyd(loan.loan_amount)} />
              <Row label="Term" value={`${loan.term_months} months`} />
              <Row label="Monthly income" value={loan.monthly_income ? formatGyd(loan.monthly_income) : '—'} />
              <Row label="Business" value={loan.business_stage || '—'} />
              <Row label="Phone" value={loan.phone || '—'} />
              <Row label="Submitted" value={formatDate(loan.creation)} />
            </div>
            {loan.purpose && (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="text-sm text-slate-500">Purpose</p>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{loan.purpose}</p>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardLabel>Evidence</CardLabel>
              {missing === null ? (
                <span className="text-xs text-slate-400">Checking…</span>
              ) : (
                <Badge tone={evidenceComplete ? 'success' : 'warning'}>
                  {evidenceComplete ? 'Complete' : `${missing.length} outstanding`}
                </Badge>
              )}
            </div>
            {missing && missing.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </Card>

          {(loan.underwriter_remarks || loan.reviewed_by) && (
            <Card>
              <CardLabel>Prior decision</CardLabel>
              {loan.underwriter_remarks && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{loan.underwriter_remarks}</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {loan.reviewed_by} · {formatDate(loan.reviewed_on)}
              </p>
            </Card>
          )}

          {/* The decision itself now lives beside Offer & conditions on the
              right — the next step in the same workflow, not a sidebar
              action severed from what it unlocks. See the "offer" Panel. */}
        </div>

        {/* ---------------------------------------------------------- RIGHT: tabs */}
        <div className="min-w-0 space-y-4">
          <SegmentedControl
            options={STAFF_TABS.map((t) =>
              // Decide lives inside this tab now (see the "offer" Panel
              // below) — a dot here is the only thing telling an underwriter
              // landing on Application that a decision is waiting, now that
              // it is no longer a button sitting in the sidebar the whole
              // time.
              t.id === 'offer' && user?.is_underwriter && reviewable
                ? {
                    ...t,
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        {t.label}
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-gdb-gold"
                          aria-label="Decision needed"
                          title="Decision needed"
                        />
                      </span>
                    ),
                  }
                : t,
            )}
            value={tab}
            onChange={setTab}
          />

          <Panel active={tab === 'application'}>
            <ApplicationSections sections={loan.sections} businessStage={loan.business_stage} />
          </Panel>

          <Panel active={tab === 'evidence'}>
            {name && (
              <DocumentShelf
                key={`docs-${accountKey}`}
                application={name}
                canUpload={false}
                onChange={setMissing}
                title="Documents on this application"
              />
            )}
            {name && loan.status !== 'Draft' && (
              <InformationRequests key={`req-${accountKey}`} application={name} onChange={bump} />
            )}
          </Panel>

          <Panel active={tab === 'verification'}>
            <ApplicantProfile user={loan.applicant} />
            {loan.cluster && <ClusterMembers cluster={loan.cluster} />}
          </Panel>

          <Panel active={tab === 'offer'}>
            {/* Decide here, right next to what a decision unlocks. Approving
                is what turns this same tab into the offer and conditions
                workspace below — same gates as before (is_underwriter,
                reviewable, busy, error), just relocated from the sidebar. */}
            {user?.is_underwriter && reviewable && (
              <Card className="border border-gdb-gold/60">
                <CardLabel>Decision</CardLabel>
                {error && (
                  <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Remarks for the applicant (optional)"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void review('approve')}>
                    Approve
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void review('reject')}>
                    Reject
                  </Button>
                </div>
              </Card>
            )}

            {loan.status === 'Approved' && name ? (
              <>
                {user?.is_underwriter && <IssueOffer application={name} onIssued={bump} />}
                <OfferPanel key={`offer-${accountKey}`} application={name} onExecuted={bump} />
                <Conditions key={`cp-${accountKey}`} application={name} onChange={bump} />
              </>
            ) : (
              !(user?.is_underwriter && reviewable) && (
                <Card>
                  <p className="text-sm text-slate-500">
                    Available once the case is approved — nothing to offer or condition before then.
                  </p>
                </Card>
              )
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
                <p className="text-sm text-slate-500">
                  Booking and release open once the case is approved.
                </p>
              </Card>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
