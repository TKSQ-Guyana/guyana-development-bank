import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { Badge } from '../components/ui/Badge';
import { DataTable } from '../components/ui/DataTable';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StageBadge } from '../components/ui/Stepper';
import type { LoanApplication, LoanStage } from '../types';
import { formatAge, formatGyd, formatDate } from '../utils';

/** Every stage a submitted case can be sitting in — Draft is excluded because
 *  all_loans never returns one: an application nobody has submitted is not
 *  before the Bank. */
const STAGES: (LoanStage | 'All')[] = ['All', 'Review', 'Approved', 'Signing', 'Disbursed', 'Rejected'];

type SortKey = 'age_desc' | 'age_asc' | 'amount_desc' | 'amount_asc' | 'evidence_first';

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'age_desc', label: 'Oldest in stage first' },
  { id: 'age_asc', label: 'Newest in stage first' },
  { id: 'amount_desc', label: 'Amount: highest first' },
  { id: 'amount_asc', label: 'Amount: lowest first' },
  { id: 'evidence_first', label: 'Missing evidence first' },
];

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
  const [sort, setSort] = useState<SortKey>('age_asc');
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
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'age_asc': {
          // Newest arrival first — the opposite reading of the same stage
          // clock the default view sorts by.
          const av = stageSince(a) ?? '';
          const bv = stageSince(b) ?? '';
          return bv.localeCompare(av);
        }
        case 'amount_desc':
          return b.loan_amount - a.loan_amount;
        case 'amount_asc':
          return a.loan_amount - b.loan_amount;
        case 'evidence_first': {
          const am = a.evidence_missing?.length ?? 0;
          const bm = b.evidence_missing?.length ?? 0;
          return bm - am;
        }
        case 'age_desc':
        default: {
          // Oldest-in-state first — that is the end of the queue a bank
          // should be worried about, not the newest arrival.
          const av = stageSince(a) ?? '';
          const bv = stageSince(b) ?? '';
          return av.localeCompare(bv);
        }
      }
    });
  }, [loans, stage, sort]);

  return (
    <div>
      {/* The layout header already says SME LOAN PROGRAMME / Review queue. */}
      <p className="text-sm text-slate-500">Every citizen loan application submitted to GDB.</p>

      <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={STAGES.map((s) => ({ id: s, label: counts[s] ? `${s} (${counts[s]})` : s }))}
          value={stage}
          onChange={setStage}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!error && !loans && <p className="text-slate-500">Loading queue…</p>}

      {loans && (
        <DataTable
          caption="Every citizen loan application submitted to GDB"
          columns={[
            {
              key: 'application',
              header: 'Application',
              nowrap: true,
              cell: (loan) => (
                <>
                  <Link
                    to={`/loans/${loan.name}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {loan.name}
                  </Link>
                  <span className="block text-xs text-slate-500">{loan.applicant_name}</span>
                </>
              ),
            },
            {
              key: 'eid',
              header: 'e-ID',
              nowrap: true,
              className: 'font-mono text-xs text-slate-500',
              cell: (loan) => loan.applicant_eid ?? '—',
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              className: 'font-medium text-slate-900',
              cell: (loan) => (
                <>
                  {formatGyd(loan.loan_amount)}
                  {loan.approved_amount != null && (
                    <span className="block text-xs font-normal text-slate-500">
                      approved {formatGyd(loan.approved_amount)}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: 'stage',
              header: 'Stage',
              cell: (loan) => <StageBadge stage={loan.stage} />,
            },
            {
              key: 'age',
              header: 'Age in stage',
              nowrap: true,
              className: 'text-slate-600',
              cell: (loan) => (
                <span title={formatDate(stageSince(loan))}>{formatAge(stageSince(loan))}</span>
              ),
            },
            {
              key: 'evidence',
              header: 'Evidence',
              cell: (loan) => {
                const known = loan.evidence_missing !== undefined;
                if (!known) return <span className="text-slate-400">—</span>;
                const complete = loan.evidence_missing!.length === 0;
                return (
                  <Badge tone={complete ? 'success' : 'warning'}>
                    {complete ? 'Complete' : `${loan.evidence_missing!.length} missing`}
                  </Badge>
                );
              },
            },
          ]}
          rows={rows}
          rowKey={(loan) => loan.name}
          minWidth="58rem"
          empty={`No applications${stage !== 'All' ? ` in stage “${stage}”` : ''}.`}
        />
      )}
    </div>
  );
}
