import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { DataTable } from '../components/ui/DataTable';
import { Pager } from '../components/ui/Pager';
import { StageBadge } from '../components/ui/Stepper';
import { PAGE_LENGTH, useLoanQueue } from '../shared/useLoanQueue';
import type { LoanApplication, LoanStage } from '../types';
import { formatAge, formatGyd, formatDate } from '../utils';

/** Every stage a submitted case can be sitting in — Draft is excluded because
 *  all_loans never returns one: an application nobody has submitted is not
 *  before the Bank. The tab label is the underwriter's word for the stage. */
const TABS: { id: LoanStage | 'All'; label: string }[] = [
  { id: 'Review', label: 'To review' },
  { id: 'Approved', label: 'Approved' },
  { id: 'Signing', label: 'Offer out' },
  { id: 'Disbursed', label: 'Done' },
  { id: 'Rejected', label: 'Declined' },
  { id: 'All', label: 'All' },
];

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
  const [stage, setStage] = useState<LoanStage | 'All'>('Review');
  const [sort, setSort] = useState<SortKey>('age_asc');

  // The server filters by stage, sorts and counts, and sends one page. The
  // queue grows for as long as the Bank lends, so it is never fetched whole.
  const { page, error, start, setStart } = useLoanQueue({
    stage: stage === 'All' ? undefined : stage,
    sort,
  });
  const counts = page?.counts ?? {};
  const rows = page?.rows;

  return (
    <div>
      <p className="text-sm text-slate-500">Cases submitted to GDB. Pick a row to open the case.</p>

      <div className="mb-3 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={stage === t.id}
              onClick={() => setStage(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                stage === t.id ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {t.label}
              {counts[t.id] ? <span className="ml-1.5 opacity-80">{counts[t.id]}</span> : null}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!error && !rows && <p className="text-slate-500">Loading queue…</p>}

      {rows && (
        <DataTable
          caption="Loan applications submitted to GDB"
          columns={[
            {
              key: 'application',
              header: 'Application',
              cell: (loan) => (
                <>
                  <Link to={`/loans/${loan.name}`} className="font-medium text-brand hover:underline">
                    {loan.applicant_name}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {loan.business_name ? `${loan.business_name} · ` : ''}
                    {loan.name}
                  </span>
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
              key: 'product',
              header: 'Product',
              nowrap: true,
              className: 'text-slate-600',
              // A Quick Loan is visible here but decided by a Disbursement
              // Officer (decide_quick_loan).
              cell: (loan) => (loan.product === 'quick' ? 'Quick Loan' : 'SME Loan'),
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
              header: 'Age',
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
                if (loan.evidence_missing === undefined) return <span className="text-slate-400">—</span>;
                const n = loan.evidence_missing.length;
                return <Badge tone={n ? 'warning' : 'success'}>{n ? `${n} missing` : 'Complete'}</Badge>;
              },
            },
          ]}
          rows={rows}
          rowKey={(loan) => loan.name}
          minWidth="58rem"
          footnote={false}
          empty="No cases here."
        />
      )}
      {page && <Pager start={start} pageLength={PAGE_LENGTH} total={page.total} onChange={setStart} />}
    </div>
  );
}
