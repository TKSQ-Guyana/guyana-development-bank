import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call, getList } from '../api';
import { PaymentFile } from '../components/PaymentFile';
import { Badge } from '../components/ui/Badge';
import { Card, CardLabel } from '../components/ui/Card';
import { DataTable, TableSection, type Column } from '../components/ui/DataTable';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import type { LoanApplication } from '../types';
import { formatGyd, formatDate } from '../utils';

/** The disbursement officer's worklist.
 *
 *  Three things a case can be, and they need different actions, so the queue
 *  is split rather than merged into one ambiguous list:
 *
 *    Awaiting booking  — approved, but no Loan exists yet. Needs "Book loan".
 *    Awaiting release  — a Loan exists with an undrawn balance. Needs a draw.
 *    Released          — fully drawn. Nothing to do; everything to account for.
 *
 *  That third list is not decoration. Until it existed, a case vanished from
 *  this page the moment its funds went out: the officer who had just moved the
 *  money had no record of having moved it, no route back to the case, and no
 *  figure for what the Bank released today. A worklist that forgets completed
 *  work is not a worklist, it is a to-do list — and for money leaving a bank,
 *  what was released is the part that has to be answerable.
 *
 *  All three halves are ONE read of gdb_bank.api.all_loans, and every figure
 *  on them is served, never worked out here: the offer's approved amount, the
 *  amount lending booked, what it has disbursed, and — as `drawable` — what
 *  lending's get_disbursal_amount says may still be released, the same figure
 *  the release panel offers and Loan Disbursement validates against.
 */

const AWAITING_RELEASE = ['Sanctioned', 'Partially Disbursed'];

interface Queue {
  booking: LoanApplication[];
  release: LoanApplication[];
  released: LoanApplication[];
}

/** Application reference and the loan it became — the first column of every
 *  list here, so it is written once. */
function reference(a: LoanApplication) {
  return (
    <>
      <Link to={`/loans/${a.name}`} className="font-medium text-brand hover:underline">
        {a.name}
      </Link>
      {a.loan && <span className="block font-mono text-xs text-slate-400">{a.loan}</span>}
    </>
  );
}

const APPLICATION: Column<LoanApplication> = {
  key: 'application',
  header: 'Application',
  nowrap: true,
  cell: reference,
};

