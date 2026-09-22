import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../api';
import { EidBoxes } from '../components/EidBoxes';
import { StatusBadge } from '../components/StatusBadge';
import { PLAN_SECTIONS } from '../components/apply/cluster';
import { isCompleteEid, EMPTY_EID } from '../eid';
import type { Cluster as ClusterType, ClusterInvitation } from '../types';
import { formatGyd } from '../utils';

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

const card = 'rounded-xl bg-white p-6 shadow';

export function Cluster() {
  const [clusters, setClusters] = useState<ClusterType[] | undefined>(undefined);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    call<ClusterType[]>('gdb_bank.api.my_clusters')
      .then((all) => {
        setClusters(all ?? []);
        // Keep whichever group was on screen; otherwise open the first.
        setSelected((name) =>
          name && (all ?? []).some((c) => c.name === name) ? name : ((all ?? [])[0]?.name ?? ''),
        );
      })
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>;
  if (clusters === undefined) return <p className="text-slate-500">Loading your clusters…</p>;

  const cluster = clusters.find((c) => c.name === selected) ?? null;
  const setCluster = (next: ClusterType) => {
    setClusters((all) => (all ?? []).map((c) => (c.name === next.name ? next : c)));
    setSelected(next.name);
  };

  return (
    <div className="space-y-6">
      {/* ALWAYS, not only when this person belongs to nothing. A citizen can be
          in several groups at once, so somebody already in one is exactly who a
          second invitation is most likely to be waiting for — and before this
          they had no way at all to answer it. */}
      <Invitations onJoined={() => void load()} />

      {clusters.length === 0 && <StartCluster onCreated={() => void load()} />}

      {/* One tab per group. A head of three sees three, and which one they are
          looking at is never a guess. */}
      {clusters.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {clusters.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setSelected(c.name)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                c.name === selected
                  ? 'bg-brand text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {cluster && <ClusterDetail cluster={cluster} onChanged={setCluster} reload={() => void load()} />}
    </div>
  );
}

function ClusterDetail({
  cluster,
  onChanged,
  reload,
}: {
  cluster: ClusterType;
  onChanged: (c: ClusterType) => void;
  reload: () => void;
}) {
  const setCluster = onChanged;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{cluster.name}</h1>
          <p className="text-sm text-slate-500">
            {[cluster.region, cluster.sector].filter(Boolean).join(' · ') || 'Cluster'} ·{' '}
            {cluster.members.length} member{cluster.members.length === 1 ? '' : 's'}
            {cluster.is_head && (
              <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
                You are the head
              </span>
            )}
          </p>
        </div>
        {cluster.is_head && (
          <Link
            to="/apply"
            className="rounded-full bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark"
          >
            Apply for the cluster
          </Link>
        )}
      </div>

      <Plan cluster={cluster} onSaved={setCluster} />

      <section className={card}>
        <h2 className="mb-3 text-lg font-semibold">Cluster applications</h2>
        {cluster.applications.length === 0 ? (
          <p className="text-sm text-slate-500">
            No application yet. The cluster head applies on behalf of the group, using the shared
            business plan above.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {cluster.applications.map((app) => (
              <li key={app.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-slate-800">
                    {app.shared ? 'Cluster application' : app.applicant_name}
                    {app.private && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        own application — details private
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {app.name}
                    {!app.private && app.loan_amount !== undefined && (
                      <> · {formatGyd(app.loan_amount)} over {app.term_months} months</>
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

      <Members cluster={cluster} onInvited={reload} />
    </div>
  );
}

function Plan({
  cluster,
  onSaved,
}: {
  cluster: ClusterType;
  onSaved: (c: ClusterType) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [purpose, setPurpose] = useState(cluster.loan_purpose ?? '');
  const [plan, setPlan] = useState(cluster.business_plan ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await call<ClusterType>('gdb_bank.api.save_plan', {
        loan_purpose: purpose,
        business_plan: plan,
        cluster: cluster.name,
      });
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the plan');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={(e) => void save(e)} className={`${card} space-y-4`}>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Loan purpose</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Business plan</span>
          <textarea
            rows={6}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save plan'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-xl border border-slate-200 px-4 py-2 font-medium text-slate-600"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  // The seven sections the wizard writes. A plan written there used to read
  // here as "not written yet", because this panel only ever knew about the one
  // free-text field that came before it — telling every member of a group that
  // their head had done nothing.
  const written = PLAN_SECTIONS.filter((section) => (cluster.plan?.[section.key] ?? '').trim());

  return (
    <section className={card}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Shared business plan</h2>
        {cluster.can_edit_plan && (
          <button onClick={() => setEditing(true)} className="text-sm font-medium text-brand hover:underline">
            Edit
          </button>
        )}
      </div>

      {cluster.facilitator_name && (
        <p className="mb-3 text-xs text-slate-500">
          Facilitator: <span className="font-semibold text-slate-700">{cluster.facilitator_name}</span>
        </p>
      )}

      {cluster.loan_purpose && (
        <p className="mb-2 text-sm">
          <span className="font-medium text-slate-700">Purpose: </span>
          <span className="text-slate-600">{cluster.loan_purpose}</span>
        </p>
      )}

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
        <p className="whitespace-pre-wrap text-sm text-slate-600">
          {cluster.business_plan || 'The cluster head has not written the plan yet.'}
        </p>
      )}
    </section>
  );
}

/** Invitations waiting for an answer.
 *
 *  A head asks; the person joins by accepting, signed in as themselves. Nobody
 *  is put into a group they never agreed to be in, and no credential of theirs
 *  travels through somebody else's hands to get them there.
 */
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
    <section className={`${card} border border-gdb-gold/60`}>
      <h2 className="mb-3 text-lg font-semibold">You have been invited to a cluster</h2>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="space-y-3">
        {invites.map((inv) => (
          <li key={inv.name} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-800">{inv.cluster_name || inv.name}</p>
              <p className="text-sm text-slate-500">
                {[inv.region, inv.sector].filter(Boolean).join(' · ')}
                {inv.head_name ? ` · invited by ${inv.head_name}` : ''}
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
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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

function Members({ cluster, onInvited }: { cluster: ClusterType; onInvited: () => void }) {
  const [eid, setEid] = useState(EMPTY_EID);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await call('gdb_bank.api.invite_member', { eid, full_name: name, cluster: cluster.name });
      setSent(eid);
      setEid(EMPTY_EID);
      setName('');
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="mb-3 text-lg font-semibold">Members</h2>
      <ul className="mb-4 divide-y divide-slate-200">
        {cluster.members.map((m) => (
          <li key={m.member ?? m.member_name} className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-800">
              {m.member_name}
              {m.is_head && (
                <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
                  Head
                </span>
              )}
              {m.is_you && <span className="ml-2 text-xs text-slate-400">you</span>}
              {/* The e-ID, not the mailbox: it is who the member is, and it is
                  what the head typed to invite them. */}
              <span className="ml-2 font-mono text-xs text-slate-400">
                {m.member_eid ?? 'no e-ID'}
              </span>
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {m.member_status}
            </span>
          </li>
        ))}
      </ul>

      {cluster.is_head && (
        <form onSubmit={(e) => void invite(e)} className="border-t border-slate-200 pt-4">
          <p className="mb-1 text-sm font-medium text-slate-700">Invite a member</p>
          <p className="mb-3 text-xs text-slate-500">
            By e-ID. They join by accepting the invitation themselves — if they have never used
            the portal, it is waiting for them the first time they sign in.
          </p>
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {sent && (
            <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Invitation sent to <span className="font-mono">{sent}</span>. They appear as
              Invited until they accept.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">Member e-ID</label>
              <EidBoxes value={eid} onChange={setEid} disabled={busy} />
              <input
                placeholder="Their name (optional, until they sign in)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${inputClass} mt-3`}
              />
            </div>
            <button
              type="submit"
              disabled={busy || !isCompleteEid(eid)}
              className="h-10 self-end rounded-full bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function StartCluster({ onCreated }: { onCreated: (c: ClusterType) => void }) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [sector, setSector] = useState('');
  const [purpose, setPurpose] = useState('');
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await call<ClusterType>('gdb_bank.api.create_cluster', {
        cluster_name: name,
        region,
        sector,
        loan_purpose: purpose,
        business_plan: plan,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the cluster');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-2xl font-bold">Start a cluster</h1>
      <p className="mb-6 text-sm text-slate-500">
        A cluster lets several businesses apply around one shared project. You write the business
        plan, add the other members, and apply on the group&apos;s behalf.
      </p>
      <form onSubmit={(e) => void create(e)} className={`${card} space-y-4`}>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Cluster name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Region</span>
            <input value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Sector</span>
            <input value={sector} onChange={(e) => setSector(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Loan purpose</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Business plan</span>
          <textarea rows={5} value={plan} onChange={(e) => setPlan(e.target.value)} className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create cluster'}
        </button>
      </form>
    </div>
  );
}
