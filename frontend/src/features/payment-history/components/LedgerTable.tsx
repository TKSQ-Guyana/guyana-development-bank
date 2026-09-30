import { Badge } from '../../../components/ui/Badge';
import type { LedgerEntry } from '../model/ledger';
import { formatDate, formatGyd } from '../../../utils';

/** The ledger itself: every release and every payment, newest first.
 *
 *  Money is right-aligned and tabular so a column of figures can be read down
 *  without re-reading each one — the whole reason a ledger is a table.
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="sr-only">
            Every payment and release recorded on this loan ledger, newest first
          </caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Reference</Th>
              <Th>Channel</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Balance</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
              >
                <Td className="whitespace-nowrap text-slate-600">{formatDate(entry.date)}</Td>
                <Td>
                  <span className="font-medium text-slate-800">{entry.description}</span>
                  {/* On a cluster facility several members pay into one loan,
                      so who paid is part of the record, not a detail. */}
                  {entry.payer && (
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {entry.payer}
                      {entry.payerEid ? ` · ${entry.payerEid}` : ''}
                    </span>
                  )}
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-slate-500">{entry.id}</Td>
                <Td className="whitespace-nowrap text-slate-600">{entry.channel}</Td>
                <Td align="right" className="whitespace-nowrap font-semibold tabular-nums text-slate-900">
                  {formatGyd(entry.amount)}
                </Td>
                <Td align="right" className="whitespace-nowrap tabular-nums text-slate-600">
                  {formatGyd(entry.balance)}
                </Td>
                <Td>
                  <Badge tone={entry.kind === 'release' ? 'brand' : 'success'}>{entry.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
        Showing {entries.length} of {entries.length} record{entries.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`px-5 py-3 text-xs font-semibold text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-5 py-3.5 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </td>
  );
}
