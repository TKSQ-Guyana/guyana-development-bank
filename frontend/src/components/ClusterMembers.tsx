import { useEffect, useState } from 'react';
import { call } from '../api';
import { DocumentShelf } from './DocumentShelf';
import type { Cluster } from '../types';

/** The people behind a cluster application, for GDB staff.
 *
 *  The head applies on the group's behalf, so without this an underwriter is
 *  deciding a facility for a group whose other members are a list of names.
 *  Each member fills in their own details and attaches their own documents —
 *  nobody fills in anybody else's — and this is where those reach the person
 *  deciding the case.
 *
 *  Members do not get this view of each other: the plan is shared, the people
 *  are not each other's business. The server draws that line (api.cluster_view
 *  returns `profile` only to staff); this component is only ever rendered for
 *  staff in the first place.
 */
export function ClusterMembers({ cluster }: { cluster: string }) {
  const [data, setData] = useState<Cluster | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    call<Cluster>('gdb_bank.api.cluster_view', { cluster })
      .then(setData)
      .catch(() => setData(null));
  }, [cluster]);

  if (!data) return null;

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Cluster members — {data.name}</h2>
        <span className="text-xs text-slate-500">
          {[data.region, data.sector].filter(Boolean).join(' · ')}
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {data.members.map((m) => (
          <li key={m.member ?? m.member_eid ?? m.member_name} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {m.member_name}
                  {m.is_head && (
                    <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-gdb-green-dark">
                      Head
                    </span>
                  )}
                  <span className="ml-2 font-mono text-xs text-slate-400">
                    {m.member_eid ?? 'no e-ID'}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  {m.member_status}
                  {m.profile?.occupation ? ` · ${m.profile.occupation}` : ''}
                  {m.profile?.region ? ` · ${m.profile.region}` : ''}
                  {m.profile?.village_or_town ? ` · ${m.profile.village_or_town}` : ''}
                  {m.profile?.phone || m.profile?.verified_phone
                    ? ` · ${m.profile.phone || m.profile.verified_phone}`
                    : ''}
                </p>
              </div>
              {m.member && (
                <button
                  type="button"
                  onClick={() => setOpen(open === m.member ? null : m.member)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  {open === m.member ? 'Hide documents' : 'Documents'}
                </button>
              )}
            </div>

            {m.member && open === m.member && (
              <DocumentShelf
                applicant={m.member}
                canUpload={false}
                title={`${m.member_name} — documents`}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
