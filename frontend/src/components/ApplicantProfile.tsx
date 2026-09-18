import { useEffect, useState } from 'react';
import { call } from '../api';
import type { CitizenProfile } from '../types';
import { formatDate } from '../utils';

/** Who the applicant is, as GDB staff read it.
 *
 *  Two columns, never merged: what the e-ID directory asserted at sign-in, and
 *  what the applicant declared. A name or a phone number the directory holds
 *  and one the applicant typed are different kinds of fact, and where they
 *  disagree is precisely the case a human should look at. One reconciled
 *  column would answer a question nobody asked and bury that one.
 */

function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value || '—'}</span>
    </div>
  );
}

export function ApplicantProfile({ user, title = 'Applicant details' }: { user: string; title?: string }) {
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    call<CitizenProfile | null>('gdb_bank.profiles.profile_of', { user })
      .then((p) => {
        setProfile(p);
        setMissing(!p);
      })
      .catch(() => setMissing(true));
  }, [user]);

  if (missing) {
    return (
      <div className="mt-4 rounded-xl bg-white p-6 shadow">
        <h2 className="mb-1 font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">
          This applicant has not filled in their details yet.
        </p>
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="font-mono text-xs text-slate-500">{profile.eid ?? 'no e-ID'}</span>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            From the e-ID directory
          </h3>
          <Line label="Name" value={profile.verified_full_name} />
          <Line label="Email" value={profile.verified_email} />
          <Line label="Phone" value={profile.verified_phone} />
          <Line label="Date of birth" value={profile.verified_birth_date} />
          <Line label="Address" value={profile.verified_address} />
          <p className="mt-2 text-xs text-slate-400">
            {profile.verified_on
              ? `Asserted ${formatDate(profile.verified_on)} · ${profile.identity_source ?? ''}`
              : 'Never signed in with an e-ID.'}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Declared by the applicant
          </h3>
          <Line label="Phone" value={profile.phone} />
          <Line label="Date of birth" value={profile.date_of_birth} />
          <Line label="Occupation" value={profile.occupation} />
          <Line label="Region" value={profile.region} />
          <Line label="Village or town" value={profile.village_or_town} />
          <Line label="Address" value={profile.address} />
          <Line
            label="Next of kin"
            value={
              profile.next_of_kin
                ? `${profile.next_of_kin}${profile.next_of_kin_phone ? ` · ${profile.next_of_kin_phone}` : ''}`
                : null
            }
          />
          <p className="mt-2 text-xs text-slate-400">
            {profile.updated_on ? `Last updated ${formatDate(profile.updated_on)}` : 'Not filled in.'}
          </p>
        </section>
      </div>
    </div>
  );
}
