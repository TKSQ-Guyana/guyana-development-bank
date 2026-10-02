import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getList } from "../api";
import { PaymentFile } from "../components/PaymentFile";
import { Badge } from "../components/ui/Badge";
import { Card, CardLabel } from "../components/ui/Card";
import {
  DataTable,
  TableSection,
  type Column,
} from "../components/ui/DataTable";
import { Pager } from "../components/ui/Pager";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { PAGE_LENGTH, useLoanQueue } from "../shared/useLoanQueue";
import type { LoanApplication } from "../types";
import { formatGyd, formatDate } from "../utils";

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
 *  Each list is its own page of gdb_bank.api.all_loans — the server decides
 *  which list a case is on and sends one page of it, because "Released" grows
 *  for as long as the Bank lends. Every figure is served, never worked out
 *  here: the offer's approved amount, the amount lending booked, what it has
 *  disbursed, and — as `drawable` — what lending's get_disbursal_amount says
 *  may still be released, the same figure the release panel offers and Loan
 *  Disbursement validates against. The counts and totals on the cards are the
 *  server's too, and cover every case, not only the page on screen.
 */

/** Application reference and the loan it became — the first column of every
 *  list here, so it is written once. */
function reference(a: LoanApplication) {
  return (
    <>
      <Link
        to={`/loans/${a.name}`}
        className="font-medium text-brand hover:underline"
      >
        {a.name}
      </Link>
      {a.loan && (
        <span className="block font-mono text-xs text-slate-400">{a.loan}</span>
      )}
    </>
  );
}

const APPLICATION: Column<LoanApplication> = {
  key: "application",
  header: "Application",
  nowrap: true,
  cell: reference,
};

const APPLICANT: Column<LoanApplication> = {
  key: "applicant",
  header: "Applicant",
  cell: (a) => (
    <>
      <span className="block text-slate-700">{a.applicant_name}</span>
      <span className="block font-mono text-xs text-slate-400">
        {a.applicant_eid ?? "no e-ID"}
      </span>
    </>
  ),
};

