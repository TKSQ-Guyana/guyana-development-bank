import { useState } from 'react';
import { call } from '../../api';
import { DataTable } from '../ui/DataTable';
import { EMPTY_EID, isCompleteEid } from '../../eid';
import type { Cluster, ClusterPlan, ClusterPlanSection } from '../../types';
import { EidWithName } from './EidWithName';
import { Notice, SelectField, TextAreaField, TextField } from './fields';

/** The group screens a GDB facilitator works through.

 *  A cluster loan is a different product, not a decoration on a personal one,
 *  so it asks different questions: who the group is, who is in it, and what
 *  the group intends to build together. Citizens never see these as forms —
 *  they answer invitations and read their groups (pages/Cluster.tsx).
 *
 *  Everything a member is named by is an e-ID. That is how GDB identifies a
 *  person everywhere else in the bank, and a mailbox is not — one person can
 *  hold several, and a group's roster has to survive somebody changing theirs.
 */

// Guyana's ten administrative regions. Same list as the profile screen; it
// belongs in configuration and is stated here only because there is no
// endpoint for it yet.
export const REGIONS = [
  'Region 1 — Barima-Waini',
  'Region 2 — Pomeroon-Supenaam',
  'Region 3 — Essequibo Islands-West Demerara',
  'Region 4 — Demerara-Mahaica',
  'Region 5 — Mahaica-Berbice',
  'Region 6 — East Berbice-Corentyne',
  'Region 7 — Cuyuni-Mazaruni',
  'Region 8 — Potaro-Siparuni',
  'Region 9 — Upper Takutu-Upper Essequibo',
  'Region 10 — Upper Demerara-Berbice',
];

const REGISTRATION_STATES = ['Registered', 'Not registered', 'Registration in progress'];

/** DCRA states a region as "Region 2 - Pomeroon-Supenaam" (a hyphen); REGIONS
 *  uses an em dash. Match on the leading "Region N" so a select bound to
 *  REGIONS still lands on the right option instead of showing blank. Falls
 *  back to the raw string so nothing already saved silently disappears. */
export function matchRegion(raw: string): string {
  const n = raw.match(/Region\s+(\d+)/i)?.[1];
  if (!n) return raw;
  return REGIONS.find((r) => r.startsWith(`Region ${n} `)) ?? raw;
}

/** The seven shared-plan questions, in the order they are asked. The keys are
 *  the server's own field names (api.PLAN_SECTIONS), so a section cannot be
 *  added on one side and missed on the other. */
export const PLAN_SECTIONS: {
  key: ClusterPlanSection;
  title: string;
  blurb: string;
  /** The two the wizard will not let a group past. Marked here so the label a
   *  head reads and the rule that stops them are the same fact. */
  required?: boolean;
}[] = [
  {
    key: 'plan_executive_summary',
    title: 'Executive summary',
    required: true,
    blurb: 'Who the group is and what it will finance.',
  },
  {
    key: 'plan_how_formed',
    title: 'How the cluster formed',
    blurb: 'How and when the group formed.',
  },
  {
    key: 'plan_governance',
    title: 'Governance and membership',
    blurb: 'Decision-making, leadership and membership rules.',
  },
  {
    key: 'plan_market',
    title: 'Market',
    blurb: 'Customers, competitors and demand.',
  },
  {
    key: 'plan_shared_project',
    title: 'Shared project',
    required: true,
    blurb: 'Assets to be financed and their location.',
  },
  {
    key: 'plan_operations',
    title: 'Operations',
    blurb: 'Day-to-day running and operating costs.',
  },
  {
    key: 'plan_impact',
    title: 'Social and economic impact',
    blurb: 'Jobs and community benefit.',
  },
];

// `EidWithName` now lives in its own module: naming a person by e-ID is not
// a cluster question, and partners and shareholders name people the same
// way. Re-exported here so every existing import keeps working.
export { EidWithName };

