import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { formatAge, formatDate } from '../../utils';
import { fo } from './api';
import { BUCKETS, SINCE, bucketOf, matches, nextStep, taskCase, taskKind, type Bucket, type Since } from './model/desk';
import { StatusBadge } from './StatusBadge';
import type { DeskRow, DeskTab } from './types';
import { ErrorLine, FIELD } from './ui';

const TABS: { id: DeskTab; label: string; caption: string }[] = [
  { id: 'assist', label: 'Assist requests', caption: 'Applicants asking for a Field Officer' },
  { id: 'assisted', label: 'Assisted applications', caption: 'Applications filled in with the applicant' },
  { id: 'tasks', label: 'Field tasks', caption: 'Site visits and reference checks' },
];

const ROUTE: Record<DeskTab, string> = {
  assist: '/field/requests',
  assisted: '/field/assist',
  tasks: '/field/tasks',
};

// The server answers at most this many rows a call (field_operations.desk).
const PAGE = 100;

/** Every row of one tab. The buckets, search and date filter are the officer's
 *  view of the whole list, so the list is read whole — the server caps it at
 *  its own DESK_SCAN, a region's live work, not the Bank's history. */
async function wholeTab(tab: DeskTab): Promise<{ rows: DeskRow[]; region: string | null }> {
  const first = await fo.desk(tab, '', 0, PAGE);
  const rows = [...first.rows];
  while (rows.length < first.total) {
    const next = await fo.desk(tab, '', rows.length, PAGE);
    if (!next.rows.length) break;
    rows.push(...next.rows);
  }
  return { rows, region: first.region };
}

/** FO.S02 — the Field Officer's work queue: three lists, each split into what
 *  needs the officer, what waits on someone else, and what is done. Everything
 *  is filtered server-side to the officer's region. */
export function FieldDesk() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DeskTab>('assist');
  const [bucket, setBucket] = useState<Bucket>('action');
  const [q, setQ] = useState('');
  const [since, setSince] = useState<Since>('any');
  const [lists, setLists] = useState<Record<DeskTab, DeskRow[]> | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(TABS.map((t) => wholeTab(t.id)))
      .then(([assist, assisted, tasks]) => {
        if (!live) return;
        setLists({ assist: assist.rows, assisted: assisted.rows, tasks: tasks.rows });
        setRegion(assist.region);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const count = (t: DeskTab, b: Bucket) => lists?.[t].filter((r) => bucketOf(t, r) === b).length ?? 0;
  const filtered = useMemo(() => (lists?.[tab] ?? []).filter((r) => matches(r, q, since)), [lists, tab, q, since]);
  const shown = filtered.filter((r) => bucketOf(tab, r) === bucket);
  const filtering = Boolean(q.trim()) || since !== 'any';
  const current = TABS.find((t) => t.id === tab)!;

  const open = (r: DeskRow) => navigate(`${ROUTE[tab]}/${r.name}`);

  const columns: Column<DeskRow>[] = [
    {
      key: 'who',
      header: 'Applicant',
      cell: (r) => (
        <>
          <Link to={`${ROUTE[tab]}/${r.name}`} className="font-medium text-brand hover:underline">
            {r.who ?? '—'}
          </Link>
          <span className="block font-mono text-xs text-slate-500">{r.name}</span>
        </>
      ),
    },
    ...detailColumns(tab),
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'next',
      header: '',
      align: 'right',
      cell: (r) => {
        const next = nextStep(tab, r);
        return 'cta' in next ? (
          <Button variant={next.secondary ? 'secondary' : 'primary'} className="px-3 py-1.5 text-xs" onClick={() => open(r)}>
            {next.cta}
          </Button>
        ) : (
          <span className="text-xs text-slate-400">{next.wait}</span>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{region ?? (lists ? 'No region set' : '')}</p>
        <Button onClick={() => navigate('/field/find')}>New application</Button>
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="grid gap-3 sm:grid-cols-3" role="tablist">
        {TABS.map((t) => (
          <Card
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setBucket('action');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTab(t.id);
                setBucket('action');
              }
            }}
            className={`cursor-pointer transition-shadow ${tab === t.id ? 'ring-2 ring-brand' : 'hover:shadow-md'}`}
          >
            <CardLabel>{t.label}</CardLabel>
            <p className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${tab === t.id ? 'text-brand' : 'text-slate-900'}`}>
                {lists ? count(t.id, 'action') : '—'}
              </span>
              <span className="text-sm text-slate-500">to do</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {count(t.id, 'waiting')} waiting · {count(t.id, 'done')} done
            </p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={BUCKETS.map((b) => ({
            id: b.id,
            label: (
              <>
                {b.label}
                <span className="ml-1.5 opacity-70">{filtered.filter((r) => bucketOf(tab, r) === b.id).length}</span>
              </>
            ),
          }))}
          value={bucket}
          onChange={setBucket}
        />
        <div className="flex flex-wrap gap-2">
          <div className="w-56">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or ID"
              aria-label="Search name or ID"
              className={FIELD}
            />
          </div>
          <div className="w-36">
            <select value={since} onChange={(e) => setSince(e.target.value as Since)} aria-label="Date" className={FIELD}>
              {SINCE.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!error && !lists && <p className="text-slate-500">Loading queue…</p>}
      {lists && (
        <DataTable
          caption={current.caption}
          columns={columns}
          rows={shown}
          rowKey={(r) => r.name}
          footnote={false}
          empty={
            // DataTable sets this inside a <p>: phrasing content only.
            <span className="block space-y-2 py-6 text-center">
              <span className="block text-sm text-slate-500">
                {filtering ? 'No matches.' : bucket === 'action' ? 'All caught up.' : 'Nothing here.'}
              </span>
              {filtering && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ('');
                    setSince('any');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </span>
          }
        />
      )}
    </div>
  );
}

/** The middle columns: what the row is about, per list. */
function detailColumns(tab: DeskTab): Column<DeskRow>[] {
  const received: Column<DeskRow> = {
    key: 'on',
    header: tab === 'assisted' ? 'Started' : 'Received',
    nowrap: true,
    className: 'text-slate-600',
    cell: (r) => <span title={formatAge(r.on)}>{formatDate(r.on)}</span>,
  };
  if (tab === 'assist') {
    return [{ key: 'what', header: 'Request', className: 'text-slate-600', cell: (r) => r.what || '—' }, received];
  }
  if (tab === 'assisted') {
    return [
      { key: 'eid', header: 'e-ID', nowrap: true, className: 'font-mono text-xs text-slate-500', cell: (r) => r.eid ?? '—' },
      { key: 'what', header: 'Application', nowrap: true, className: 'text-slate-600', cell: (r) => r.what || '—' },
      received,
    ];
  }
  return [
    { key: 'kind', header: 'Task', nowrap: true, className: 'font-medium text-slate-800', cell: (r) => taskKind(r) },
    { key: 'case', header: 'Case', nowrap: true, className: 'font-mono text-xs text-slate-500', cell: (r) => taskCase(r) },
    {
      key: 'due',
      header: 'Due',
      nowrap: true,
      cell: (r) => <span className={dueTone(r)}>{formatDate(r.due ?? null)}</span>,
    },
  ];
}

/** Overdue in red, due within two days in amber — only while the task is live. */
function dueTone(r: DeskRow): string {
  if (!r.due || !['Open', 'Accepted'].includes(r.status)) return 'text-slate-600';
  const days = (new Date(`${r.due}T23:59:59`).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? 'font-semibold text-rose-600' : days <= 2 ? 'font-semibold text-amber-700' : 'text-slate-600';
}
