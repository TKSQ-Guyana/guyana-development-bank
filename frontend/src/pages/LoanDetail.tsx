import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { Disbursement } from '../components/Disbursement';
import { LoanAccount } from '../components/LoanAccount';
import { OfferPanel } from '../components/OfferPanel';
import { ApplicantProfile } from '../components/ApplicantProfile';
import { ClusterMembers } from '../components/ClusterMembers';
import { Conditions } from '../components/Conditions';
import { DocumentShelf } from '../components/DocumentShelf';
import { InformationRequests } from '../components/InformationRequests';
import { IssueOffer } from '../components/IssueOffer';
import { StatusBadge } from '../components/StatusBadge';
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

export function LoanDetail() {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const [loan, setLoan] = useState<LoanApplication | null>(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The server's list of expected documents not yet on file, handed up by the
  // shelf. Only ever displayed — it gates nothing, on either side of the desk.
  const [missing, setMissing] = useState<string[]>([]);
  // Bumped when the bank books or disburses, so the borrower-facing account
  // below remounts and refetches instead of showing a stale schedule.
  const [accountKey, setAccountKey] = useState(0);

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
  // Staff read the case; only the borrower pays it, and only finance releases
  // it. Both rules are the server's — these flags decide what to draw.
  const isStaff = Boolean(user?.is_underwriter || user?.is_finance);

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={user?.is_underwriter ? '/review' : '/'} className="text-sm text-gdb-green hover:underline">
        ← Back
      </Link>
      <div className="mt-2 mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{loan.name}</h1>
        <StatusBadge status={loan.status} />
      </div>

      <div className="rounded-xl bg-white p-6 shadow">
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
      </div>

      {/* Who the applicant is, asserted and declared side by side. Staff only:
          the applicant has this on their own My Details page, where they can
          edit the half that is theirs. */}
      {isStaff && <ApplicantProfile user={loan.applicant} />}

      {/* A cluster head applies for the group, so the group is part of the
          case: who they are, and what each of them has filed. */}
      {isStaff && loan.cluster && <ClusterMembers cluster={loan.cluster} />}

      {/* The evidence the case is decided on, and anything the Bank has asked
          for since. Both sides read the same shelf: the applicant uploads and
          replaces, the underwriter accepts or rejects each item. */}
      {name && (
        <DocumentShelf
          key={`docs-${accountKey}`}
          application={name}
          canUpload={!isStaff && mine}
          onChange={setMissing}
          title="Documents on this application"
        />
      )}

      {/* Resume point for a draft. The shelf sits above it and tells the
          applicant what GDB will want — it no longer holds the button down. */}
      {isDraft && mine && (
        <div className="mt-4 rounded-xl border border-gdb-gold/60 bg-white p-6 shadow">
          <h2 className="mb-2 font-semibold">Not yet submitted</h2>
          <p className="mb-3 text-sm text-slate-600">
            {missing.length > 0
              ? `You can submit now. GDB will ask for your ${missing.join(', ')} during review — attaching it above first usually means a faster decision.`
              : 'Everything GDB expects is attached. Submit when you are ready — an underwriter reviews it next.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitDraft()}
            className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      )}

      {name && loan.status !== 'Draft' && (
        <InformationRequests
          key={`req-${accountKey}`}
          application={name}
          onChange={() => setAccountKey((k) => k + 1)}
        />
      )}

      {/* Offer before money. An approval is a decision; the accepted Letter
          of Offer is the agreement, and booking waits on it. */}
      {loan.status === 'Approved' && name && (
        <OfferPanel
          key={`offer-${accountKey}`}
          application={name}
          onExecuted={() => setAccountKey((k) => k + 1)}
        />
      )}

      {loan.status === 'Approved' && name && user?.is_underwriter && (
        <IssueOffer application={name} onIssued={() => setAccountKey((k) => k + 1)} />
      )}

      {/* Conditions precedent sit between the accepted offer and release, so
          they read between them here too. */}
      {loan.status === 'Approved' && name && (
        <Conditions
          key={`cp-${accountKey}`}
          application={name}
          onChange={() => setAccountKey((k) => k + 1)}
        />
      )}

      {/* Booking is the underwriter's, release is finance's — the panel shows
          each officer only the half that is theirs. */}
      {loan.status === 'Approved' && name && isStaff && (
        <Disbursement application={name} onChange={() => setAccountKey((k) => k + 1)} />
      )}

      {/* The ledger panel is for the borrower and for finance. An underwriter
          decides the case; what is drawn and repaid afterwards is not their
          screen. Cluster members reach the head's facility here too — they are
          not staff, so the same branch carries them.
          DISPLAY ONLY: `api.loan_account` still answers any staff caller, so
          this hides the panel rather than withholding the data. */}
      {loan.status === 'Approved' && name && (!isStaff || user?.is_finance) && (
        <LoanAccount key={accountKey} application={name} canPay={!isStaff} />
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

      {user?.is_underwriter && reviewable && (
        <div className="mt-4 rounded-xl border border-gdb-gold/60 bg-white p-6 shadow">
          <h2 className="mb-3 font-semibold">Underwriter actions</h2>
          {error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Remarks for the applicant (optional)"
            className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => void review('approve')}
              className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => void review('reject')}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