/** Step: what the group does, and where. The region is what GDB routes a
 *  facilitator on, which is why it is asked of the group and not inferred
 *  from whoever happens to be filing. */
export function GroupDetails({
  purpose,
  onPurpose,
  region,
  onRegion,
  locality,
  onLocality,
  registered,
  onRegistered,
}: {
  purpose: string;
  onPurpose: (v: string) => void;
  region: string;
  onRegion: (v: string) => void;
  locality: string;
  onLocality: (v: string) => void;
  registered: string;
  onRegistered: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <TextAreaField
        label="Group activity"
        value={purpose}
        onChange={onPurpose}
        required
        rows={3}
      />
      <SelectField
        label="Region"
        value={region}
        onChange={onRegion}
        options={REGIONS}
        required
      />
      <TextField
        label="Locality"
        value={locality}
        onChange={onLocality}
        placeholder="Village, ward or stelling"
      />
      <SelectField
        label="Registration status"
        value={registered}
        onChange={onRegistered}
        options={REGISTRATION_STATES}
        required
      />
    </div>
  );
}

/** Step: the roster. Rows are invitations, not memberships — each person
 *  accepts signed in as themselves, which is the whole point of inviting
 *  rather than adding. */
export function MembersTable({
  cluster,
  onChanged,
  headLocked,
}: {
  cluster: Cluster | null;
  onChanged: (c: Cluster) => void;
  /** True once the group has an application: the head is then fixed. */
  headLocked?: boolean;
}) {
  const [eid, setEid] = useState(EMPTY_EID);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!cluster) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await call<Cluster>('gdb_bank.api.invite_member', {
        eid,
        full_name: name,
        cluster: cluster.name,
      });
      onChanged(updated);
      setEid(EMPTY_EID);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that member');
    } finally {
      setBusy(false);
    }
  };

  /** Withdraw an invitation, or remove somebody who joined.
   *
   *  The confirmation says which of the two this is, because they are not the
   *  same act: an unanswered invitation disappears as though it never
   *  happened, while a member who joined is recorded as having left. The
   *  server decides that, not this screen — the wording here just has to match
   *  what it will do. */
  const remove = async (m: Cluster['members'][number]) => {
    if (!cluster) return;
    const who = m.member_name || m.member_eid || 'this person';
    const joined = m.member_status === 'Active';
    if (
      !window.confirm(
        joined
          ? `Remove ${who} from ${cluster.name}? Signed documents stay signed.`
          : `Withdraw the invitation to ${who}?`,
      )
    ) {
      return;
    }
    setRemoving(m.member_eid ?? m.member ?? who);
    setError(null);
    try {
      onChanged(
        await call<Cluster>('gdb_bank.api.remove_member', {
          eid: m.member_eid,
          member: m.member,
          cluster: cluster.name,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that member');
    } finally {
      setRemoving(null);
    }
  };

  const makeHead = async (m: Cluster['members'][number]) => {
    if (!cluster || !m.member_eid) return;
    setError(null);
    try {
      onChanged(
        await call<Cluster>('gdb_bank.api.set_cluster_head', { cluster: cluster.name, eid: m.member_eid }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the head');
    }
  };

  const roster = cluster?.members ?? [];
  // Invitations nobody has answered. Worth saying out loud on this screen,
  // because an unanswered invitation looks exactly like a member here and
  // behaves nothing like one: only an accepted member sees the group's
  // application, and only an accepted member is given a line to sign on its
  // offer. A head who cannot tell them apart submits believing the group is
  // in, and nobody finds out until the offer is issued.
  const waiting = roster.filter((m) => m.member_status === 'Invited').length;
  const joined = roster.filter((m) => m.member_status === 'Active' && !m.is_head).length;

  return (
    <div className="space-y-4">
      <DataTable
        caption="Members"
        columns={[
          {
            key: 'eid',
            header: 'e-ID',
            nowrap: true,
            className: 'font-mono text-xs text-slate-500',
            cell: (m) => m.member_eid ?? '—',
          },
          {
            key: 'name',
            header: 'Name',
            className: 'text-slate-800',
            cell: (m) => (
              <>
                {m.member_name}
                {m.is_head && (
                  <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
                    Head
                  </span>
                )}
              </>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            className: 'text-xs font-medium text-slate-500',
            // Plain words, not the stored state: "Invited" is a database
            // value, "Invitation sent" is what happened.
            cell: (m) =>
              m.member_status === 'Invited'
                ? 'Invited'
                : m.member_status === 'Active'
                  ? 'Accepted'
                  : m.member_status === 'Declined'
                    ? 'Declined'
                    : 'Exited',
          },
          {
            key: 'head',
            header: '',
            align: 'right',
            stackLabel: '',
            // Only an accepted member with an account can borrow for the group.
            cell: (m) =>
              !headLocked && !m.is_head && m.member_status === 'Active' && m.member ? (
                <button
                  type="button"
                  onClick={() => void makeHead(m)}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand-light"
                >
                  Make head
                </button>
              ) : null,
          },
          {
            key: 'remove',
            header: '',
            align: 'right',
            stackLabel: '',
            // The head is not removable: a group with nobody who may act for
            // it has no way forward. Neither is somebody who already declined
            // or left — there is nothing left to remove.
            cell: (m) =>
              !m.is_head && (m.member_status === 'Invited' || m.member_status === 'Active') ? (
                <button
                  type="button"
                  onClick={() => void remove(m)}
                  disabled={removing !== null}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                >
                  {removing === (m.member_eid ?? m.member)
                    ? 'Removing…'
                    : m.member_status === 'Invited'
                      ? 'Withdraw'
                      : 'Remove'}
                </button>
              ) : null,
          },
        ]}
        rows={roster}
        rowKey={(m) => m.member ?? m.member_eid ?? m.member_name}
        footnote={false}
        empty="No members yet."
      />

      {/* An invitation is not membership, and this is the screen where the
          head still has time to do something about it. Until they accept, an
          invitee sees nothing of the group's application and gets no line to
          sign on its offer — and GDB will not issue a group's offer to a head
          on their own, so an unanswered invitation stops the loan later
          instead of now. */}
      {waiting > 0 && (
        <Notice tone={joined === 0 ? 'warn' : 'info'}>
          {joined === 0 ? (
            <>
              <strong>
                No acceptances yet &mdash; {waiting} invitation{waiting === 1 ? '' : 's'} pending.
              </strong>{' '}
              No Letter of Offer can be issued until members accept.
            </>
          ) : (
            <>
              {joined} accepted · {waiting} pending. Only accepted members sign the offer.
            </>
          )}
        </Notice>
      )}

      <div className="rounded-lg bg-slate-50/80 p-4">
        <p className="mb-3 text-sm font-bold text-slate-800">Add a member</p>
        <div className="space-y-3">
          <EidWithName
            value={eid}
            onChange={setEid}
            onResolved={(found) => {
              if (found?.registered && found.name) setName(found.name);
            }}
          />
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            hint="Filled from the e-ID where registered."
          />
          {error && <Notice tone="warn">{error}</Notice>}
          <button
            type="button"
            disabled={!isCompleteEid(eid) || busy || !cluster}
            onClick={() => void add()}
            className="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-[#262626] disabled:opacity-40"
          >
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Step: the shared plan. Seven questions, saved as seven fields, so an
 *  underwriter reading the case finds the group's answer to a question rather
 *  than a wall of text to hunt through. */
export function SharedPlan({
  plan,
  onChange,
  readOnly,
}: {
  plan: ClusterPlan;
  onChange: (key: ClusterPlanSection, value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-5">
      {PLAN_SECTIONS.map((section) => (
        <TextAreaField
          key={section.key}
          label={section.title}
          hint={section.blurb}
          required={section.required}
          value={plan[section.key] ?? ''}
          onChange={(v) => onChange(section.key, v)}
          rows={4}
          disabled={readOnly}
        />
      ))}
    </div>
  );
}
