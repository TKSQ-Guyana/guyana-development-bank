import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call, getList } from '../api';
import { PaymentFile } from '../components/PaymentFile';
import type { LoanApplication, LoanRow } from '../types';
import { formatGyd, formatDate } from '../utils';

/** The disbursement officer's worklist.
 *
 *  Two things hold money up, and they need different actions, so the queue is
 *  split rather than merged into one ambiguous list:
 *
 *    Awaiting booking  — approved, but no Loan exists yet. Needs "Book loan".
 *    Awaiting release  — a Loan exists with an undrawn balance. Needs a draw.
 *
 *  Both halves read through existing surfaces: the approved applications come
 *  from gdb_bank.api.all_loans, the loans straight off Frappe's REST endpoint
 *  for the Loan doctype. No new backend endpoint — the framework scopes the
 *  rows (see permission_query_conditions in gdb_bank/permissions.py).
 *
 *  The undrawn figure here is sanctioned minus disbursed, which is the right
 *  number to triage by but NOT the authority on what may be released: lending
 *  computes that, and the booking panel on the loan page reads it as
 *  `disbursable`. Releasing money stays on that page for exactly that reason.
 */

const AWAITING_RELEASE = ['Sanctioned', 'Partially Disbursed'];

interface Queue {
  booking: LoanApplication[];
  release: LoanRow[];
}

export function Disbursements() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'queue' | 'file'>('queue');
  const [company, setCompany] = useState<string | null>(null);

  useEffect(() => {
    getList<{ name: string }>('Company', { fields: ['name'], limit: 1 })
      .then((rows) => setCompany(rows[0]?.name ?? null))
      .catch(() => setCompany(null));
  }, []);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      call<LoanApplication[]>('gdb_bank.api.all_loans', { status: 'Approved' }),
      getList<LoanRow>('Loan', {
        fields: [
          'name',
          'applicant_name',
          'loan_application',
          'loan_amount',
          'disbursed_amount',
          'status',
          'posting_date',
        ],
        orderBy: 'creation desc',
      }),
    ])
      .then(([approved, loans]) => {
        // An application is awaiting booking only while nothing has been
        // booked against it, so the set of already-booked applications is the
        // filter — taken from the loans themselves rather than guessed at.
        const booked = new Set(loans.map((l) => l.loan_application).filter(Boolean));
        setQueue({
          booking: approved.filter((a) => !booked.has(a.name)),
          release: loans.filter((l) => AWAITING_RELEASE.includes(l.status)),
        });
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const pending = queue ? queue.booking.length + queue.release.length : 0;
  const undrawn = queue
    ? queue.release.reduce((sum, l) => sum + (l.loan_amount - l.disbursed_amount), 0) +
      queue.booking.reduce((sum, a) => sum + a.loan_amount, 0)
    : 0;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Disbursement Queue</h1>
      <p className="mb-6 text-sm text-slate-500">
        Approved loans with money still to be released, and the file that pays them.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {([['queue', 'Queue'], ['file', 'Payment file']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              view === id ? 'bg-gdb-green text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'file' && <PaymentFile company={company} />}

      {view === 'queue' && error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>
      )}
      {view === 'queue' && !error && !queue && <p className="text-slate-500">Loading queue…</p>}

      {view === 'queue' && queue && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-md">
            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs uppercase tracking-wide text-slate-500">Awaiting action</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{pending}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs uppercase tracking-wide text-slate-500">Undrawn</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{formatGyd(undrawn)}</p>
            </div>
          </div>

          <Section
            title="Awaiting release"
            empty="No loan has an undrawn balance."
            caption="A loan exists. Open it to release funds."
          >
            {queue.release.map((l) => (
              <tr key={l.name} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/loans/${l.loan_application ?? ''}`}
                    className="font-medium text-gdb-green hover:underline"
                  >
                    {l.loan_application ?? l.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-slate-400">{l.name}</span>
                </td>
                <td className="px-4 py-3">{l.applicant_name ?? '—'}</td>
                <td className="px-4 py-3">{formatGyd(l.loan_amount)}</td>
                <td className="px-4 py-3">{formatGyd(l.disbursed_amount)}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">
                  {formatGyd(l.loan_amount - l.disbursed_amount)}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {l.status}
                  </span>
                </td>
              </tr>
            ))}
          </Section>

          <Section
            title="Awaiting booking"
            empty="Every approved application has been booked."
            caption="Approved, but no loan exists yet."
          >
            {queue.booking.map((a) => (
              <tr key={a.name} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/loans/${a.name}`} className="font-medium text-gdb-green hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{a.applicant_name}</td>
                <td className="px-4 py-3">{formatGyd(a.loan_amount)}</td>
                <td className="px-4 py-3 text-slate-400">—</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{formatGyd(a.loan_amount)}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(a.reviewed_on ?? a.creation)}</td>
              </tr>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  caption,
  empty,
  children,
}: {
  title: string;
  caption: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <p className="mb-3 text-sm text-slate-500">{caption}</p>
      {children.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Application</th>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Sanctioned</th>
                <th className="px-4 py-3">Disbursed</th>
                <th className="px-4 py-3">Undrawn</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">{children}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
