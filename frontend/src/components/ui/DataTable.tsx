import type { ReactNode } from 'react';

/** The one table in the portal.
 *
 *  Before this, every list built its own: eighteen `<table>` tags across the
 *  SPA in five different shells, three of which re-implemented currency
 *  right-alignment and none of which agreed on a head treatment. The cost was
 *  not tidiness. It was that a loan reference wrapped over four lines in the
 *  portfolio report, a column of figures could not be read down because each
 *  amount sat at a different indent, the disbursement queue rendered a Status
 *  heading with no cells under it, and nothing had a defined behaviour on a
 *  narrow screen — which `project_overview.md` names as a first-class
 *  requirement, not a nicety.
 *
 *  So the interface is a column spec and rows, and everything else lives in
 *  here:
 *
 *    - the card shell, the rules, the hover, one head treatment;
 *    - money right-aligned in tabular figures, and kept on ONE LINE, because
 *      "G$1,450,000" broken across two lines is not a number a person can
 *      read down a column;
 *    - a ruled total row, as `tfoot` — the use-of-funds treatment the
 *      specification asks for and the finance reports had no way to express;
 *    - the empty state, which was copy-pasted prose in four places;
 *    - the stacked rendering below `sm`, where each cell wears its own label
 *      and its value stays right-aligned. Done with `data-label` and a CSS
 *      `::before`, so there is ONE set of cells in the DOM — a second copy
 *      for mobile would be a second thing to keep true.
 *
 *  A column count mismatch is now impossible: heads and cells are the same
 *  array. That is the disbursement queue's empty Status column, fixed by
 *  construction rather than by remembering.
 */

export type ColumnAlign = 'left' | 'right';

export interface Column<Row> {
  /** Stable identity — the React key, and the key `total` looks the cell up by. */
  key: string;
  header: ReactNode;
  /** Money, counts and anything totalled goes right. Right implies nowrap +
   *  tabular figures unless overridden — that combination IS what makes a
   *  money column readable, so it is the default rather than a thing each
   *  caller remembers. */
  align?: ColumnAlign;
  cell: (row: Row, index: number) => ReactNode;
  /** Keep the cell on one line. References, dates and amounts want this.
   *  Defaults to true for right-aligned columns. */
  nowrap?: boolean;
  /** `tabular-nums`, so digits line up vertically. Defaults to right-aligned. */
  numeric?: boolean;
  /** Extra classes on the cell — colour, weight, width hints. */
  className?: string;
  /** Extra classes on the heading. */
  headClassName?: string;
  /** The label this cell wears when the table stacks on a narrow screen.
   *  Defaults to `header` when that is a plain string. */
  stackLabel?: string;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** What this table is, for screen readers. Required: a table that cannot
   *  say what it holds is not finished. */
  caption: string;
  /** Rendered in place of the whole table when there are no rows. */
  empty?: ReactNode;
  /** A ruled summary row in `tfoot`, keyed by column. Missing columns render
   *  empty. `{ item: 'Total', amount: formatGyd(total) }`. */
  total?: Record<string, ReactNode> | null;
  /** Under the table, inside the shell. Defaults to the row count; pass
   *  `false` for nothing. */
  footnote?: ReactNode | false;
  /** Tighter rows, for long repayment schedules. */
  dense?: boolean;
  /** Width below which the table scrolls sideways rather than crushing its
   *  columns — e.g. `'52rem'`. Set it on wide reports; leave it off and the
   *  table simply fits. */
  minWidth?: string;
  /** Per-row classes: selection, a warning tint, a muted cancelled row. */
  rowClassName?: (row: Row, index: number) => string;
  onRowClick?: (row: Row, index: number) => void;
  /** No card shell — for a table already sitting inside a `Card`. */
  bare?: boolean;
}

function alignClass(align: ColumnAlign | undefined): string {
  return align === 'right' ? 'text-right' : 'text-left';
}

/** Right-aligned columns are money columns nine times in ten, and money wants
 *  tabular figures on a single line. Fold that in here so a caller writes
 *  `align: 'right'` and gets a readable column, instead of writing three
 *  properties and getting it wrong on the fourth table. */
