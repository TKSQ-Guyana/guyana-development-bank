import { useEffect, useRef, useState } from 'react';
import { call } from '../../api';
import { EMPTY_EID, isCompleteEid } from '../../eid';
import type {
  Cluster,
  ClusterPlan,
  ClusterPlanSection,
  EidLookup,
  Facilitator,
} from '../../types';
import { EidBoxes } from '../EidBoxes';
import { Notice, SelectField, TextAreaField, TextField } from './fields';

/** The cluster route's own screens.
 *
 *  A cluster loan is a different product, not a decoration on a personal one,
 *  so it asks different questions: who the group is, who is in it, and what
 *  the group intends to build together. They live here rather than in the
 *  wizard file because none of them has anything to say about an applicant
 *  applying alone, which is still the ordinary case.
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
    blurb:
      'In a few sentences: who this group is, what it is building together, and why it is worth doing.',
  },
  {
    key: 'plan_how_formed',
    title: 'How the cluster formed',
    blurb: 'How the businesses found one another, who brought them together, and when.',
  },
  {
    key: 'plan_governance',
    title: 'Governance and membership',
    blurb:
      'How the group decides things, who leads it, how members join or leave, and what the written agreement says.',
  },
  {
    key: 'plan_market',
    title: 'Market',
    blurb: 'Who the group sells to, what it competes with, and what the demand looks like.',
  },
  {
    key: 'plan_shared_project',
    title: 'The shared project',
    required: true,
    blurb:
      'What is being built or bought together, where it sits, and what it will do for the group.',
  },
  {
    key: 'plan_operations',
    title: 'Operations',
    blurb:
      'How the shared project will be run day to day — who does what, and what it costs the group to run.',
  },
  {
    key: 'plan_impact',
    title: 'Social and economic impact',
    blurb: 'Jobs, training, and what the shared project changes for the community around it.',
  },
];

/** An e-ID box that fills in the name once the number is complete.
 *
 *  The lookup answers a name only for an e-ID that already holds a portal
 *  account. An unknown number is not an error and must not read like one: a
 *  group inviting somebody who has never signed in is the ordinary case in a
 *  programme reaching people who are not online yet.
 */
