import { EidWithName } from './EidWithName';
import { Notice, TextField } from './fields';
import { EMPTY_EID } from '../../eid';
import type { OwnershipRow } from '../../types';

/** Who owns the business, and how much of it each of them owns.
 *
 *  Asked of a PARTNERSHIP and of an INCORPORATED company, and of neither a
 *  sole trader (who owns all of it) nor a cluster (a group of separate
 *  borrowers, not a jointly-owned company). Both structures ask the same two
 *  questions, so they share one block — only the wording changes, because a
 *  partner and a shareholder are not the same word to the person filling this
 *  in.
 *
 *  Everything here is DECLARED. Naming somebody records what the applicant
 *  said; it does not sign that person up, and GDB confirms a co-owner through
 *  their own sign-in. The server re-checks the total — this only reports it.
 */
export function OwnershipBlock({
  structure,
  applicantShare,
  onApplicantShare,
  owners,
  onOwners,
  declared,
}: {
  structure: string;
  applicantShare: string;
  onApplicantShare: (v: string) => void;
  owners: OwnershipRow[];
  onOwners: (next: OwnershipRow[]) => void;
  /** The applicant's share plus every named co-owner's, computed by the caller
   *  so the wizard's own validation and this display can never disagree. */
  declared: number;
}) {
  const partnership = structure === 'Partnership';
  const word = partnership ? 'partner' : 'shareholder';
  const plural = partnership ? 'partners' : 'shareholders';

  const update = (i: number, patch: Partial<OwnershipRow>) =>
    onOwners(owners.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <div className="space-y-4 rounded-lg bg-slate-50/80 p-4">
      <div>
        <p className="text-sm font-bold text-slate-800">
          {partnership ? 'Ownership of the partnership' : 'Ownership of the company'}
        </p>
        <p className="mt-1 text-xs text-slate-500">Declared ownership. Each {word} confirms separately.</p>
      </div>

      <div className="sm:max-w-xs">
        <TextField
          label={partnership ? 'Your partner share (%)' : 'Your ownership share (%)'}
          value={applicantShare}
          onChange={(v) => onApplicantShare(v.replace(/[^\d.]/g, ''))}
          inputMode="numeric"
          required
          placeholder="e.g. 50"
        />
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Other {plural}
        </p>
        {owners.length === 0 && (
          <p className="text-xs text-slate-500">None named.</p>
        )}
        {owners.map((o, i) => (
          <div
            key={i}
            className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[auto_1fr_auto]"
          >
            <EidWithName
              value={o.eid}
              onChange={(next) => update(i, { eid: next })}
              onResolved={(found) =>
                // A registered e-ID names itself. Only fill a blank — an
                // applicant who typed a name should keep the one they typed.
                found?.registered && found.name && !o.name.trim()
                  ? update(i, { name: found.name })
                  : undefined
              }
              unknownNote="Not yet registered with GDB. Confirmed separately."
            />
            <TextField
              label="Name"
              value={o.name}
              onChange={(v) => update(i, { name: v })}
              placeholder={`This ${word}'s name`}
            />
            <div className="flex items-end gap-2">
              <div className="w-24">
                <TextField
                  label="Share %"
                  value={o.share ? String(o.share) : ''}
                  onChange={(v) => update(i, { share: Number(v.replace(/[^\d.]/g, '')) || 0 })}
                  inputMode="numeric"
                />
              </div>
              <button
                type="button"
                onClick={() => onOwners(owners.filter((_, j) => j !== i))}
                className="mb-2.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-rose-600"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onOwners([...owners, { eid: EMPTY_EID, name: '', share: 0 }])}
          className="text-xs font-semibold text-brand underline"
        >
          Add {owners.length === 0 ? `a ${word}` : `another ${word}`}
        </button>
      </div>

      {/* Over 100 cannot be true of anything and the server refuses it. Under
          100 is allowed on purpose: an applicant who does not know every
          shareholder should not be blocked from applying, and an underwriter
          reading 60% declared knows to ask about the rest. */}
      {declared > 100 && (
        <Notice tone="warn">
          Shares total {declared}%. They cannot exceed 100%.
        </Notice>
      )}
      {declared > 0 && declared < 100 && (
        <Notice tone="info">
          {declared}% declared. The remainder may be left unnamed.
        </Notice>
      )}
    </div>
  );
}
