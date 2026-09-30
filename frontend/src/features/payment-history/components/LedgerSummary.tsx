import type { ReactNode } from 'react';
import type { LedgerSummary as Summary } from '../model/ledger';
import { formatDate, formatGyd } from '../../../utils';

/** The KPI row above the ledger: four headline numbers, no chart.
 *
 *  A handful of headline figures is a stat-tile row, not a plot — there is
 *  nothing here to compare shapes of. Each tile is one value and its label,
 *  and none of them is worked out on this screen: three come straight off
 *  lending (`total_amount_paid`, `principal_outstanding`, the schedule) and
 *  the fourth is a count of rows.
 *
 *  A figure GDB does not have reads "—", never "G$0". Zero is a fact about a
 *  loan; a blank is a fact about what we know, and a borrower deciding whether
 *  they owe anything must be able to tell the two apart.
 */

function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const money = (value: number | null) => (value === null ? '—' : formatGyd(value));

export function LedgerSummary({ summary, periodLabel }: { summary: Summary; periodLabel: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Total repaid" value={money(summary.totalRepaid)} hint="Life of the loan" />
      <StatTile
        label="Payments recorded"
        value={summary.paymentsRecorded}
        hint={periodLabel.toLowerCase() === 'all' ? 'All time' : periodLabel}
      />
      <StatTile label="Outstanding" value={money(summary.outstanding)} hint="Principal still owed" />
      <StatTile
        label="Next due"
        value={summary.nextDue ? formatDate(summary.nextDue) : '—'}
        hint={summary.nextDue ? undefined : 'No instalment scheduled'}
      />
    </div>
  );
}
