import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
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
      <Card className="p-0">
        <DataTable
          bare
          caption="Every account and integration change made in this console"
          columns={[
            {
              key: 'when',
              header: 'When',
              nowrap: true,
              className: 'align-top text-slate-500',
              cell: (row) => formatDateTime(row.acted_on),
            },
            { key: 'by', header: 'By', className: 'align-top', cell: (row) => row.actor },
            {
              key: 'what',
              header: 'What',
              className: 'align-top',
              cell: (row) => (
                <>
                  <span className="font-medium text-slate-800">{row.action}</span>
                  <span className="block text-xs text-slate-400">{row.subject}</span>
                </>
              ),
            },
            {
              key: 'change',
              header: 'Change',
              className: 'align-top text-xs',
              cell: (row) => (
                <>
                  {/* Struck-through old beside plain new: what it WAS and what
                      it BECAME, which is the whole point of an audit line. */}
                  {row.old_value && (
                    <span className="block whitespace-pre-line text-slate-400 line-through">
                      {row.old_value}
                    </span>
                  )}
                  {row.new_value && (
                    <span className="block whitespace-pre-line text-slate-700">{row.new_value}</span>
                  )}
                </>
              ),
            },
            {
              key: 'reason',
              header: 'Reason',
              className: 'align-top text-slate-600',
              cell: (row) => row.reason,
            },
          ]}
          rows={page?.rows ?? []}
          rowKey={(row) => row.name}
          minWidth="56rem"
          footnote={false}
          empty="No changes recorded yet."
        />
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