export function Disbursements() {
  const [view, setView] = useState<"queue" | "file">("queue");
  const [company, setCompany] = useState<string | null>(null);

  useEffect(() => {
    getList<{ name: string }>("Company", { fields: ["name"], limit: 1 })
      .then((rows) => setCompany(rows[0]?.name ?? null))
      .catch(() => setCompany(null));
  }, []);

  // Three lists, three pages. "Released" is everything with a loan that is no
  // longer awaiting a draw — closed and written-off facilities land there
  // too, which is correct: it is "money already out", not "still running".
  const release = useLoanQueue({ queue: "release" });
  const booking = useLoanQueue({ queue: "booking" });
  const released = useLoanQueue({ queue: "released" });

  const lists = [release, booking, released];
  const error = lists.find((l) => l.error)?.error ?? null;
  // Every response carries the counts and totals for the whole queue, so the
  // cards read them from whichever arrived.
  const summary = lists.find((l) => l.page)?.page ?? null;
  const loaded = lists.every((l) => l.page);

  return (
    <div>
      {/* The layout header already says SME LOAN PROGRAMME / Disbursements. */}
      <p className="text-sm text-slate-500">
        Money going out to borrowers, booked and released.
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        Four-eyes rule: the officer who approved a case, and the officer who
        releases its funds, are never the same login — enforced server-side even
        when one account holds both roles. Quick Loans included.
      </p>

      <div className="mb-4 mt-3">
        <SegmentedControl
          options={[
            { id: "queue", label: "Queue" },
            { id: "file", label: "Payment file" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {view === "file" && <PaymentFile company={company} />}

      {view === "queue" && error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-red-700">
          {error}
        </p>
      )}
      {view === "queue" && !error && !loaded && (
        <p className="text-slate-500">Loading queue…</p>
      )}

      {view === "queue" && loaded && summary && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-3">
              <CardLabel>Awaiting release</CardLabel>
              <p className="mt-0.5 text-xl font-bold text-slate-900">
                {summary.queues.release}
              </p>
              <p className="text-xs text-slate-500">Booked, not fully drawn</p>
            </Card>
            <Card className="p-3">
              <CardLabel>Awaiting booking</CardLabel>
              <p className="mt-0.5 text-xl font-bold text-slate-900">
                {summary.queues.booking}
              </p>
              <p className="text-xs text-slate-500">No loan on the books yet</p>
            </Card>
            <Card className="p-3">
              <CardLabel>Released</CardLabel>
              <p className="mt-0.5 text-xl font-bold text-slate-900">
                {summary.queues.released}
              </p>
              <p className="text-xs text-slate-500">
                {formatGyd(summary.totals.released_paid)} paid out
              </p>
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
                  key: "approved",
                  header: "Approved",
                  align: "right",
                  cell: (a) =>
                    a.approved_amount != null
                      ? formatGyd(a.approved_amount)
                      : "—",
                },
                {
                  key: "sanctioned",
                  header: "Sanctioned",
                  align: "right",
                  cell: (a) =>
                    a.sanctioned_amount != null
                      ? formatGyd(a.sanctioned_amount)
                      : "—",
                },
                {
                  key: "disbursed",
                  header: "Disbursed",
                  align: "right",
                  cell: (a) => formatGyd(a.disbursed_amount),
                },
                {
                  key: "undrawn",
                  header: "Undrawn",
                  align: "right",
                  className: "font-semibold text-slate-900",
                  cell: (a) =>
                    a.drawable != null ? formatGyd(a.drawable) : "—",
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (a) =>
                    a.booked_on_offer === false ? (
                      <Badge tone="danger">Rebook — not on offer terms</Badge>
                    ) : (
                      <Badge tone="warning">{a.loan_status}</Badge>
                    ),
                },
              ]}
              rows={release.page?.rows ?? []}
              rowKey={(a) => a.name}
              minWidth="62rem"
              footnote={false}
              empty="No loan has an undrawn balance."
            />
            <Pager
              start={release.start}
              pageLength={PAGE_LENGTH}
              total={release.page?.total ?? 0}
              onChange={release.setStart}
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
                  key: "requested",
                  header: "Requested",
                  align: "right",
                  cell: (a) => formatGyd(a.loan_amount),
                },
                {
                  key: "approved",
                  header: "Approved",
                  align: "right",
                  className: "font-semibold text-slate-900",
                  cell: (a) =>
                    a.approved_amount != null ? (
                      formatGyd(a.approved_amount)
                    ) : (
                      // Not a figure, so it does not get a figure's weight:
                      // this case has no executed offer to book against.
                      <span className="font-normal text-amber-700">
                        No live offer
                      </span>
                    ),
                },
                {
                  key: "term",
                  header: "Term",
                  align: "right",
                  cell: (a) => `${a.facility_term} months`,
                },
                {
                  key: "approved_on",
                  header: "Approved on",
                  nowrap: true,
                  className: "text-slate-500",
                  cell: (a) => formatDate(a.reviewed_on ?? a.creation),
                },
              ]}
              rows={booking.page?.rows ?? []}
              rowKey={(a) => a.name}
              minWidth="58rem"
              footnote={false}
              empty="Every approved application has been booked."
            />
            <Pager
              start={booking.start}
              pageLength={PAGE_LENGTH}
              total={booking.page?.total ?? 0}
              onChange={booking.setStart}
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
                  key: "sanctioned",
                  header: "Sanctioned",
                  align: "right",
                  cell: (a) =>
                    a.sanctioned_amount != null
                      ? formatGyd(a.sanctioned_amount)
                      : "—",
                },
                {
                  key: "disbursed",
                  header: "Disbursed",
                  align: "right",
                  className: "font-semibold text-slate-900",
                  cell: (a) => formatGyd(a.disbursed_amount),
                },
                {
                  key: "instalment",
                  header: "Instalment",
                  align: "right",
                  cell: (a) =>
                    a.monthly_repayment != null
                      ? formatGyd(a.monthly_repayment)
                      : "—",
                },
                {
                  key: "approved_on",
                  header: "Decided",
                  nowrap: true,
                  className: "text-slate-500",
                  cell: (a) => formatDate(a.reviewed_on ?? a.creation),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (a) => <Badge tone="success">{a.loan_status}</Badge>,
                },
              ]}
              rows={released.page?.rows ?? []}
              rowKey={(a) => a.name}
              // The server's total for every released loan, not this page's.
              total={{
                applicant: "Total released",
                disbursed: formatGyd(summary.totals.released_paid),
              }}
              minWidth="66rem"
              footnote={false}
              empty="Nothing has been released yet."
            />
            <Pager
              start={released.start}
              pageLength={PAGE_LENGTH}
              total={released.page?.total ?? 0}
              onChange={released.setStart}
            />
          </TableSection>
        </>
      )}
    </div>
  );
}
