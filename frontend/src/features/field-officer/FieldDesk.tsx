import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/ui/DataTable';
import { Pager } from '../../components/ui/Pager';
import { formatAge, formatDate } from '../../utils';
import { fo } from './api';
import { StatusBadge } from './StatusBadge';
import type { DeskPage, DeskTab } from './types';

const PAGE_LENGTH = 25;

const TABS: { id: DeskTab; label: string; caption: string }[] = [
  { id: 'assist', label: 'Assist requests', caption: 'Applicants asking for a Field Officer' },
  { id: 'assisted', label: 'Assisted applications', caption: 'Applications filled with the applicant' },
  { id: 'tasks', label: 'Field tasks', caption: 'Site visits and reference checks' },
];

const ROUTE: Record<DeskTab, string> = {
  assist: '/field/requests',
  assisted: '/field/assist',
  tasks: '/field/tasks',
};

/** FO.S02 — the Field Officer's one queue. Three tabs, counts by status,
 *  filtered server-side to the officer's region (field_operations.desk). */
export function FieldDesk() {
  const [tab, setTab] = useState<DeskTab>('assist');
  const [status, setStatus] = useState('');
  const [start, setStart] = useState(0);
  const [page, setPage] = useState<DeskPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fo.desk(tab, status, start, PAGE_LENGTH)
      .then((p) => live && setPage(p))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [tab, status, start]);

  const pick = (next: DeskTab) => {
    setTab(next);
    setStatus('');
    setStart(0);
    setPage(null);
  };
  const counts = page?.counts;
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{page?.region ?? (page ? 'No region set' : '')}</p>
        <Link
          to="/field/find"
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 hover:bg-brand-dark"
        >
          Find applicant
        </Link>
      </div>

      <div className="mb-3 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => pick(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {t.label}
              {counts?.[t.id] ? <span className="ml-1.5 opacity-80">{counts[t.id]}</span> : null}
            </button>
          ))}
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setStart(0);
          }}
          aria-label="Status"
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">All statuses</option>
          {Object.entries(page?.statuses ?? {}).map(([s, n]) => (
            <option key={s} value={s}>
              {s} ({n})
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {!error && !page && <p className="text-slate-500">Loading queue…</p>}

      {page && (
        <DataTable
          caption={current.caption}
          columns={[
            {
              key: 'who',
              header: tab === 'tasks' ? 'Task' : 'Applicant',
              cell: (r) => (
                <>
                  <Link to={`${ROUTE[tab]}/${r.name}`} className="font-medium text-brand hover:underline">
                    {r.who ?? '—'}
                  </Link>
                  <span className="block text-xs text-slate-500">{[r.what, r.name].filter(Boolean).join(' · ')}</span>
                </>
              ),
            },
            {
              key: 'eid',
              header: tab === 'assisted' ? 'e-ID' : 'Region',
              nowrap: true,
              className: tab === 'assisted' ? 'font-mono text-xs text-slate-500' : 'text-slate-600',
              cell: (r) => (tab === 'assisted' ? r.eid : r.region) ?? '—',
            },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <>
                  <StatusBadge status={r.status} />
                  {!r.mine && <span className="ml-1.5 text-xs text-slate-400">pool</span>}
                </>
              ),
            },
            {
              key: 'age',
              header: tab === 'tasks' ? 'Due' : 'Age',
              nowrap: true,
              className: 'text-slate-600',
              cell: (r) =>
                tab === 'tasks' ? (
                  formatDate(r.due ?? null)
                ) : (
                  <span title={formatDate(r.on)}>{formatAge(r.on)}</span>
                ),
            },
          ]}
          rows={page.rows}
          rowKey={(r) => r.name}
          footnote={false}
          empty="Nothing here."
        />
      )}
      {page && <Pager start={start} pageLength={PAGE_LENGTH} total={page.total} onChange={setStart} />}
    </div>
  );
}
