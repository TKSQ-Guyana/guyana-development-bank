import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import type { LoanApplication } from '../types';
import { formatGyd, formatDate } from '../utils';

export function MyLoans() {
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>;
  if (!loans) return <p className="text-slate-500">Loading your applications…</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Loan Applications</h1>
        <Link
          to="/apply"
          className="rounded-md bg-gdb-green px-4 py-2 font-semibold text-white hover:bg-gdb-green-dark"
        >
          Apply for a Loan
        </Link>
      </div>

      {loans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="mb-2 text-lg font-medium text-slate-700">No applications yet</p>
          <p className="mb-4 text-sm text-slate-500">
            Start your first loan application — it only takes a couple of minutes.
          </p>
          <Link
            to="/apply"
            className="inline-block rounded-md bg-gdb-green px-4 py-2 font-semibold text-white hover:bg-gdb-green-dark"
          >
            Apply now
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Application</th>
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
                  <td className="px-4 py-3">{formatGyd(loan.loan_amount)}</td>
                  <td className="px-4 py-3">{loan.term_months} months</td>
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
