/** The pages a numbered pager shows: the first, the last, and the ones next to
 *  the current page, with a gap (null) wherever pages are skipped. */
export function pageNumbers(current: number, count: number): (number | null)[] {
  const wanted = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(n - sorted[i - 1] === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}

const BUTTON =
  'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-40';

/** Previous / Next under a paged list. Renders nothing when everything fits on
 *  one page, so a short list looks exactly as it did before paging existed.
 *
 *  Given `pageSizes` and `onPageLength` it is the full pager: always shows the
 *  count, numbers the pages, and lets the reader choose how many rows a page
 *  holds. */
export function Pager({
  start,
  pageLength,
  total,
  onChange,
  pageSizes,
  onPageLength,
}: {
  start: number;
  pageLength: number;
  total: number;
  onChange: (start: number) => void;
  pageSizes?: number[];
  onPageLength?: (size: number) => void;
}) {
  const full = Boolean(pageSizes && onPageLength);
  if (!full && total <= pageLength) return null;
  if (full && total === 0) return null;
  const to = Math.min(start + pageLength, total);
  const current = Math.floor(start / pageLength) + 1;
  const count = Math.max(1, Math.ceil(total / pageLength));

  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-3" aria-label="Pages">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500 tabular-nums">
          {full ? 'Showing ' : ''}
          <span className={full ? 'font-medium text-slate-700' : ''}>
            {start + 1}–{to}
          </span>{' '}
          of {full ? <span className="font-medium text-slate-700">{total}</span> : total}
        </p>
        {full && (
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Rows per page
            <select
              value={pageLength}
              onChange={(e) => onPageLength!(Number(e.target.value))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {pageSizes!.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {count > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={BUTTON}
            disabled={start === 0}
            onClick={() => onChange(Math.max(0, start - pageLength))}
          >
            Previous
          </button>
          {full &&
            pageNumbers(current, count).map((n, i) =>
              n === null ? (
                <span key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-current={n === current ? 'page' : undefined}
                  aria-label={`Page ${n}`}
                  onClick={() => onChange((n - 1) * pageLength)}
                  className={`min-w-9 rounded-md border px-2.5 py-1.5 text-sm font-medium tabular-nums transition-colors ${
                    n === current
                      ? 'border-brand bg-black text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {n}
                </button>
              ),
            )}
          <button type="button" className={BUTTON} disabled={to >= total} onClick={() => onChange(start + pageLength)}>
            Next
          </button>
        </div>
      )}
    </nav>
  );
}