export function EidWithName({
  value,
  onChange,
  onResolved,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onResolved?: (found: EidLookup | null) => void;
  disabled?: boolean;
}) {
  const [found, setFound] = useState<EidLookup | null>(null);
  const [looking, setLooking] = useState(false);
  // Guards a re-render from re-asking for a number already answered.
  const asked = useRef('');

  useEffect(() => {
    if (!isCompleteEid(value)) {
      asked.current = '';
      setFound(null);
      onResolved?.(null);
      return;
    }
    if (asked.current === value) return;
    asked.current = value;
    setLooking(true);
    call<EidLookup>('gdb_bank.api.lookup_eid', { eid: value })
      .then((r) => {
        setFound(r);
        onResolved?.(r);
      })
      .catch(() => {
        // A lookup that cannot run is not a reason to block a group from
        // naming somebody. The invitation goes out against the e-ID either way.
        setFound(null);
        onResolved?.(null);
      })
      .finally(() => setLooking(false));
    // onResolved is a fresh closure on every render; depending on it would
    // re-run this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-1">
      <EidBoxes value={value} onChange={onChange} disabled={disabled} />
      {looking && <p className="text-xs text-slate-400">Looking up this e-ID…</p>}
      {!looking && found?.registered && (
        <p className="text-xs font-semibold text-emerald-700">{found.name}</p>
      )}
      {!looking && found && !found.registered && (
        <p className="text-xs text-slate-500">
          Not registered with GDB yet — the invitation waits for their first sign-in.
        </p>
      )}
    </div>
  );
}

/** Choose a GDB facilitator from the ones GDB offers.
 *
 *  Not an e-ID box. A head knows the person's NAME, or knows only that they
 *  want help — they have no reason to know anybody's eleven digits, and a
 *  typed number that matches nobody is a dead end they cannot get out of.
 *  The list is the server's; what travels back is still the e-ID, so the
 *  attaching, the linking and the waiting-for-first-sign-in below it are
 *  unchanged.
 */
export function FacilitatorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (eid: string) => void;
}) {
  const [people, setPeople] = useState<Facilitator[] | null>(null);

  useEffect(() => {
    call<Facilitator[]>('gdb_bank.api.facilitators')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  if (!people) return <p className="text-sm text-slate-500">Loading facilitators…</p>;
  if (people.length === 0) {
    return (
      <Notice tone="info">
        No facilitators are listed for your area yet. Carry on — GDB will attach one once your
        region is known.
      </Notice>
    );
  }

  const chosen = people.find((p) => p.eid === value);
  const label = (p: Facilitator) => `${p.full_name} — ${p.region}`;

  // The roster's `placeholder` flag is deliberately NOT surfaced. Telling an
  // applicant the names are examples invites the obvious question — then who
  // will it actually be? — which nobody on this screen can answer, and it
  // undermines a list the applicant is being asked to choose from. The fact is
  // recorded where the people who can act on it will read it: the endpoint's
  // own comment, and CLAUDE.md. Whoever is attached is confirmed to the group
  // on the next screen either way.
  return (
    <SelectField
      label="Facilitator"
      value={chosen ? label(chosen) : ''}
      onChange={(picked) => onChange(people.find((p) => label(p) === picked)?.eid ?? '')}
      options={people.map(label)}
      placeholder="Let GDB choose for my region"
    />
  );
}

/** Step: the group's name, and whether it wants a facilitator.
 *
 *  Asked together and first, because they are the two things the head already
 *  knows when they decide to apply as a group. Everything else about the
 *  group can be worked out afterwards; these two decide what is being made.
 */
export function ClusterIdentity({
  clusterName,
  onName,
  wantsFacilitator,
  onWantsFacilitator,
  facilitatorEid,
  onFacilitatorEid,
  existing,
  chosen,
  onChoose,
  locked,
}: {
  clusterName: string;
  onName: (v: string) => void;
  wantsFacilitator: boolean | null;
  onWantsFacilitator: (v: boolean) => void;
  facilitatorEid: string;
  onFacilitatorEid: (v: string) => void;
  existing: Cluster[];
  chosen: string;
  onChoose: (name: string) => void;
  locked: boolean;
}) {
  return (
    <div className="space-y-5">
      {existing.length > 0 && (
        <div className="rounded-lg bg-slate-50/80 p-4">
          <p className="text-sm font-bold text-slate-800">Which group is this for?</p>
          <p className="mt-1 mb-3 text-xs leading-relaxed text-slate-500">
            You can lead more than one group, and each one applies separately. This application
            belongs to whichever you name here.
          </p>
          <SelectField
            label="Group"
            value={chosen}
            onChange={onChoose}
            options={existing.map((c) => c.name)}
            placeholder="Start a new group"
          />
        </div>
      )}

      {!chosen && (
        <TextField
          label="What is the group called?"
          value={clusterName}
          onChange={onName}
          required
          disabled={locked}
          hint="The name GDB and your members will know this group by. It cannot be changed here once the group is created."
        />
      )}

      <div>
        <p className="text-sm font-bold text-slate-800">
          Would you like a regional facilitator?
          <span className="ml-1 text-rose-600">*</span>
        </p>
        <p className="mt-1 mb-3 text-xs leading-relaxed text-slate-500">
          A GDB facilitator helps a group put its shared plan together. They can write the group's
          plan with you. They cannot see any member's financial information, and they take no part
          in the credit decision.
        </p>
        <div className="flex gap-2">
          {[
            { label: 'Yes, attach one', value: true },
            { label: 'No, not for now', value: false },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onWantsFacilitator(opt.value)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                wantsFacilitator === opt.value
                  ? 'bg-brand text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {wantsFacilitator === true && (
          <div className="mt-4 rounded-lg bg-slate-50/80 p-4">
            <p className="mb-2 text-sm font-bold text-slate-800">Who would you like?</p>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Choose the facilitator you would like. If you do not mind which, leave it as it is
              and answer the region question on the next screen — GDB routes a facilitator by
              region and will attach one.
            </p>
            <FacilitatorPicker value={facilitatorEid} onChange={onFacilitatorEid} />
          </div>
        )}
      </div>
    </div>
  );
}

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
        label="What does the group do?"
        value={purpose}
        onChange={onPurpose}
        required
        rows={3}
        hint="What the businesses in this group make, grow, catch or sell — and what they do together."
      />
      <SelectField
        label="Which region does the group work in?"
        value={region}
        onChange={onRegion}
        options={REGIONS}
        required
        hint="It decides which GDB regional facilitator can be attached to help you."
      />
      <TextField
        label="Which part of the region?"
        value={locality}
        onChange={onLocality}
        hint="The village, ward or stelling."
      />
      <SelectField
        label="Is the group registered?"
        value={registered}
        onChange={onRegistered}
        options={REGISTRATION_STATES}
        required
        hint="A group does not have to be registered to apply. GDB asks so it knows what it is lending to."
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
}: {
  cluster: Cluster | null;
  onChanged: (c: Cluster) => void;
}) {
  const [eid, setEid] = useState(EMPTY_EID);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
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

  const roster = cluster?.members ?? [];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">e-ID</th>
              <th className="px-4 py-2 font-semibold">Name</th>
              <th className="px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roster.map((m) => (
              <tr key={m.member ?? m.member_eid ?? m.member_name}>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">
                  {m.member_eid ?? '—'}
                </td>
                <td className="px-4 py-2 text-slate-800">
                  {m.member_name}
                  {m.is_head && (
                    <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
                      Head
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs font-medium text-slate-500">
                  {/* Plain words, not the stored state: "Invited" is a
                      database value, "Invitation sent" is what happened. */}
                  {m.member_status === 'Invited'
                    ? 'Invitation sent'
                    : m.member_status === 'Active'
                      ? 'Member'
                      : m.member_status === 'Declined'
                        ? 'Declined'
                        : 'No longer in this group'}
                </td>
              </tr>
            ))}
            {roster.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-sm text-slate-500">
                  Nobody has been added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-slate-50/80 p-4">
        <p className="mb-1 text-sm font-bold text-slate-800">Add a member</p>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          Type their e-ID and their name fills in. Adding somebody sends them an invitation — they
          join by accepting it, signed in as themselves.
        </p>
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
            hint="Filled in for you when the e-ID is already registered with GDB. Type it for somebody who is not."
          />
          {error && <Notice tone="warn">{error}</Notice>}
          <button
            type="button"
            disabled={!isCompleteEid(eid) || busy || !cluster}
            onClick={() => void add()}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
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