function cellClasses<Row>(c: Column<Row>, dense: boolean): string {
  const right = c.align === 'right';
  return [
    dense ? 'px-3 py-1.5' : 'px-4 py-2.5',
    alignClass(c.align),
    (c.nowrap ?? right) ? 'whitespace-nowrap' : '',
    (c.numeric ?? right) ? 'tabular-nums' : '',
    // Stacked: the cell becomes a label/value pair. `flex-wrap` is what
    // honours the specification's narrowest breakpoint — the amount drops
    // BELOW its label when the two will not share a line, and stays
    // right-aligned either way.
    'max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:justify-between max-sm:gap-x-4',
    'max-sm:px-3 max-sm:py-1 max-sm:text-right',
    "max-sm:before:content-[attr(data-label)] max-sm:before:text-xs max-sm:before:font-normal max-sm:before:text-slate-500 max-sm:before:text-left",
    c.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function stackLabel<Row>(c: Column<Row>): string | undefined {
  if (c.stackLabel !== undefined) return c.stackLabel || undefined;
  return typeof c.header === 'string' ? c.header : undefined;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty = 'Nothing to show here yet.',
  total = null,
  footnote,
  dense = false,
  minWidth,
  rowClassName,
  onRowClick,
  bare = false,
}: DataTableProps<Row>) {
  const shell = bare
    ? ''
    : 'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm';

  if (rows.length === 0) {
    if (empty === false || empty === null) return null;
    return (
      <div className={bare ? '' : 'rounded-lg border border-dashed border-slate-300 bg-white'}>
        <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>
      </div>
    );
  }

  const note =
    footnote === false
      ? null
      : (footnote ??
        `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}${
          minWidth ? ' · scroll sideways for the remaining columns' : ''
        }`);

  return (
    <div className={shell}>
      {/* The scroll container is separate from the shell so the rounded edge
          and the footnote stay put while the columns move under them. */}
      <div className="sm:overflow-x-auto">
        <table
          // `minWidth` is what makes a wide report scroll instead of crushing
          // its columns — and it must NOT survive into the stacked rendering,
          // where the row is a block and a 3000px minimum would push every
          // value off the side of the phone. So it rides a custom property
          // that only the `sm:` rule reads, rather than an inline style no
          // media query can undo.
          className={`w-full border-collapse text-sm max-sm:block ${
            minWidth ? 'sm:min-w-[var(--dt-min-width)]' : ''
          }`}
          style={minWidth ? ({ '--dt-min-width': minWidth } as React.CSSProperties) : undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <thead className="max-sm:hidden">
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${alignClass(
                    c.align,
                  )} ${c.headClassName ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={[
                  'border-b border-slate-100 last:border-0',
                  onRowClick ? 'cursor-pointer' : '',
                  'hover:bg-slate-50/60',
                  // Stacked, a row is a block with its own rule — otherwise
                  // twenty label/value pairs run together as one list and
                  // nobody can tell where one record ends.
                  'max-sm:block max-sm:border-b max-sm:border-slate-200 max-sm:py-1.5',
                  rowClassName?.(row, i) ?? '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {columns.map((c) => (
                  <td key={c.key} data-label={stackLabel(c)} className={cellClasses(c, dense)}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot className="max-sm:block">
              <tr className="border-t-2 border-slate-300 bg-slate-50/60 font-semibold text-slate-900 max-sm:block max-sm:py-2">
                {columns.map((c) => (
                  <td key={c.key} data-label={stackLabel(c)} className={cellClasses(c, dense)}>
                    {total[c.key] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {note && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400 max-sm:px-3">
          {note}
        </p>
      )}
    </div>
  );
}

/** A table under its own heading and caption, which is how nearly every queue
 *  on the staff side presents one. Pulled out because the alternative was the
 *  same three lines of heading markup above six tables, drifting apart. */
export function TableSection({
  title,
  caption,
  action,
  children,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          {caption && <p className="mt-0.5 text-xs text-slate-500">{caption}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
