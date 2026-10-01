/** Previous / Next under a paged list. Renders nothing when everything fits on
 *  one page, so a short list looks exactly as it did before paging existed. */
export function Pager({
  start,
  pageLength,
  total,
  onChange,
}: {
  start: number;
  pageLength: number;
  total: number;
  onChange: (start: number) => void;
}) {
  if (total <= pageLength) return null;
  const to = Math.min(start + pageLength, total);
  const button =
    'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-40';

  return (
    <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Pages">
      <p className="text-sm text-slate-500 tabular-nums">
        {start + 1}–{to} of {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={button}
          disabled={start === 0}
          onClick={() => onChange(Math.max(0, start - pageLength))}
        >
          Previous
        </button>
        <button type="button" className={button} disabled={to >= total} onClick={() => onChange(start + pageLength)}>
          Next
        </button>
      </div>
    </nav>
  );
}
