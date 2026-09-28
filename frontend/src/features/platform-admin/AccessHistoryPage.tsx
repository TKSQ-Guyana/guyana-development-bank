import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { accessHistory } from './api';
import type { AccessHistoryPage as HistoryPage } from './types';
import { errorText, formatDateTime, Notice, PageHeader } from './ui';

/** Every account and settings change: who, what, before, after, when, why.
 *  Read-only here and append-only on the server — nobody, administrators
 *  included, can edit or delete an entry. */
export function AccessHistoryPage() {
  const [start, setStart] = useState(0);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    accessHistory(start)
      .then(setPage)
      .catch((err) => setError(errorText(err, 'Could not load the access history.')));
  }, [start]);

  return (
    <div>
      <PageHeader
        title="Access history"
        lede="Every account and integration change made in this console, with the reason given. Entries cannot be edited or deleted."
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">By</th>
              <th className="px-4 py-2 font-medium">What</th>
              <th className="px-4 py-2 font-medium">Change</th>
              <th className="px-4 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((row) => (
              <tr key={row.name} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(row.acted_on)}</td>
                <td className="px-4 py-3">{row.actor}</td>
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-800">{row.action}</span>
                  <span className="block text-xs text-slate-400">{row.subject}</span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {row.old_value && <span className="block whitespace-pre-line text-slate-400 line-through">{row.old_value}</span>}
                  {row.new_value && <span className="block whitespace-pre-line text-slate-700">{row.new_value}</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{row.reason}</td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No changes recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {page && (start > 0 || page.has_more) && (
          <div className="flex justify-between border-t border-slate-100 p-3">
            <Button variant="secondary" disabled={start === 0} onClick={() => setStart(Math.max(0, start - 50))}>
              Newer
            </Button>
            <Button variant="secondary" disabled={!page.has_more} onClick={() => setStart(start + 50)}>
              Older
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
