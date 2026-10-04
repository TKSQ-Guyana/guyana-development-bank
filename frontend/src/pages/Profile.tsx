import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { call } from "../api";
import { useAuth } from "../auth";
import { DocumentShelf } from "../components/DocumentShelf";
import { formatPhone, isGuyanaPhone } from "../components/PhoneInput";
import {
  PhoneField,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/apply/fields";
import { REGIONS } from "../components/apply/cluster";
import { EDUCATION_LEVELS } from "../shared/education";
import { Footer, QButton } from "../components/portal/ui";
import type { CitizenProfile } from "../types";
import { formatDate } from "../utils";

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

type Form = {
  phone: string;
  email: string;
  date_of_birth: string;
  occupation: string;
  education_level: string;
  skills_qualifications: string;
  region: string;
  village_or_town: string;
  address: string;
  address_zone: string;
  address_code: string;
  next_of_kin: string;
  next_of_kin_phone: string;
};

const EMPTY: Form = {
  phone: "",
  email: "",
  date_of_birth: "",
  occupation: "",
  education_level: "",
  skills_qualifications: "",
  region: "",
  village_or_town: "",
  address: "",
  address_zone: "",
  address_code: "",
  next_of_kin: "",
  next_of_kin_phone: "",
};

/** What counts towards "complete" — zone and code are optional everywhere. */
const COUNTED: (keyof Form)[] = [
  "phone",
  "email",
  "date_of_birth",
  "occupation",
  "education_level",
  "address",
  "village_or_town",
  "region",
  "next_of_kin",
  "next_of_kin_phone",
];

const fromProfile = (p: CitizenProfile): Form => ({
  phone: p.phone || p.verified_phone || "",
  email: p.email || p.verified_email || "",
  date_of_birth: p.date_of_birth || p.verified_birth_date || "",
  occupation: p.occupation ?? "",
  education_level: p.education_level ?? "",
  skills_qualifications: p.skills_qualifications ?? "",
  region: p.region ?? "",
  village_or_town: p.village_or_town ?? "",
  address: p.address ?? "",
  address_zone: p.address_zone ?? "",
  address_code: p.address_code ?? "",
  next_of_kin: p.next_of_kin ?? "",
  next_of_kin_phone: p.next_of_kin_phone ?? "",
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function problems(f: Form): Partial<Record<keyof Form, string>> {
  const out: Partial<Record<keyof Form, string>> = {};
  if (!f.phone.trim()) out.phone = "Enter your phone number.";
  else if (!isGuyanaPhone(f.phone))
    out.phone = "Enter a 7-digit Guyana number, e.g. 600 1234.";
  if (!f.email.trim()) out.email = "Enter your email address.";
  else if (!EMAIL.test(f.email.trim()))
    out.email = "That doesn't look like an email address.";
  if (f.next_of_kin_phone.trim() && !isGuyanaPhone(f.next_of_kin_phone))
    out.next_of_kin_phone = "Enter a 7-digit Guyana number.";
  if (
    f.date_of_birth &&
    f.date_of_birth > new Date().toISOString().slice(0, 10)
  )
    out.date_of_birth = "A date of birth can't be in the future.";
  return out;
}

export function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const apply = (p: CitizenProfile) => {
    setProfile(p);
    const f = fromProfile(p);
    setForm(f);
    setInitial(f);
  };

  useEffect(() => {
    call<CitizenProfile>("gdb_bank.profiles.my_profile")
      .then(apply)
      .catch((err: Error) => setError(err.message));
  }, []);

  const set = (field: keyof Form) => (value: string) => {
    setSavedAt(null);
    setForm((f) => ({ ...f, [field]: value }));
  };

  const dirty = useMemo(
    () =>
      (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k]),
    [form, initial],
  );
  const errs = tried ? problems(form) : {};
  const filled = COUNTED.filter((k) => initial[k].trim()).length;
  const pct = Math.round((filled / COUNTED.length) * 100);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (Object.keys(problems(form)).length) {
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      apply(await call<CitizenProfile>("gdb_bank.profiles.save_profile", form));
      setTried(false);
      setSavedAt(new Date());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your details",
      );
    } finally {
      setBusy(false);
    }
  };

  if (error && !profile) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </p>
    );
  }
  if (!profile) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-96 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  const verified = Boolean(profile.verified_on);
  const name = profile.verified_full_name || user?.full_name || "Your account";
  const tin = user && "tin" in user ? user.tin : null;
  // What an online sign-up opened the account with, and signs in with.
  const nationalId = user?.national_id ?? null;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const hint = (key: keyof Form, normal?: ReactNode) =>
    errs[key] ? (
      <span className="font-semibold text-rose-600">{errs[key]}</span>
    ) : (
      normal
    );

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-5" noValidate>
      {/* Who this is, how GDB knows it, and how much of the rest is filled in. */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#022c19] via-brand-dark to-brand text-white shadow-lg shadow-emerald-950/20">
        <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative flex flex-wrap items-center gap-5 px-6 py-5 sm:px-8">
          <span className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-white/10 text-2xl font-black text-amber-300 ring-1 ring-white/20">
            {initials || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-300">
              My details
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-black tracking-tight">
              {name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {(profile.eid || nationalId || tin) && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono font-bold ring-1 ring-white/15">
                  {profile.eid
                    ? `e-ID ${profile.eid}`
                    : nationalId
                      ? `National ID ${nationalId}`
                      : `TIN ${tin}`}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ${
                  verified
                    ? "bg-emerald-400/20 text-emerald-100"
                    : "bg-amber-400/20 text-amber-100"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${verified ? "bg-emerald-300" : "bg-amber-300"}`}
                />
                {verified
                  ? `Verified by e-ID · ${formatDate(profile.verified_on)}`
                  : "Signed up with your National ID"}
              </span>
            </div>
          </div>
          <div className="w-full sm:w-56">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-bold text-emerald-100">
                Profile complete
              </span>
              <span className="text-lg font-black">{pct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/25">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-400 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-emerald-100/90">
              {pct === 100
                ? "Everything GDB asks for is here."
                : `${COUNTED.length - filled} detail${COUNTED.length - filled === 1 ? "" : "s"} still to add.`}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Block
            n={1}
            title="Contact"
            intro="How GDB reaches you about your applications."
            done={Boolean(initial.phone && initial.email)}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <PhoneField
                label="Phone number"
                required
                value={form.phone}
                onChange={set("phone")}
                hint={hint("phone")}
              />
              <TextField
                label="Email address"
                required
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="you@example.gy"
                hint={hint("email")}
              />
            </div>
          </Block>

          <Block
            n={2}
            title="About you"
            intro="Asked once, used on every application."
            done={Boolean(initial.date_of_birth && initial.occupation)}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Date of birth"
                type="date"
                value={form.date_of_birth}
                onChange={set("date_of_birth")}
                hint={hint("date_of_birth")}
              />
              <TextField
                label="Occupation"
                value={form.occupation}
                onChange={set("occupation")}
                placeholder="e.g. Market vendor"
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Highest level of education"
                value={form.education_level}
                onChange={set("education_level")}
                options={EDUCATION_LEVELS}
                placeholder="Choose one"
              />
              <TextAreaField
                label="Skills, qualifications and education"
                value={form.skills_qualifications}
                onChange={set("skills_qualifications")}
                rows={2}
                max={1000}
                placeholder="Certificates, trades, courses, experience"
              />
            </div>
          </Block>

          <Block
            n={3}
            title="Residential address"
            intro="Where you live — the address on your loan agreement."
            done={Boolean(initial.address && initial.region)}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
              <div className="sm:col-span-2 lg:col-span-8">
                <TextField
                  label="House and street"
                  value={form.address}
                  onChange={set("address")}
                  placeholder="Lot 12 Main Street"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <TextField
                  label="Village or town"
                  value={form.village_or_town}
                  onChange={set("village_or_town")}
                  placeholder="e.g. Bartica"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-6">
                <SelectField
                  label="Region"
                  value={form.region}
                  onChange={set("region")}
                  options={REGIONS}
                  placeholder="Choose a region"
                />
              </div>
              <div className="lg:col-span-3">
                <TextField
                  label="Zone"
                  value={form.address_zone}
                  onChange={set("address_zone")}
                  placeholder="e.g. Zone B"
                />
              </div>
              <div className="lg:col-span-3">
                <TextField
                  label="Code"
                  value={form.address_code}
                  onChange={set("address_code")}
                  placeholder="e.g. 4-AB-102"
                />
              </div>
            </div>
          </Block>

          <Block
            n={4}
            title="Next of kin"
            intro="Someone GDB may contact if it cannot reach you."
            done={Boolean(initial.next_of_kin && initial.next_of_kin_phone)}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Full name"
                value={form.next_of_kin}
                onChange={set("next_of_kin")}
                placeholder="e.g. Anita Ramdass"
              />
              <PhoneField
                label="Phone number"
                value={form.next_of_kin_phone}
                onChange={set("next_of_kin_phone")}
                hint={hint("next_of_kin_phone")}
              />
            </div>
          </Block>

          {/* Changes are never lost quietly: the bar appears while there are some,
              and stays to confirm the save. */}
          {(dirty || savedAt) && (
            <Footer>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {dirty ? (
                  <>
                    <span className="h-2 w-2 flex-none rounded-full bg-amber-500" />
                    <span className="truncate font-semibold text-slate-700">
                      Unsaved changes
                    </span>
                  </>
                ) : savedAt ? (
                  <>
                    <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-emerald-100 text-[11px] text-emerald-700">
                      ✓
                    </span>
                    <span className="truncate font-semibold text-emerald-800">
                      Saved at{" "}
                      {savedAt.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </>
                ) : (
                  <span className="truncate text-slate-500">
                    All changes saved
                  </span>
                )}
              </span>
              <span className="flex flex-none gap-2">
                {dirty && (
                  <QButton
                    kind="secondary"
                    disabled={busy}
                    onClick={() => {
                      setForm(initial);
                      setTried(false);
                      setError(null);
                    }}
                  >
                    Discard
                  </QButton>
                )}
                <QButton type="submit" disabled={busy || !dirty}>
                  {busy ? "Saving…" : "Save changes"}
                </QButton>
              </span>
            </Footer>
          )}
        </div>

        <aside
          className="space-y-4 lg:sticky lg:top-24"
          aria-label="From your e-ID and documents"
        >
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
                <LockGlyph />
              </span>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  {verified ? "From your e-ID" : "Your account"}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {verified
                    ? "What the e-ID directory told GDB. Read-only."
                    : "Set when you signed up."}
                </p>
              </div>
            </div>
            <dl className="space-y-2.5 text-sm">
              {(
                [
                  ["Name", name],
                  verified
                    ? ["e-ID", profile.eid || "—"]
                    : ["National ID", nationalId || "—"],
                  ...(tin ? [["TIN", tin] as [string, string]] : []),
                  [
                    "Email",
                    profile.verified_email ||
                      (profile.user?.endsWith(".invalid")
                        ? "—"
                        : profile.user) ||
                      "—",
                  ],
                  ["Phone", formatPhone(profile.verified_phone) || "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"
                >
                  <dt className="text-slate-500">{k}</dt>
                  <dd
                    className={`text-right font-semibold break-all text-slate-900 ${k === "e-ID" || k === "TIN" || k === "National ID" ? "font-mono" : ""}`}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Personal documents: they follow the person, not one application. */}
          <DocumentShelf title="My documents" compact />

          <p className="px-1 text-xs leading-relaxed text-slate-500">
            GDB reads these details with each application you make. Changing
            them here changes them for every application still in progress.
          </p>
        </aside>
      </div>
    </form>
  );
}

function Block({
  n,
  title,
  intro,
  done,
  children,
}: {
  n: number;
  title: string;
  intro: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
      <header className="mb-4 flex items-center gap-3">
        <span
          className={`grid h-9 w-9 flex-none place-items-center rounded-xl text-sm font-black ${
            done
              ? "bg-brand text-white"
              : "bg-brand-dark text-amber-300 ring-4 ring-emerald-50"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-extrabold leading-tight text-slate-900">
            {title}
          </h2>
          <p className="text-xs text-slate-500">{intro}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <rect
        x="4.5"
        y="9"
        width="11"
        height="8"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7 9V6.5a3 3 0 0 1 6 0V9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
