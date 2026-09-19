import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { Badge } from '../components/ui/Badge';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge } from '../components/ui/Stepper';
import type { LoanApplication, LoanStage } from '../types';
import { formatAge, formatGyd, formatDate } from '../utils';

/** Every stage a submitted case can be sitting in — Draft is excluded because
 *  all_loans never returns one: an application nobody has submitted is not
 *  before the Bank. */
const STAGES: (LoanStage | 'All')[] = ['All', 'Review', 'Approved', 'Signing', 'Disbursed', 'Rejected'];

/** When this case entered the stage it is in now, for the age column. The
 *  server does not (yet) timestamp a stage transition directly, so this reads
 *  the nearest fact it does timestamp: submission for a case still in Review,
 *  the decision for everything after it. Approximate on purpose — it tells an
 *  underwriter which end of the queue is going stale, not a precise SLA
 *  clock. */
function stageSince(loan: LoanApplication): string | null {
  if (loan.stage === 'Review') return loan.creation;
  return loan.reviewed_on ?? loan.creation;
}

export function Review() {
  const [stage, setStage] = useState<(typeof STAGES)[number]>('All');
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One fetch, not one per filter: every stage after the decision is still
  // status "Approved" underneath (Signing and Disbursed are derived), so the
  // stage filter has to run client-side against the server's own `stage`
  // field rather than ask the server to distinguish them by status.
  useEffect(() => {
    setLoans(null);
    call<LoanApplication[]>('gdb_bank.api.all_loans', {})
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: loans?.length ?? 0 };
    for (const l of loans ?? []) c[l.stage] = (c[l.stage] ?? 0) + 1;
    return c;
  }, [loans]);

  const rows = useMemo(() => {
    const filtered = stage === 'All' ? (loans ?? []) : (loans ?? []).filter((l) => l.stage === stage);
    // Oldest-in-state first — that is the end of the queue a bank should be
    // worried about, not the newest arrival.
    return [...filtered].sort((a, b) => {
      const av = stageSince(a) ?? '';
      const bv = stageSince(b) ?? '';
      return av.localeCompare(bv);
    });
  }, [loans, stage]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Application Review Queue</h1>
      <p className="mb-6 text-sm text-slate-500">Every citizen loan application submitted to GDB, oldest in its stage first.</p>

      <div className="mb-4">
        <SegmentedControl
          options={STAGES.map((s) => ({ id: s, label: counts[s] ? `${s} (${counts[s]})` : s }))}
          value={stage}
          onChange={setStage}
        />
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!error && !loans && <p className="text-slate-500">Loading queue…</p>}
      {loans && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          No applications{stage !== 'All' ? ` in stage “${stage}”` : ''}.
        </p>
      )}

      {loans && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-white shadow">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Application</th>
                <th className="px-4 py-3">e-ID</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Age in stage</th>
                <th className="px-4 py-3">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((loan) => {
                const evidenceKnown = loan.evidence_missing !== undefined;
                const evidenceComplete = evidenceKnown && loan.evidence_missing!.length === 0;
                return (
                  <tr key={loan.name} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/loans/${loan.name}`} className="font-medium text-brand hover:underline">
                        {loan.name}
                      </Link>
                      <p className="text-xs text-slate-500">{loan.applicant_name}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {loan.applicant_eid ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-800">
                      {formatGyd(loan.loan_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={loan.stage} />
                    </td>
                    <td className="px-4 py-3 text-slate-600" title={formatDate(stageSince(loan))}>
                      {formatAge(stageSince(loan))}
                    </td>
                    <td className="px-4 py-3">
                      {!evidenceKnown ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <Badge tone={evidenceComplete ? 'success' : 'warning'}>
                          {evidenceComplete ? 'Complete' : `${loan.evidence_missing!.length} missing`}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
