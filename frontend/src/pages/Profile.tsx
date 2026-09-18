import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call } from '../api';
import { useAuth } from '../auth';
import { DocumentShelf } from '../components/DocumentShelf';
import type { CitizenProfile } from '../types';
import { formatDate } from '../utils';

/** My details — the applicant's own page.
 *
 *  Anything the e-ID directory asserted at sign-in is shown back read-only,
 *  because it is not theirs to edit and because seeing it is how they know
 *  what GDB was told about them. Everything else they fill in themselves, and
 *  an underwriter reads the two side by side.
 *
 *  Personal documents live here too — identity, proof of address. They belong
 *  to the person rather than to one case, so a second application does not ask
 *  for the same ID card again.
 */

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green';

const REGIONS = [
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

export function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [form, setForm] = useState({
    phone: '',
    date_of_birth: '',
    occupation: '',
    region: '',
    village_or_town: '',
    address: '',
    next_of_kin: '',
    next_of_kin_phone: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = (p: CitizenProfile) => {
    setProfile(p);
    setForm({
      phone: p.phone ?? '',
      date_of_birth: p.date_of_birth ?? '',
      occupation: p.occupation ?? '',
      region: p.region ?? '',
      village_or_town: p.village_or_town ?? '',
      address: p.address ?? '',
      next_of_kin: p.next_of_kin ?? '',
      next_of_kin_phone: p.next_of_kin_phone ?? '',
    });
  };

  useEffect(() => {
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then(apply)
      .catch((err: Error) => setError(err.message));
  }, []);

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      apply(await call<CitizenProfile>('gdb_bank.profiles.save_profile', form));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details');
    } finally {
      setBusy(false);
    }
  };

  if (error && !profile) {
    return <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>;
  }
  if (!profile) return <p className="text-slate-500">Loading your details…</p>;

  const verified = Boolean(profile.verified_on);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">My details</h1>
      <p className="mb-6 text-sm text-slate-500">
        GDB reads these alongside your application. You can change them at any time.
      </p>

      <div className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-1 font-semibold">From your e-ID</h2>
        <p className="mb-3 text-xs text-slate-500">
          {verified
            ? `What the e-ID directory told GDB when you last signed in — ${formatDate(profile.verified_on)}. You cannot change it here.`
            : 'You have signed in with an email address rather than an e-ID, so GDB has nothing from the directory about you.'}
        </p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd className="text-sm font-medium text-slate-800">
              {profile.verified_full_name || user?.full_name || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">e-ID</dt>
            <dd className="font-mono text-sm font-medium text-slate-800">{profile.eid ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd className="text-sm font-medium text-slate-800">
              {profile.verified_email || profile.user}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Phone</dt>
            <dd className="text-sm font-medium text-slate-800">{profile.verified_phone || '—'}</dd>
          </div>
        </dl>
      </div>

      <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold">Your details</h2>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Details saved.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Phone</span>
            <input
              value={form.phone}
              onChange={(e) => set('phone')(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Date of birth</span>
            <input
              type="date"
              value={form.date_of_birth}
              onChange={(e) => set('date_of_birth')(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Occupation</span>
            <input
              value={form.occupation}
              onChange={(e) => set('occupation')(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Region</span>
            <select
              value={form.region}
              onChange={(e) => set('region')(e.target.value)}
              className={inputClass}
            >
              <option value="">Choose a region</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Village or town</span>
            <input
              value={form.village_or_town}
              onChange={(e) => set('village_or_town')(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Address</span>
            <textarea
              rows={2}
              value={form.address}
              onChange={(e) => set('address')(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Next of kin</span>
            <input
              value={form.next_of_kin}
              onChange={(e) => set('next_of_kin')(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Next of kin phone</span>
            <input
              value={form.next_of_kin_phone}
              onChange={(e) => set('next_of_kin_phone')(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </form>

      {/* Personal documents: they follow the person, not one application. */}
      <DocumentShelf canUpload title="My documents" />
    </div>
  );
}
