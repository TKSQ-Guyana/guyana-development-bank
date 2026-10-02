import { useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../../api';
import { useAuth } from '../../auth';
import { ApplicationSections } from '../../components/ApplicationSections';
import { DocumentShelf } from '../../components/DocumentShelf';
import { InformationRequests } from '../../components/InformationRequests';
import { LoanAccount } from '../../components/LoanAccount';
import { OfferPanel } from '../../components/OfferPanel';
import { Notice } from '../../components/apply/fields';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { Fold } from '../../components/ui/Fold';
import { Badge } from '../../components/ui/Badge';
import { StageBadge, Stepper } from '../../components/ui/Stepper';
import { OFFICER_SUBMITTED, submittedByOfficer } from '../field-officer/model/desk';
import type { LoanApplication } from '../../types';
import { formatDate, formatGyd } from '../../utils';
import { YourPartCard } from '../personal-financials/YourPartCard';

/** The applicant's own case — or a group member's view of the head's — laid
 *  out by stage: what to act on now comes first, and once the application is
 *  sent it folds away underneath as reference. */
export function ApplicantCaseView({
  loan,
  backTo,
  onChange,
}: {
  loan: LoanApplication;
  backTo: string;
  /** Re-read the case after anything that can move its stage. */
  onChange: () => void;
}) {
  const { user } = useAuth();
  const [accountKey, setAccountKey] = useState(0);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = loan.applicant === user?.user;
  const groupMember = Boolean(loan.cluster) && !mine;
  const { stage } = loan;
  const decided = stage === 'Approved' || stage === 'Rejected';

  const refresh = () => {
    setAccountKey((k) => k + 1);
    onChange();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.api.submit_application', { name: loan.name });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  };

  const shelf = (
    <DocumentShelf
      key={`docs-${accountKey}`}
      application={loan.name}
      onChange={setMissing}
      title="Documents on this application"
    />
  );
  const offer = <OfferPanel key={`offer-${accountKey}`} application={loan.name} onExecuted={refresh} />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to={backTo} className="text-sm font-medium text-brand hover:underline">
        ← Back
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{loan.name}</h1>
        <span className="flex flex-wrap gap-2">
          {submittedByOfficer(loan) && <Badge tone="brand">{OFFICER_SUBMITTED}</Badge>}
          <StageBadge stage={stage} />
        </span>
      </div>

      <Card>
        <Stepper stage={stage} label={loan.stage_label} />
      </Card>

      {/* A Field Officer filled or submitted this with the applicant's consent:
          the applicant is always told which. */}
      {loan.submitted_by && loan.submitted_by !== loan.applicant ? (
        <Notice tone="info">
          Submitted for you by {loan.submitted_by_name ?? 'a GDB Field Officer'} on {formatDate(loan.submitted_on ?? null)}.
        </Notice>
      ) : (
        loan.assisted_by_name && <Notice tone="info">Prepared with {loan.assisted_by_name}, GDB Field Officer.</Notice>
      )}

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}

      {groupMember && <YourPartCard application={loan.name} />}

      {stage === 'Draft' ? (
        <>
          <ApplicationDetails loan={loan} />
          {mine && shelf}
          {mine && (
            <Card>
              <h2 className="mb-2 font-semibold">Not yet submitted</h2>
              {loan.product === 'quick' ? (
                // A Quick Loan is submitted with its terms and the credit-check
                // consent accepted, which only its own form asks for — a bare
                // submit here is refused ("Accept the terms to submit.").
                <>
                  <p className="mb-3 text-sm text-slate-600">Check it, accept the terms and submit.</p>
                  <Link
                    to={`/apply/quick/${loan.name}`}
                    className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 hover:bg-brand-dark"
                  >
                    Check and submit
                  </Link>
                </>
              ) : (
                <>
                  <p className="mb-3 text-sm text-slate-600">
                    {missing && missing.length > 0
                      ? `You can submit now. GDB will ask for your ${missing.join(', ')} during review.`
                      : 'Everything GDB expects is attached. Submit when you are ready.'}
                  </p>
                  <Button disabled={busy} onClick={() => void submit()}>
                    {busy ? 'Submitting…' : 'Submit application'}
                  </Button>
                </>
              )}
            </Card>
          )}
        </>
      ) : (
        <>
          <InformationRequests key={`req-${accountKey}`} application={loan.name} onChange={refresh} />
          {stage === 'Review' && mine && shelf}
          {decided && <Decision loan={loan} />}
          {/* A declined or lapsed offer stays readable beside the decision. */}
          {stage === 'Approved' && loan.offer_status && offer}
          {stage === 'Signing' && offer}
          {stage === 'Disbursed' && (
            <>
              <LoanAccount key={accountKey} application={loan.name} canPay />
              <Fold title="Letter of Offer">{offer}</Fold>
            </>
          )}

          <Fold title="Application details">
            <ApplicationDetails loan={loan} />
            {mine && stage !== 'Review' && shelf}
            {!decided && loan.reviewed_on && <Decision loan={loan} />}
          </Fold>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** What was applied for. A group member is sent neither the head's phone nor
 *  income, and a group case has no single applicant income to show. */
function ApplicationDetails({ loan }: { loan: LoanApplication }) {
  const quick = loan.product === 'quick';
  // The Quick Loan form's own answers (sections.trade_*) — the same rows the
  // underwriter reads on pages/LoanDetail, whoever filled them in.
  const trade = (key: string) => (loan.sections?.[key] as string | null) || '—';
  return (
    <>
      <Card>
        <Row
          label="Applicant"
          value={
            <>
              {loan.applicant_name}
              <span className="ml-2 font-mono text-xs text-slate-500">{loan.applicant_eid ?? 'no e-ID on file'}</span>
            </>
          }
        />
        {loan.cluster && <Row label="Group" value={loan.cluster} />}
        <Row label="Amount requested" value={formatGyd(loan.loan_amount)} />
        <Row label="Term requested" value={`${loan.term_months} months`} />
        {loan.approved_amount != null && (
          <Row
            label="Approved by GDB"
            value={`${formatGyd(loan.approved_amount)} over ${loan.approved_term} months`}
          />
        )}
        {loan.disbursed_amount > 0 && (
          <Row label="Disbursed" value={formatGyd(loan.disbursed_amount)} />
        )}
        {loan.monthly_repayment != null && loan.stage !== 'Draft' && (
          <Row label="Monthly repayment" value={formatGyd(loan.monthly_repayment)} />
        )}
        {!loan.cluster && loan.monthly_income > 0 && (
          <Row label="Monthly income" value={formatGyd(loan.monthly_income)} />
        )}
        {loan.phone && <Row label="Phone" value={loan.phone} />}
        <Row label="Started on" value={formatDate(loan.creation)} />
        {quick && loan.terms_accepted_on && <Row label="Terms accepted" value={formatDate(loan.terms_accepted_on)} />}
        <div className="py-2 text-sm">
          <span className="text-slate-500">Purpose</span>
          <p className="mt-1 whitespace-pre-wrap font-medium text-slate-800">{loan.purpose}</p>
        </div>
      </Card>
      {quick && (
        <Card>
          <CardLabel>Business</CardLabel>
          <Row label="Business name" value={loan.business_name || '—'} />
          <Row label="What the business sells or does" value={trade('trade_activity')} />
          <Row label="Region" value={trade('trade_region')} />
          <Row label="In business" value={trade('trading_since')} />
          <Row label="Business location" value={trade('trade_location')} />
        </Card>
      )}
      {/* The SME plan's sections; a Quick Loan asks none of them. */}
      {loan.stage !== 'Draft' && !quick && (
        <ApplicationSections
          sections={loan.sections}
          businessStage={loan.business_stage}
          useOfFunds={loan.use_of_funds ?? []}
          useOfFundsTotal={loan.use_of_funds_total}
        />
      )}
    </>
  );
}

/** GDB's credit decision, as the applicant is told it: no officer named. */
function Decision({ loan }: { loan: LoanApplication }) {
  return (
    <Card>
      <CardLabel>GDB decision</CardLabel>
      <p className="mt-1 font-semibold text-slate-900">
        {loan.status === 'Rejected' ? 'Not approved' : 'Approved'}
        {loan.reviewed_on ? ` · ${formatDate(loan.reviewed_on)}` : ''}
      </p>
      {loan.underwriter_remarks && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{loan.underwriter_remarks}</p>
      )}
    </Card>
  );
}
