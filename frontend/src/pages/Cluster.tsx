import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { PLAN_SECTIONS } from '../components/apply/cluster';
import type { Cluster as ClusterType, ClusterInvitation } from '../types';
import { formatGyd } from '../utils';

/** A citizen's groups — read only.
 *
 *  Groups are formed and run by a GDB facilitator, who also files the group's
 *  application in its head's name. A citizen's part is their own: answer an
 *  invitation, read the group they joined, and later sign its Letter of Offer
 *  on the case page. Nothing here edits a group. */

const card = 'rounded-lg border border-slate-200 bg-white p-6 shadow-sm';

export function Cluster() {
  const [clusters, setClusters] = useState<ClusterType[] | undefined>(undefined);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    call<ClusterType[]>('gdb_bank.api.my_clusters')
      .then((all) => {
        setClusters(all ?? []);
        setSelected((name) =>
          name && (all ?? []).some((c) => c.name === name) ? name : ((all ?? [])[0]?.name ?? ''),
        );
      })
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (clusters === undefined) return <p className="text-sm text-slate-500">Loading your groups…</p>;

  const cluster = clusters.find((c) => c.name === selected) ?? null;

  return (
    <div className="space-y-6">
      <Invitations onJoined={() => void load()} />

      {clusters.length === 0 && (
        <div className={`${card} text-center`}>
          <p className="text-sm font-semibold text-slate-700">No groups yet</p>
          <p className="mt-1 text-sm text-slate-500">Group loans are arranged by a GDB facilitator.</p>
        </div>
      )}

      {clusters.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {clusters.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setSelected(c.name)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                c.name === selected ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {cluster && <ClusterDetail cluster={cluster} />}
    </div>
  );
}

function ClusterDetail({ cluster }: { cluster: ClusterType }) {
  const written = PLAN_SECTIONS.filter((section) => (cluster.plan?.[section.key] ?? '').trim());
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{cluster.name}</h1>
        <p className="text-sm text-slate-500">
          {[cluster.region, cluster.sector].filter(Boolean).join(' · ') || 'Group'} ·{' '}
          {cluster.members.filter((m) => m.member_status === 'Active').length} members
          {cluster.is_head && (
            <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
              Head
            </span>
          )}
        </p>
        {cluster.facilitator_name && (
          <p className="mt-1 text-xs text-slate-500">
            Facilitator: <span className="font-semibold text-slate-700">{cluster.facilitator_name}</span>
          </p>
        )}
      </div>

      <section className={card}>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Group plan</h2>
        {written.length > 0 ? (
          <div className="space-y-4">
            {written.map((section) => (
              <div key={section.key}>
                <h3 className="text-sm font-bold text-slate-800">{section.title}</h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                  {cluster.plan[section.key]}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{cluster.business_plan || 'Not written yet.'}</p>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Applications</h2>
        {cluster.applications.length === 0 ? (
          <p className="text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cluster.applications.map((app) => (
              <li key={app.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {app.shared ? 'Group application' : app.applicant_name}
                    {app.private && <span className="ml-2 text-xs font-normal text-slate-400">private</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {app.name}
                    {!app.private && app.facility_amount !== undefined && (
                      <> · {formatGyd(app.facility_amount)} · {app.facility_term} months</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={app.status} />
                  {!app.private && (
                    <Link to={`/loans/${app.name}`} className="text-sm font-medium text-brand hover:underline">
                      View
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Members</h2>
        <ul className="divide-y divide-slate-100">
          {cluster.members.map((m) => (
            <li key={m.member ?? m.member_eid ?? m.member_name} className="flex items-center justify-between py-2">
              <span className="text-sm text-slate-800">
                {m.member_name}
                {m.is_head && (
                  <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
                    Head
                  </span>
                )}
                {m.is_you && <span className="ml-2 text-xs text-slate-400">you</span>}
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {m.member_status === 'Active' ? 'Accepted' : m.member_status}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Invitations waiting for an answer — the invitee's own act, signed in as
 *  themselves. Nobody is put into a group they never agreed to be in. */
function Invitations({ onJoined }: { onJoined: () => void }) {
  const [invites, setInvites] = useState<ClusterInvitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    call<ClusterInvitation[]>('gdb_bank.api.my_invitations')
      .then(setInvites)
      .catch(() => setInvites([]));

  useEffect(() => {
    void load();
  }, []);

  const respond = async (cluster: string, accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.api.respond_to_invitation', { cluster, accept: accept ? 1 : 0 });
      await load();
      if (accept) onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer the invitation');
    } finally {
      setBusy(false);
    }
  };

  if (invites.length === 0) return null;

  return (
    <section className={`${card} border-gdb-gold/60`}>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Group invitations</h2>
      {error && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <ul className="space-y-3">
        {invites.map((inv) => (
          <li key={inv.name} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-800">{inv.cluster_name || inv.name}</p>
              <p className="text-sm text-slate-500">
                {[inv.region, inv.sector].filter(Boolean).join(' · ')}
                {inv.invited_by ? (
                  <>
                    {' · from '}
                    <span className="normal-case">{inv.invited_by}</span>
                  </>
                ) : (
                  ''
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(inv.name, true)}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(inv.name, false)}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
