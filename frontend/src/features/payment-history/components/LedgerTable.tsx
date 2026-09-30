import { Badge } from '../../../components/ui/Badge';
import { DataTable } from '../../../components/ui/DataTable';
import type { LedgerEntry } from '../model/ledger';
import { formatDate, formatGyd } from '../../../utils';

/** The ledger itself: every release and every payment, newest first.
 *
 *  Money is right-aligned and tabular so a column of figures can be read down
 *  without re-reading each one — the whole reason a ledger is a table. That
 *  rule now lives in `DataTable`, which this was the prototype for; the entry
 *  shape and the wording are what remain here.
 *
 *  A release and a payment are told apart by a worded badge, never by colour
 *  alone: a borrower who cannot distinguish the two tones still reads
 *  "Released" and "Settled".
 *
 *  The reference column carries the ledger document's real name. GDB issues no
 *  invoice or receipt PDF today, so no row pretends to link to one — a dead
 *  download is worse than an honest reference a borrower can quote.
 */

export function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  return (
    <DataTable
      caption="Every payment and release recorded on this loan ledger, newest first"
      columns={[
        {
          key: 'date',
          header: 'Date',
          nowrap: true,
          className: 'text-slate-600',
          cell: (e) => formatDate(e.date),
        },
        {
          key: 'description',
          header: 'Description',
          cell: (e) => (
            <>
              <span className="font-medium text-slate-800">{e.description}</span>
              {/* On a cluster facility several members pay into one loan,
                  so who paid is part of the record, not a detail. */}
              {e.payer && (
                <span className="mt-0.5 block text-xs text-slate-400">
                  {e.payer}
                  {e.payerEid ? ` · ${e.payerEid}` : ''}
                </span>
              )}
            </>
          ),
        },
        {
          key: 'reference',
          header: 'Reference',
          nowrap: true,
          className: 'font-mono text-xs text-slate-500',
          cell: (e) => e.id,
        },
        {
          key: 'channel',
          header: 'Channel',
          nowrap: true,
          className: 'text-slate-600',
          cell: (e) => e.channel,
        },
        {
          key: 'amount',
          header: 'Amount',
          align: 'right',
          className: 'font-semibold text-slate-900',
          cell: (e) => formatGyd(e.amount),
        },
        {
          key: 'balance',
          header: 'Balance',
          align: 'right',
          className: 'text-slate-600',
          cell: (e) => formatGyd(e.balance),
        },
        {
          key: 'status',
          header: 'Status',
          cell: (e) => (
            <Badge tone={e.kind === 'release' ? 'brand' : 'success'}>{e.status}</Badge>
          ),
        },
      ]}
      rows={entries}
      rowKey={(e) => e.id}
      minWidth="46rem"
      footnote={`Showing ${entries.length} of ${entries.length} record${
        entries.length === 1 ? '' : 's'
      }`}
      empty="Nothing has been recorded on this ledger yet."
    />
  );
}
