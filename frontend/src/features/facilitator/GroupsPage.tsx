import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { call } from '../../api';
import { StatusBadge } from '../../components/StatusBadge';
import { DataTable } from '../../components/ui/DataTable';
import { PlusIcon } from '../../components/ui/icons';
import type { Cluster } from '../../types';
import { formatGyd } from '../../utils';
import { groupCase } from './groupCase';

/** The facilitator's desk: every group they run, and where each one stands.
 *
 *  `my_clusters` returns the groups whose `facilitator` is this account — the
 *  server's answer, so a facilitator never sees another facilitator's groups. */
export function GroupsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Cluster[]>('gdb_bank.api.my_clusters')
      .then((all) => setGroups((all ?? []).filter((c) => c.is_facilitator)))
      .catch((err: Error) => setError(err.message));
  }, []);

  const head = (c: Cluster) => c.members.find((m) => m.is_head);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Groups</h2>
          <p className="mt-1 text-sm text-slate-500">Groups you facilitate.</p>
        </div>
        <Link
          to="/facilitator/groups/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-black px-4 py-2 text-sm font-bold text-white shadow-sm shadow-black/20 hover:bg-[#262626]"
        >
          <PlusIcon className="h-4 w-4" />
          New group
        </Link>
      </div>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}

      {!groups && !error && <p className="text-sm text-slate-500">Loading groups…</p>}

      {groups && (
        <DataTable
          caption="Groups you facilitate"
          rows={groups}
          rowKey={(c) => c.name}
          onRowClick={(c) => navigate(`/facilitator/groups/${encodeURIComponent(c.name)}`)}
          empty={
            <div className="rounded-lg border border-dashed border-slate-200 bg-white py-12 text-center">
              <p className="text-sm font-semibold text-slate-700">No groups yet</p>
              <p className="mt-1 text-sm text-slate-500">Start with New group.</p>
            </div>
          }
          columns={[
            {
              key: 'name',
              header: 'Group',
              cell: (c) => (
                <span>
                  <span className="block font-semibold text-slate-800">{c.name}</span>
                  <span className="block text-xs text-slate-500">{c.region || '—'}</span>
                </span>
              ),
            },
            {
              key: 'head',
              header: 'Head',
              cell: (c) => {
                const h = head(c);
                return h ? (
                  <span>
                    <span className="block text-slate-800">{h.member_name}</span>
                    <span className="block font-mono text-xs text-slate-400">{h.member_eid}</span>
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-amber-700">Not named</span>
                );
              },
            },
            {
              key: 'members',
              header: 'Members',
              align: 'right',
              cell: (c) => (
                <span>
                  {c.joined_count + (head(c) ? 1 : 0)} accepted
                  {c.invited_count > 0 && <span className="block text-xs text-slate-400">{c.invited_count} invited</span>}
                </span>
              ),
            },
            {
              key: 'application',
              header: 'Application',
              cell: (c) => {
                const app = groupCase(c);
                return app ? (
                  <span className="flex items-center gap-2">
                    <StatusBadge status={app.status} />
                    {app.loan_amount ? (
                      <span className="text-xs text-slate-500">{formatGyd(app.loan_amount)}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Not started</span>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}
