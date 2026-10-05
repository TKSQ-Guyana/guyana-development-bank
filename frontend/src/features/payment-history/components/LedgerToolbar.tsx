import { Link } from 'react-router-dom';
import type { LoanApplication } from '../../../types';
import type { Period, PeriodId } from '../model/ledger';
import { formatGyd } from '../../../utils';

/** Which facility, over which period, and the two ways out of the screen.
 *
 *  Presentational: it owns no state and fetches nothing. The page decides what
 *  a change means, which is what lets the same toolbar sit above a printed
 *  statement later without being rewritten.
 */

/** How long a purpose may run before it stops naming the loan and starts
 *  burying it. `purpose` is free text an applicant types, and live data has
 *  whole business plans pasted into it — one of those as an option label makes
 *  the whole picker unreadable. Truncated on one line; the amount and the
 *  group are what actually tell two of a borrower's loans apart, so they are
 *  never cut. */
const MAX_PURPOSE = 60;

function facilityLabel(f: LoanApplication): string {
  const purpose = (f.purpose || '').replace(/\s+/g, ' ').trim();
  const named =
    purpose.length > MAX_PURPOSE ? `${purpose.slice(0, MAX_PURPOSE).trimEnd()}…` : purpose;
  return [named || f.name, formatGyd(f.facility_amount), f.cluster]
    .filter(Boolean)
    .join(' · ');
}

interface LedgerToolbarProps {
  facilities: LoanApplication[];
  selected: string;
  onSelect: (application: string) => void;
  periods: Period[];
  period: PeriodId;
  onPeriod: (id: PeriodId) => void;
  onDownload: () => void;
  /** False while there is nothing to export — an empty CSV is a support call. */
  canDownload: boolean;
}

export function LedgerToolbar({
  facilities,
  selected,
  onSelect,
  periods,
  period,
  onPeriod,
  onDownload,
  canDownload,
}: LedgerToolbarProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <label htmlFor="ledger-facility" className="mb-1.5 block text-xs font-medium text-slate-500">
          Loan
        </label>
        <select
          id="ledger-facility"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="w-72 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          {facilities.map((f) => (
            <option key={f.name} value={f.name}>
              {facilityLabel(f)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Period"
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        >
          {periods.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => onPeriod(p.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === p.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload}
          className="text-sm font-medium text-slate-600 underline-offset-4 hover:text-brand hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
        >
          Download CSV
        </button>

        <Link
          to="/statements"
          className="inline-flex items-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#262626]"
        >
          Request a statement
        </Link>
      </div>
    </div>
  );
}