const APPLICANT: Column<LoanApplication> = {
  key: 'applicant',
  header: 'Applicant',
  cell: (a) => (
    <>
      <span className="block text-slate-700">{a.applicant_name}</span>
      <span className="block font-mono text-xs text-slate-400">{a.applicant_eid ?? 'no e-ID'}</span>
    </>
  ),
};

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
          // Everything with a loan that is no longer awaiting a draw. Closed
          // and written-off facilities land here too, which is correct: this
          // is "money already out", not "money out and still running".
          released: approved.filter(
            (a) => a.loan && a.loan_status && !AWAITING_RELEASE.includes(a.loan_status),
          ),
        }),
      )
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  /** What the Bank has actually paid out across the cases on this page.
   *  Added up from figures lending served, and shown as a total on the list
   *  it totals — not a second opinion about any one of them. */
  const releasedTotal = useMemo(
    () => (queue?.released ?? []).reduce((sum, a) => sum + (a.disbursed_amount ?? 0), 0),
    [queue],
  );
  const undrawnTotal = useMemo(
    () => (queue?.release ?? []).reduce((sum, a) => sum + (a.drawable ?? 0), 0),
    [queue],
  );

  return (
    <div>
      {/* The layout header already says SME LOAN PROGRAMME / Disbursements. */}
      <p className="text-sm text-slate-500">Money going out to borrowers, booked and released.</p>
      <p className="mt-0.5 text-xs text-slate-400">
        Four-eyes rule: the officer who approved a case, and the officer who releases its funds, are
        never the same login — enforced server-side even when one account holds both roles.
      </p>

      <div className="mb-4 mt-3">
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
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-3">
              <CardLabel>Awaiting release</CardLabel>
              <p className="mt-0.5 text-xl font-bold text-slate-900">{queue.release.length}</p>
              <p className="text-xs text-slate-500">{formatGyd(undrawnTotal)} still undrawn</p>
            </Card>
            <Card className="p-3">
              <CardLabel>Awaiting booking</CardLabel>
              <p className="mt-0.5 text-xl font-bold text-slate-900">{queue.booking.length}</p>
              <p className="text-xs text-slate-500">No loan on the books yet</p>
            </Card>
            <Card className="p-3">
              <CardLabel>Released</CardLabel>
              <p className="mt-0.5 text-xl font-bold text-slate-900">{queue.released.length}</p>
              <p className="text-xs text-slate-500">{formatGyd(releasedTotal)} paid out</p>
            </Card>
          </div>

          <TableSection
            title="Awaiting release"
            caption="A loan exists. Open it to release funds. Undrawn is what lending says may still be released."
          >
            <DataTable
              caption="Loans with an undrawn balance, awaiting release"
              columns={[
                APPLICATION,
                APPLICANT,
                {
                  key: 'approved',
                  header: 'Approved',
                  align: 'right',
                  cell: (a) => (a.approved_amount != null ? formatGyd(a.approved_amount) : '—'),
                },
                {
                  key: 'sanctioned',
                  header: 'Sanctioned',
                  align: 'right',
                  cell: (a) => (a.sanctioned_amount != null ? formatGyd(a.sanctioned_amount) : '—'),
                },
                {
                  key: 'disbursed',
                  header: 'Disbursed',
                  align: 'right',
                  cell: (a) => formatGyd(a.disbursed_amount),
                },
                {
                  key: 'undrawn',
                  header: 'Undrawn',
                  align: 'right',
                  className: 'font-semibold text-slate-900',
                  cell: (a) => (a.drawable != null ? formatGyd(a.drawable) : '—'),
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (a) =>
                    a.booked_on_offer === false ? (
                      <Badge tone="danger">Rebook — not on offer terms</Badge>
                    ) : (
                      <Badge tone="warning">{a.loan_status}</Badge>
                    ),
                },
              ]}
              rows={queue.release}
              rowKey={(a) => a.name}
              total={{ applicant: 'Total undrawn', undrawn: formatGyd(undrawnTotal) }}
              minWidth="62rem"
              empty="No loan has an undrawn balance."
            />
          </TableSection>

          <TableSection
            title="Awaiting booking"
            caption="Approved, but no loan exists yet. Booking puts the offer's amount and term into lending."
          >
            <DataTable
              caption="Approved applications with no loan booked yet"
              columns={[
                APPLICATION,
                APPLICANT,
                {
                  key: 'requested',
                  header: 'Requested',
                  align: 'right',
                  cell: (a) => formatGyd(a.loan_amount),
                },
                {
                  key: 'approved',
                  header: 'Approved',
                  align: 'right',
                  className: 'font-semibold text-slate-900',
                  cell: (a) =>
                    a.approved_amount != null ? (
                      formatGyd(a.approved_amount)
                    ) : (
                      // Not a figure, so it does not get a figure's weight:
                      // this case has no executed offer to book against.
                      <span className="font-normal text-amber-700">No live offer</span>
                    ),
                },
                {
                  key: 'term',
                  header: 'Term',
                  align: 'right',
                  cell: (a) => `${a.facility_term} months`,
                },
                {
                  key: 'approved_on',
                  header: 'Approved on',
                  nowrap: true,
                  className: 'text-slate-500',
                  cell: (a) => formatDate(a.reviewed_on ?? a.creation),
                },
              ]}
              rows={queue.booking}
              rowKey={(a) => a.name}
              minWidth="58rem"
              empty="Every approved application has been booked."
            />
          </TableSection>

          <TableSection
            title="Released"
            caption="Funds already paid out. Nothing here needs an action — it is the record of what left the Bank, and the way back to a case after its money has gone."
          >
            <DataTable
              caption="Loans whose funds have been released"
              columns={[
                APPLICATION,
                APPLICANT,
                {
                  key: 'sanctioned',
                  header: 'Sanctioned',
                  align: 'right',
                  cell: (a) => (a.sanctioned_amount != null ? formatGyd(a.sanctioned_amount) : '—'),
                },
                {
                  key: 'disbursed',
                  header: 'Disbursed',
                  align: 'right',
                  className: 'font-semibold text-slate-900',
                  cell: (a) => formatGyd(a.disbursed_amount),
                },
                {
                  key: 'instalment',
                  header: 'Instalment',
                  align: 'right',
                  cell: (a) =>
                    a.monthly_repayment != null ? formatGyd(a.monthly_repayment) : '—',
                },
                {
                  key: 'approved_on',
                  header: 'Decided',
                  nowrap: true,
                  className: 'text-slate-500',
                  cell: (a) => formatDate(a.reviewed_on ?? a.creation),
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (a) => <Badge tone="success">{a.loan_status}</Badge>,
                },
              ]}
              rows={queue.released}
              rowKey={(a) => a.name}
              total={{ applicant: 'Total released', disbursed: formatGyd(releasedTotal) }}
              minWidth="66rem"
              empty="Nothing has been released yet."
            />
          </TableSection>
        </>
      )}
    </div>
  );
}
