import type { ReportColumn } from '../api';
import type { Column } from '../components/ui/DataTable';
import { formatGyd } from '../utils';

/** Frappe's report columns, turned into `DataTable` columns.
 *
 *  Portfolio and Ledger both render ERPNext's own script reports, and both had
 *  grown their own near-identical `Cell` for the job — same currency set, same
 *  em-dash for a blank, diverging on everything else. The interesting part was
 *  never the mapping; it was the two rules a Frappe report needs and neither
 *  page applied:
 *
 *  1. An amount, a date and a document reference go on ONE LINE. Without that
 *     `ACC-LOAN-2026-00001` wraps to four lines in a narrow column and a
 *     49-row report becomes unreadable — which is exactly what the live
 *     portfolio did.
 *  2. Currency is right-aligned in tabular figures, so a column of money can
 *     be read down.
 *
 *  `runReport` already hands back Frappe's own total row when the report has
 *  Add Total Row set. Pass it to `DataTable`'s `total` — never sum the rows
 *  here, or the portal would be a second opinion about the Bank's books.
 */

const CURRENCY_TYPES = new Set(['Currency', 'Float']);
/** Types that must not wrap: references and dates are read as single tokens. */
const ATOMIC_TYPES = new Set(['Link', 'Dynamic Link', 'Date', 'Datetime', 'Data', 'Int']);

export type ReportRow = Record<string, unknown>;

export function isMoneyColumn(c: ReportColumn): boolean {
  return CURRENCY_TYPES.has(c.fieldtype ?? '');
}

/** The text a report cell shows. Exported because the total row wants the
 *  same treatment as the rows above it. */
export function reportCellText(c: ReportColumn, value: unknown, blank = '—'): string {
  if (value === null || value === undefined || value === '') return blank;
  if (isMoneyColumn(c)) return formatGyd(Number(value));
  if (c.fieldname === 'is_group' && typeof value === 'number') return value ? 'Group' : 'Ledger';
  return String(value);
}

export function reportColumns(
  columns: ReportColumn[],
  options: {
    /** Indent the first column by the row's `indent`, as the desk does for
     *  account trees. Ledger only. */
    indentFirst?: boolean;
  } = {},
): Column<ReportRow>[] {
  return columns.map((c, index) => {
    const money = isMoneyColumn(c);
    const first = index === 0;
    return {
      key: c.fieldname,
      header: c.label,
      align: money ? 'right' : 'left',
      nowrap: money || ATOMIC_TYPES.has(c.fieldtype ?? ''),
      className: money ? 'font-medium text-slate-800' : 'text-slate-600',
      cell: (row) => {
        const text = reportCellText(c, row[c.fieldname], first ? '' : '—');
        const indent = options.indentFirst && first ? Number(row.indent ?? 0) : 0;
        if (!indent) return text;
        return <span style={{ paddingLeft: `${indent * 1.25}rem` }}>{text}</span>;
      },
    };
  });
}

/** Frappe's own total row, keyed onto the same columns. */
export function reportTotal(
  columns: ReportColumn[],
  total: ReportRow | null,
): Record<string, React.ReactNode> | null {
  if (!total) return null;
  const out: Record<string, React.ReactNode> = {};
  for (const c of columns) out[c.fieldname] = reportCellText(c, total[c.fieldname], '');
  return out;
}

/** A group/subtotal row in an accounting report carries its own weight. */
export function reportRowClass(row: ReportRow): string {
  return row.is_group ? 'font-semibold text-slate-900' : '';
}
