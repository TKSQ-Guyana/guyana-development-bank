import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import type { LoanApplication, LoanStatus } from '../types';
import { formatGyd, formatDate } from '../utils';

const TABS: (LoanStatus | 'All')[] = ['All', 'Submitted', 'Under Review', 'Approved', 'Rejected'];

export function Review() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('All');
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoans(null);
    call<LoanApplication[]>('gdb_bank.api.all_loans', tab === 'All' ? {} : { status: tab })
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, [tab]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Application Review Queue</h1>
      <p className="mb-6 text-sm text-slate-500">All citizen loan applications submitted to GDB.</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-gdb-green text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!error && !loans && <p className="text-slate-500">Loading queue…</p>}
      {loans && loans.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          No applications{tab !== 'All' ? ` in status “${tab}”` : ''}.
        </p>
      )}

      {loans && loans.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-white shadow">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Application</th>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loans.map((loan) => (
                <tr key={loan.name} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/loans/${loan.name}`} className="font-medium text-gdb-green hover:underline">
                      {loan.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{loan.applicant_name}</td>
                  <td className="px-4 py-3">{formatGyd(loan.loan_amount)}</td>
                  <td className="px-4 py-3">{loan.term_months} mo</td>
                  <td className="px-4 py-3">{formatDate(loan.creation)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={loan.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
