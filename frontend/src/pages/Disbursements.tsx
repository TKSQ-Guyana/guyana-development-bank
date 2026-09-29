import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call, getList } from '../api';
import { PaymentFile } from '../components/PaymentFile';
import { Badge } from '../components/ui/Badge';
import { Card, CardLabel } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import type { LoanApplication } from '../types';
import { formatGyd, formatDate } from '../utils';

/** The disbursement officer's worklist.
 *
 *  Two things hold money up, and they need different actions, so the queue is
 *  split rather than merged into one ambiguous list:
 *
 *    Awaiting booking  — approved, but no Loan exists yet. Needs "Book loan".
 *    Awaiting release  — a Loan exists with an undrawn balance. Needs a draw.
 *
 *  Both halves are one read of gdb_bank.api.all_loans, and every figure on
 *  them is served, never worked out here: the offer's approved amount, the
 *  amount lending booked, what it has disbursed, and — as `drawable` — what
 *  lending's get_disbursal_amount says may still be released, the same figure
 *  the release panel offers and Loan Disbursement validates against.
 */

const AWAITING_RELEASE = ['Sanctioned', 'Partially Disbursed'];

interface Queue {
  booking: LoanApplication[];
  release: LoanApplication[];
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
    call<LoanApplication[]>('gdb_bank.api.all_loans', { status: 'Approved' })
      .then((approved) =>
        setQueue({
          booking: approved.filter((a) => !a.loan),
          release: approved.filter((a) => a.loan_status && AWAITING_RELEASE.includes(a.loan_status)),
        }),
      )
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Disbursement Queue</h1>
      <p className="mb-1 text-sm text-slate-500">Money going out to borrowers, booked and released.</p>
      <p className="mb-6 text-xs text-slate-400">
        Four-eyes rule: the officer who approved a case, and the officer who releases its funds, are
        never the same login — enforced server-side even when one account holds both roles.
      </p>

      <div className="mb-5">
        <SegmentedControl
          options={[
            { id: 'queue', label: 'Queue' },
            { id: 'file', label: 'Payment file' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {view === 'file' && <PaymentFile company={company} />}

      {view === 'queue' && error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>
      )}
      {view === 'queue' && !error && !queue && <p className="text-slate-500">Loading queue…</p>}

      {view === 'queue' && queue && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-md">
            <Card className="p-4">
              <CardLabel>Awaiting release</CardLabel>
              <p className="mt-1 text-2xl font-bold text-slate-800">{queue.release.length}</p>
            </Card>
            <Card className="p-4">
              <CardLabel>Awaiting booking</CardLabel>
              <p className="mt-1 text-2xl font-bold text-slate-800">{queue.booking.length}</p>
            </Card>
          </div>

          <Section
            title="Awaiting release"
            empty="No loan has an undrawn balance."
            caption="A loan exists. Open it to release funds. Undrawn is what lending says may still be released."
            amountHeads={['Approved', 'Sanctioned', 'Disbursed', 'Undrawn']}
          >
            {queue.release.map((a) => (
              <tr key={a.name} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/loans/${a.name}`} className="font-medium text-brand hover:underline">
                    {a.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-slate-400">{a.loan}</span>
                </td>
                <td className="px-4 py-3">{a.applicant_name}</td>
                <td className="px-4 py-3">
                  {a.approved_amount != null ? formatGyd(a.approved_amount) : '—'}
                </td>
                <td className="px-4 py-3">
                  {a.sanctioned_amount != null ? formatGyd(a.sanctioned_amount) : '—'}
                </td>
                <td className="px-4 py-3">{formatGyd(a.disbursed_amount)}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">
                  {a.drawable != null ? formatGyd(a.drawable) : '—'}
                </td>
                <td className="px-4 py-3">
                  {a.booked_on_offer === false ? (
                    <Badge tone="danger">Rebook — not on offer terms</Badge>
                  ) : (
                    <Badge tone="warning">{a.loan_status}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Section>

          <Section
            title="Awaiting booking"
            empty="Every approved application has been booked."
            caption="Approved, but no loan exists yet. Booking puts the offer's amount and term into lending."
            amountHeads={['Requested', 'Approved', 'Term', 'Approved on']}
          >
            {queue.booking.map((a) => (
              <tr key={a.name} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/loans/${a.name}`} className="font-medium text-brand hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{a.applicant_name}</td>
                <td className="px-4 py-3">{formatGyd(a.loan_amount)}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">
                  {a.approved_amount != null ? formatGyd(a.approved_amount) : 'No live offer'}
                </td>
                <td className="px-4 py-3">{a.facility_term} months</td>
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
  amountHeads,
  children,
}: {
  title: string;
  caption: string;
  empty: string;
  /** The four headings between Applicant and the last column. */
  amountHeads: [string, string, string, string];
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
                {amountHeads.map((h) => (
                  <th key={h} className="px-4 py-3">
                    {h}
                  </th>
                ))}
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
