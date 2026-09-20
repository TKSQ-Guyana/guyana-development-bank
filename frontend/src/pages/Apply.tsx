import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { DocumentShelf } from '../components/DocumentShelf';
import { EidBoxes } from '../components/EidBoxes';
import { Card } from '../components/ui/Card';
import { ArrowRightIcon, CheckIcon } from '../components/ui/icons';
import {
  ChoiceCard,
  MoneyField,
  Notice,
  Section,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/apply/fields';
import { EMPTY_EID, isCompleteEid } from '../eid';
import type { BankAccountRecord, Cluster, DcraRecord, LoanApplication, UseOfFundsRow } from '../types';
import { encodeUseOfFunds, formatGyd, parseUseOfFunds } from '../utils';

/** The guided application.
 *
 *  Deliberately a wizard, not one long form. The first answers change what the
 *  rest of the application may ask: an existing trading business is asked for
 *  its financials, a start-up for the plan it intends to trade on, and a
 *  cluster head is asked whose loan this is before anything is asked about the
 *  loan itself. A single scrolling form cannot express that, and it also cannot
 *  be resumed honestly on a Region 9 phone connection.
 *
 *  Section letters match the programme specification, so an applicant on the
 *  phone to GDB and the officer reading the case are naming the same thing.
 */

// TODO: these belong in active configuration, not in the bundle — the
// specification is explicit that policy values must not be hard-coded in the
// frontend. There is no sector endpoint yet, so this list is the stand-in and
// the one place to change when there is.
const SECTORS = [
  'Agriculture',
  'Agro-processing',
  'Fishing and aquaculture',
  'Forestry',
  'Mining and quarrying',
  'Manufacturing',
  'Construction',
  'Retail and wholesale trade',
  'Transport and logistics',
  'Tourism and hospitality',
  'Information technology',
  'Creative industries',
  'Education and training',
  'Health services',
  'Professional services',
  'Other — value creation',
];

/** How the applicant is applying. Asked AFTER existing-vs-new: whether the
 *  business already trades decides which questions the form may ask at all,
 *  and how it is owned is the next question rather than the first one. */
type Structure = '' | 'Sole Trader' | 'Partnership' | 'Cluster-supported';

type StepId = 'consent' | 'route' | 'business' | 'operations' | 'finances' | 'funding' | 'evidence';

const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: 'consent', title: 'Consent', blurb: 'Let GDB fetch the records this application needs' },
  { id: 'route', title: 'How you are applying', blurb: 'Who the loan is for, and what kind of business it is' },
  { id: 'business', title: 'Your business', blurb: 'Identity, what it does, and who it sells to' },
  { id: 'operations', title: 'Operations', blurb: 'How the work gets done' },
  { id: 'finances', title: 'Financial information', blurb: 'What the business earns, or expects to' },
  { id: 'funding', title: 'Funding request', blurb: 'How much, for how long, and where GDB pays it' },
  { id: 'evidence', title: 'Documents and submit', blurb: 'Attach your evidence and send the application' },
];

type Sections = Record<string, string>;

/** Everything the wizard holds, so it can be restored after a dropped
 *  connection. Kept on the device until there is enough to open a server
 *  draft — the server will not accept an application with no amount, term or
 *  purpose, and writing placeholder figures to get past that would put numbers
 *  in the Bank's record that nobody typed. */
interface Saved {
  stage: '' | 'Existing' | 'New';
  structure: Structure;
  coApplicants: string[];
  amount: string;
  term: string;
  income: string;
  phone: string;
  purpose: string;
  dcra: string;
  businessName: string;
  sections: Sections;
  useOfFunds: UseOfFundsRow[];
  step: StepId;
  draftName?: string;
}

export function Apply() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const storageKey = `gdb.apply.${user?.user ?? 'anon'}`;

  const [step, setStep] = useState<StepId>('consent');
  // null = not checked yet. Fetched once from the citizen's own profile, so a
  // returning applicant who already agreed is never asked again.
  const [consentAccepted, setConsentAccepted] = useState<boolean | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [stage, setStage] = useState<'' | 'Existing' | 'New'>('');
  const [structure, setStructure] = useState<Structure>('');
  // Named partners, as declared. Naming somebody is not the same as that
  // person agreeing — a co-applicant consents through their own sign-in.
  const [coApplicants, setCoApplicants] = useState<string[]>([EMPTY_EID]);
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('12');
  const [income, setIncome] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dcra, setDcra] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [sections, setSections] = useState<Sections>({});
  const [useOfFunds, setUseOfFunds] = useState<UseOfFundsRow[]>([{ item: '', amount: 0 }]);

  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [banks, setBanks] = useState<string[]>([]);
  const [bank, setBank] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [myAccounts, setMyAccounts] = useState<BankAccountRecord[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [manualAccount, setManualAccount] = useState(false);
  const [accountNote, setAccountNote] = useState<string | null>(null);
  const [accountCheck, setAccountCheck] = useState<BankAccountRecord | null>(null);
  const [checking, setChecking] = useState(false);
  const [dcraNote, setDcraNote] = useState<string | null>(null);
  const [dcraRecord, setDcraRecord] = useState<DcraRecord | null>(null);
  const [myBusinesses, setMyBusinesses] = useState<DcraRecord[] | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [looking, setLooking] = useState(false);
  const [dcraChecking, setDcraChecking] = useState(false);
  // Guards a re-blur of an unchanged number from refiring the lookup, and
  // lets an edit after a confirmed hit be told apart from that same hit.
  const lastCheckedDcra = useRef('');

  const [draft, setDraft] = useState<LoanApplication | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [submitted, setSubmitted] = useState<LoanApplication | null>(null);

  // Filing against the group is a consequence of the structure chosen, not a
  // separate switch that could disagree with it.
  const forCluster = structure === 'Cluster-supported';
  const validCoApplicants = coApplicants.filter(isCompleteEid);

  const set = (key: string) => (v: string) => setSections((s) => ({ ...s, [key]: v }));
  const val = (key: string) => sections[key] ?? '';

  // --- resume -------------------------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Saved;
      setStage(s.stage ?? '');
      setStructure(s.structure ?? '');
      setCoApplicants(s.coApplicants?.length ? s.coApplicants : [EMPTY_EID]);
      setAmount(s.amount ?? '');
      setTerm(s.term ?? '12');
      setIncome(s.income ?? '');
      setPhone(s.phone ?? '');
      setPurpose(s.purpose ?? '');
      setDcra(s.dcra ?? '');
      setBusinessName(s.businessName ?? '');
      setSections(s.sections ?? {});
      // A device with a draft from before this table existed still has its
      // use-of-funds as one free-text sentence — carried forward as a single
      // row rather than silently dropped, JSON-parsed if it already matches
      // the table shape.
      const legacyUseOfFunds = s.sections?.use_of_funds;
      setUseOfFunds(
        s.useOfFunds?.length
          ? s.useOfFunds
          : (parseUseOfFunds(legacyUseOfFunds) ??
              (legacyUseOfFunds ? [{ item: legacyUseOfFunds, amount: 0 }] : [{ item: '', amount: 0 }])),
      );
      // Consent is re-checked against the server below, never trusted from a
      // device's local draft — it is a record GDB keeps, not a form value.
      // A step id from before a wizard change (e.g. the old 'market' step)
      // would otherwise point nowhere in the current STEPS list.
      if (s.step && s.step !== 'consent' && STEPS.some((st) => st.id === s.step)) setStep(s.step);
      setRestored(true);
    } catch {
      /* a browser that refuses storage is not a reason to block an application */
    }
  }, [storageKey]);

  useEffect(() => {
    const payload: Saved = {
      stage,
      structure,
      coApplicants,
      amount,
      term,
      income,
      phone,
      purpose,
      dcra,
      businessName,
      sections,
      useOfFunds,
      step,
      draftName: draft?.name,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* private window, quota, blocked storage — never fatal */
    }
  }, [
    stage,
    structure,
    coApplicants,
    amount,
    term,
    income,
    phone,
    purpose,
    dcra,
    businessName,
    sections,
    useOfFunds,
    step,
    draft,
    storageKey,
  ]);

  // --- reference data -----------------------------------------------------
  useEffect(() => {
    call<Cluster | null>('gdb_bank.api.my_cluster')
      .then((c) => {
        setCluster(c);
        if (c?.loan_purpose) setPurpose((p) => p || c.loan_purpose || '');
      })
      .catch(() => setCluster(null));
    call<string[]>('gdb_bank.api.bank_options').then(setBanks).catch(() => setBanks([]));
    void loadMyAccounts();
    call<{ consent_version?: string }>('gdb_bank.profiles.my_profile')
      .then((p) => setConsentAccepted(Boolean(p?.consent_version)))
      .catch(() => setConsentAccepted(false));
  }, []);

  // Consent is the server's record, not the device's: a restored draft that
  // points past it is sent back to ask, and a returning citizen who already
  // agreed skips straight past the screen rather than answering again.
  useEffect(() => {
    if (consentAccepted === false && step !== 'consent') setStep('consent');
    if (consentAccepted === true && step === 'consent') setStep('route');
  }, [consentAccepted, step]);

  const selectAccount = (a: BankAccountRecord) => {
    setBank(a.bank);
    setAccountNo(a.account_number);
    setBranchCode(a.branch_code ?? '');
    setAccountCheck(null);
    setAccountNote(null);
  };

  // Ask the switch which accounts this applicant holds. One selects itself;
  // several offer a choice; none falls back to typing, because a switch that
  // cannot answer must not stop an application.
  const loadMyAccounts = async () => {
    setAccountsLoading(true);
    try {
      const found = await call<BankAccountRecord[]>('gdb_bank.api.my_bank_accounts');
      setMyAccounts(found ?? []);
      if (found?.length === 1) selectAccount(found[0]);
      if (!found?.length) {
        setManualAccount(true);
        await call<{ bank: string; bank_account_no: string; branch_code: string } | null>(
          'gdb_bank.api.my_bank_details',
        )
          .then((d) => {
            if (!d) return;
            setBank(d.bank ?? '');
            setAccountNo(d.bank_account_no ?? '');
            setBranchCode(d.branch_code ?? '');
          })
          .catch(() => undefined);
        setAccountNote(
          'We could not find an account registered in your name. Enter it yourself and GDB will verify it before paying out.',
        );
      }
    } catch {
      setMyAccounts([]);
      setManualAccount(true);
      setAccountNote(
        'Your bank could not be reached. Enter your account details and GDB will verify them before paying out.',
      );
    } finally {
      setAccountsLoading(false);
    }
  };

  const checkTypedAccount = async () => {
    if (!bank || !accountNo) return;
    setChecking(true);
    try {
      setAccountCheck(
        await call<BankAccountRecord>('gdb_bank.api.verify_bank_account', {
          bank,
          bank_account_no: accountNo,
        }),
      );
    } catch {
      setAccountCheck(null);
    } finally {
      setChecking(false);
    }
  };

  const selectBusiness = (b: DcraRecord) => {
    setDcraRecord(b);
    setDcra(b.registration_number);
    setBusinessName(b.business_name ?? '');
    setDcraNote(null);
    if (b.region) setSections((s) => ({ ...s, operating_location: s.operating_location || b.region! }));
  };

  const loadMyBusinesses = async () => {
    setLooking(true);
    try {
      const found = await call<DcraRecord[]>('gdb_bank.api.my_businesses');
      setMyBusinesses(found ?? []);
      if (found?.length === 1) selectBusiness(found[0]);
      if (!found?.length) {
        setManualEntry(true);
        setDcraNote('DCRA has no business registered to you. Enter the details yourself and GDB will verify them.');
      }
    } catch {
      setMyBusinesses([]);
      setManualEntry(true);
      setDcraNote('DCRA could not be reached. Enter the details yourself and GDB will verify them.');
    } finally {
      setLooking(false);
    }
  };

  /** Resolves a manually typed DCRA number the same way `dcra_lookup` already
   *  can — this only wires an endpoint that existed but was never called from
   *  here, it does not add a new one. A number that resolves is not the same
   *  as it being the caller's own, so the ownership note is shown alongside
   *  the registry facts rather than in place of them. */
  const checkTypedDcra = async () => {
    const number = dcra.trim();
    if (!number || number === lastCheckedDcra.current) return;
    lastCheckedDcra.current = number;
    setDcraChecking(true);
    try {
      const result = await call<DcraRecord>('gdb_bank.api.dcra_lookup', { dcra_number: number });
      if (result.business_name) {
        setDcraRecord(result);
        setBusinessName(result.business_name);
        setDcraNote(
          result.owned_by_caller === false
            ? "This registration doesn't list your e-ID as a proprietor. GDB will confirm your connection to it before this goes further."
            : null,
        );
        if (result.region) {
          setSections((s) => ({ ...s, operating_location: s.operating_location || result.region! }));
        }
      } else {
        setDcraRecord(null);
        setDcraNote(
          result.status === 'Not Found'
            ? 'DCRA has no business under that registration number. Check it, or enter the details yourself and GDB will verify them.'
            : 'DCRA could not be reached to confirm that number. Enter the details yourself and GDB will verify them.',
        );
      }
    } catch {
      setDcraRecord(null);
      setDcraNote('Could not check that number with DCRA. Enter the details yourself and GDB will verify them.');
    } finally {
      setDcraChecking(false);
    }
  };

  const acceptConsent = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.profiles.record_consent');
      setConsentAccepted(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your consent');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // --- saving -------------------------------------------------------------
  /** Open or update the server draft. Only possible once the funding request
   *  is answered — the server refuses an application with no amount, term or
   *  purpose, and it is right to. */
  const saveDraft = async (): Promise<LoanApplication> => {
    if (!bank || !accountNo) {
      throw new Error(
        (myAccounts?.length ?? 0) > 0 && !manualAccount
          ? 'Choose which account GDB should pay into.'
          : 'Tell us where GDB should pay you: choose your bank and enter your account number.',
      );
    }
    // The payout destination first: if this fails the applicant should fix it
    // and retry, not end up with a loan nobody can pay.
    await call('gdb_bank.api.save_bank_details', {
      bank,
      bank_account_no: accountNo,
      branch_code: branchCode,
    });
    const saved = await call<LoanApplication>('gdb_bank.api.save_application', {
      loan_amount: Number(amount),
      purpose,
      term_months: Number(term),
      monthly_income: income ? Number(income) : 0,
      phone,
      business_stage: stage,
      dcra_number: dcra,
      business_name: businessName,
      // Always explicit. An empty string is the answer "this one is mine" —
      // omitting the field would mean "whatever cluster I belong to", which is
      // exactly the silent reassignment this screen exists to prevent.
      cluster: forCluster && cluster ? cluster.name : '',
      sections: {
        ...sections,
        legal_structure: structure,
        // Only complete e-IDs travel. A half-typed one is not a partner.
        co_applicants: structure === 'Partnership' ? validCoApplicants.join(', ') : '',
        use_of_funds: encodeUseOfFunds(useOfFunds),
      },
      name: draft?.name,
    });
    setDraft(saved);
    return saved;
  };

  const index = STEPS.findIndex((s) => s.id === step);
  const current = STEPS[index];
  const isLast = index === STEPS.length - 1;

  /** What this step still needs before it can be left. Returns null when the
   *  step is complete. Presentation only — the server re-checks everything. */
  const blocker = useMemo((): string | null => {
    if (step === 'consent') {
      if (!consentAccepted && !consentChecked) return 'Agree to let GDB fetch these records to continue.';
    }
    if (step === 'route') {
      if (!stage) return 'Tell us whether this is an existing business or a new venture.';
      if (!structure) return 'Tell us how you are applying.';
      if (structure === 'Partnership' && validCoApplicants.length === 0) {
        return "Give at least one partner's e-ID, or apply as a sole trader.";
      }
    }
    if (step === 'business') {
      if (!businessName.trim()) return 'Give the name of the business.';
      if (stage === 'Existing' && !dcra.trim()) return 'Give the DCRA registration number.';
      if (!val('products_services').trim()) return 'Describe what the business sells or does.';
    }
    if (step === 'funding') {
      if (!amount || Number(amount) <= 0) return 'Enter how much you are asking for.';
      if (!term || Number(term) < 1 || Number(term) > 360) return 'Enter a term between 1 and 360 months.';
      if (!purpose.trim()) return 'Say what the money is for.';
      if (!bank || !accountNo) return 'Tell us where GDB should pay you.';
    }
    return null;
  }, [
    step,
    consentAccepted,
    consentChecked,
    stage,
    structure,
    validCoApplicants.length,
    businessName,
    dcra,
    sections,
    amount,
    term,
    purpose,
    bank,
    accountNo,
  ]);

  const goNext = async () => {
    if (blocker) {
      setError(blocker);
      return;
    }
    setError(null);
    if (step === 'consent' && !consentAccepted) {
      if (!(await acceptConsent())) return;
    }
    // From the funding step onward there is enough to hold a server draft, and
    // from then on every move forward writes one.
    if (step === 'funding') {
      setBusy(true);
      try {
        await saveDraft();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your application');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setStep(STEPS[Math.min(index + 1, STEPS.length - 1)].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    setError(null);
    setStep(STEPS[Math.max(index - 1, 0)].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onFinalSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      // Re-save first, so edits made while attaching documents are not lost
      // between the draft and the submission.
      const saved = await saveDraft();
      const loan = await call<LoanApplication>('gdb_bank.api.submit_application', {
        name: saved.name,
      });
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* nothing to clean up */
      }
      setSubmitted(loan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Application sent</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          GDB has {submitted.name}. An underwriter reviews it next, and any request for more
          information will show on the case page.
        </p>
        <button
          type="button"
          onClick={() => navigate(`/loans/${submitted.name}`)}
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-brand px-6 py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          View your application
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Step rail. Every step is visible from the start, because an applicant
          deciding whether to begin needs to see what the whole thing asks. */}
      <nav className="mb-6 overflow-x-auto">
        <ol className="flex min-w-max items-center">
          {STEPS.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    // Backwards only. Skipping ahead past an unanswered branch
                    // would ask Section G questions of a business that has not
                    // said whether it exists yet.
                    if (i <= index) {
                      setError(null);
                      setStep(s.id);
                    }
                  }}
                  disabled={i > index}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors ${
                    active ? 'bg-white shadow-sm' : i < index ? 'hover:bg-white/60' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                      done
                        ? 'bg-brand text-white'
                        : active
                          ? 'bg-brand text-white ring-4 ring-brand/15'
                          : 'border-2 border-slate-200 bg-white text-slate-300'
                    }`}
                  >
                    {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
                  </span>
                  <span
                    className={`hidden text-xs whitespace-nowrap sm:inline ${
                      active ? 'font-bold text-slate-900' : done ? 'font-medium text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    {s.title}
                  </span>
                </button>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 flex-none bg-slate-200 sm:w-8" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0">
        <header className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Step {index + 1} of {STEPS.length}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{current.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{current.blurb}</p>
        </header>

        {restored && step === 'route' && (
          <div className="mb-4">
            <Notice tone="info">
              We restored what you had already typed on this device. Nothing has been sent to GDB
              yet.
            </Notice>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            {error}
          </div>
        )}

        <Card className="space-y-6">
          {/* --------------------------------------------------- STEP: CONSENT */}
          {step === 'consent' && (
            <Section
              letter="1"
              title="Let GDB fetch these records"
              blurb="Before anything else, because the rest of this application depends on it."
            >
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
                <li>Your business registration at the Deeds and Commercial Registries Authority.</li>
                <li>The bank accounts registered in your name, to verify where GDB pays you.</li>
              </ul>
              <p className="text-xs text-slate-500">
                GDB only looks these up to fill the application in for you and to pay you
                correctly. Nothing is shared beyond GDB.
              </p>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50/80 p-3.5">
                <input
                  type="checkbox"
                  checked={consentChecked || Boolean(consentAccepted)}
                  disabled={Boolean(consentAccepted)}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                <span className="text-sm font-medium text-slate-800">
                  I agree to let GDB fetch these records.
                </span>
              </label>
            </Section>
          )}

          {/* ---------------------------------------------------- STEP: ROUTE */}
          {step === 'route' && (
            <>
              <Section
                letter="1"
                title="Is this an existing business or a new venture?"
                blurb="Asked first because it decides what the rest of the application may ask you for. A trading business is asked what it has earned; a new venture what it expects to."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    title="Existing business"
                    body="Already trading, and registered with DCRA."
                    note="You will be asked for revenue, costs and current obligations, and for financial records as evidence."
                    selected={stage === 'Existing'}
                    onSelect={() => {
                      setStage('Existing');
                      setDcraNote(null);
                      setDcraRecord(null);
                      setManualEntry(false);
                      void loadMyBusinesses();
                    }}
                  />
                  <ChoiceCard
                    title="New venture"
                    body="Starting out, not registered yet."
                    note="You will be asked for projections instead of accounts, and for a business plan as evidence."
                    selected={stage === 'New'}
                    onSelect={() => {
                      setStage('New');
                      setDcra('');
                      setDcraRecord(null);
                      setDcraNote(null);
                    }}
                  />
                </div>
              </Section>

              {/* Only once the stage is answered. Asking how a business is
                  owned before knowing whether it exists puts the two questions
                  in the wrong order. */}
              {stage && (
                <Section
                  letter="2"
                  title="How are you applying?"
                  blurb="This decides who is responsible for repaying, and whose records GDB will need."
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ChoiceCard
                      title="Sole trader"
                      body="You are applying alone, in your own name."
                      note="You alone repay it. Only your documents are needed."
                      selected={structure === 'Sole Trader'}
                      onSelect={() => setStructure('Sole Trader')}
                    />
                    <ChoiceCard
                      title="Partnership"
                      body="You and one or more partners."
                      note="Each partner is named on the application. GDB may ask every partner for their own documents."
                      selected={structure === 'Partnership'}
                      onSelect={() => setStructure('Partnership')}
                    />
                    <ChoiceCard
                      title="Cluster-supported"
                      body={
                        cluster?.is_head
                          ? `On behalf of ${cluster.name}.`
                          : cluster
                            ? `Only the head of ${cluster.name} can do this.`
                            : 'You are not a member of a cluster.'
                      }
                      note={
                        cluster?.is_head
                          ? "The group's roster and every member's records become part of the case, and every member can see it."
                          : undefined
                      }
                      disabled={!cluster?.is_head}
                      selected={structure === 'Cluster-supported'}
                      onSelect={() => setStructure('Cluster-supported')}
                    />
                  </div>

                  {/* Partners are named by e-ID, never by mailbox — the e-ID is
                      how GDB identifies a person everywhere else in the bank. */}
                  {structure === 'Partnership' && (
                    <div className="rounded-lg bg-slate-50/80 p-4">
                      <p className="text-sm font-bold text-slate-800">Your partners</p>
                      <p className="mt-1 mb-3 text-xs leading-relaxed text-slate-500">
                        Name each partner by their national e-ID. Naming somebody here records what
                        you have declared &mdash; it does not sign them up. GDB contacts each partner
                        separately, and they confirm through their own sign-in.
                      </p>
                      <div className="space-y-2">
                        {coApplicants.map((eid, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <EidBoxes
                              value={eid}
                              onChange={(next) =>
                                setCoApplicants((list) => list.map((v, j) => (j === i ? next : v)))
                              }
                            />
                            {coApplicants.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setCoApplicants((list) => list.filter((_, j) => j !== i))
                                }
                                className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCoApplicants((list) => [...list, EMPTY_EID])}
                        className="mt-3 text-xs font-semibold text-brand underline"
                      >
                        Add another partner
                      </button>
                    </div>
                  )}

                  {structure === 'Cluster-supported' && cluster?.is_head && (
                    <Notice tone="info">
                      This application will be filed against <strong>{cluster.name}</strong>. Every
                      active member can see it.
                    </Notice>
                  )}

                  {!cluster && (
                    <Notice tone="info">
                      Applying with a cluster? Create or join one under <strong>My cluster</strong>{' '}
                      first, then come back &mdash; only a cluster head can apply for a group.
                    </Notice>
                  )}
                </Section>
              )}
            </>
          )}

          {/* ------------------------------------------------- STEP: BUSINESS */}
          {step === 'business' && (
            <>
              <Section
                letter="B"
                title="Business identity"
                blurb={
                  stage === 'Existing'
                    ? 'Confirmed against the Deeds and Commercial Registries Authority. What the register holds cannot be edited here.'
                    : 'What you intend to trade as.'
                }
              >
                {stage === 'Existing' && (
                  <>
                    {looking && <p className="text-sm text-slate-500">Finding your businesses at DCRA…</p>}

                    {!manualEntry && (myBusinesses?.length ?? 0) > 1 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-slate-700">
                          DCRA has {myBusinesses?.length} businesses registered to you. Which is this
                          loan for?
                        </p>
                        {myBusinesses?.map((b) => (
                          <ChoiceCard
                            key={b.registration_number}
                            title={b.business_name ?? b.registration_number}
                            body={`${b.registration_number} · ${b.status ?? 'status unknown'}`}
                            selected={dcra === b.registration_number}
                            onSelect={() => selectBusiness(b)}
                          />
                        ))}
                      </div>
                    )}

                    {manualEntry && (
                      <div onBlur={() => void checkTypedDcra()}>
                        <TextField
                          label="DCRA registration number"
                          required
                          value={dcra}
                          onChange={(v) => {
                            const next = v.toUpperCase();
                            setDcra(next);
                            // An edit away from the last confirmed number
                            // invalidates that confirmation immediately —
                            // the panel below must never show a stale hit.
                            if (next !== lastCheckedDcra.current) {
                              setDcraRecord(null);
                              setDcraNote(null);
                            }
                          }}
                          placeholder="e.g. BN-2024-004512"
                        />
                      </div>
                    )}
                    {dcraChecking && <p className="text-sm text-slate-500">Checking DCRA…</p>}

                    {dcraRecord?.business_name && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-slate-900">{dcraRecord.business_name}</p>
                            <p className="font-mono text-xs text-slate-500">
                              {dcraRecord.registration_number}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              dcraRecord.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {dcraRecord.status}
                          </span>
                        </div>
                        <dl className="space-y-1 text-xs text-slate-600">
                          {dcraRecord.business_type && (
                            <div>
                              <dt className="inline text-slate-400">Structure: </dt>
                              <dd className="inline font-medium">{dcraRecord.business_type}</dd>
                            </div>
                          )}
                          {dcraRecord.registered_on && (
                            <div>
                              <dt className="inline text-slate-400">Registered: </dt>
                              <dd className="inline font-medium">{dcraRecord.registered_on}</dd>
                            </div>
                          )}
                          {dcraRecord.region && (
                            <div>
                              <dt className="inline text-slate-400">Region: </dt>
                              <dd className="inline font-medium">{dcraRecord.region}</dd>
                            </div>
                          )}
                          {dcraRecord.proprietors?.length ? (
                            <div>
                              <dt className="inline text-slate-400">Proprietors: </dt>
                              <dd className="inline font-medium">{dcraRecord.proprietors.join(', ')}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <p className="mt-2 text-[11px] text-slate-400">
                          {dcraRecord.source === 'dcra'
                            ? 'Confirmed by the DCRA register.'
                            : dcraRecord.source === 'gdb_history'
                              ? 'From your earlier GDB application — GDB will verify it against DCRA.'
                              : 'Sandbox register — for testing only.'}
                        </p>
                        {dcraRecord.status && dcraRecord.status !== 'Active' && (
                          <div className="mt-2">
                            <Notice tone="warn">
                              This registration is not active. GDB may ask you to restore it before
                              funds are released.
                            </Notice>
                          </div>
                        )}
                      </div>
                    )}

                    {manualEntry && !dcraRecord?.business_name && (
                      <TextField
                        label="Registered business name"
                        required
                        value={businessName}
                        onChange={setBusinessName}
                        placeholder="As it appears on the certificate"
                      />
                    )}
                    {dcraNote && <Notice tone="warn">{dcraNote}</Notice>}
                  </>
                )}

                {stage === 'New' && (
                  <>
                    <TextField
                      label="Proposed business name"
                      required
                      value={businessName}
                      onChange={setBusinessName}
                      placeholder="What you intend to trade as"
                    />
                    <Notice tone="info">
                      No DCRA number is needed to apply. You will need to register the business with
                      the Deeds and Commercial Registries Authority before funds can be released.
                    </Notice>
                  </>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Sector"
                    required
                    value={val('sector')}
                    onChange={set('sector')}
                    options={SECTORS}
                    placeholder="Choose a sector…"
                  />
                  <TextField
                    label="Sub-sector"
                    value={val('sub_sector')}
                    onChange={set('sub_sector')}
                    placeholder="e.g. Poultry, or cassava flour"
                  />
                </div>
              </Section>

              <Section
                letter="C"
                title="What the business does"
                blurb="Describe it as you would to somebody who has never seen it."
              >
                <TextAreaField
                  label="Products or services"
                  required
                  value={val('products_services')}
                  onChange={set('products_services')}
                  placeholder="What you sell, make or provide."
                />
                <TextAreaField
                  label="Employment or development impact"
                  value={val('employment_impact')}
                  onChange={set('employment_impact')}
                  placeholder="Jobs you expect to create or sustain, or other benefit to your community."
                />
              </Section>

              <Section
                letter="D"
                title="Market and customers"
                blurb="Who buys from you, and who else they could buy from."
              >
                <TextAreaField
                  label="Customer segments"
                  value={val('customer_segments')}
                  onChange={set('customer_segments')}
                  placeholder="The kinds of customer you sell to."
                />
                <TextAreaField
                  label="Target market"
                  value={val('target_market')}
                  onChange={set('target_market')}
                  placeholder="Where they are — a region, a town, a trade."
                />
                <TextAreaField
                  label="Competitors or alternatives"
                  value={val('competitors')}
                  onChange={set('competitors')}
                  placeholder="Who else does this, or what customers do instead."
                />
              </Section>
            </>
          )}

          {/* ----------------------------------------------- STEP: OPERATIONS */}
          {step === 'operations' && (
            <Section letter="E" title="Operations" blurb="How the work actually gets done.">
              <TextField
                label="Operating location"
                value={val('operating_location')}
                onChange={set('operating_location')}
                placeholder="Region, town or village"
              />
              <TextAreaField
                label="Production or service process"
                value={val('production_process')}
                onChange={set('production_process')}
                placeholder="From input to finished sale."
              />
              <TextAreaField
                label="Equipment and assets"
                value={val('equipment_required')}
                onChange={set('equipment_required')}
                placeholder="What you already have, and what this loan would add."
              />
              <TextAreaField
                label="Suppliers"
                value={val('suppliers')}
                onChange={set('suppliers')}
                placeholder="Who you buy from, and how reliable they are."
              />
              <TextAreaField
                label="Permits or operating requirements"
                value={val('permits_required')}
                onChange={set('permits_required')}
                placeholder="Any licence, permit or inspection your trade needs."
                hint="If a permit is outstanding, say so — GDB would rather know now than at disbursement."
              />
            </Section>
          )}

          {/* ------------------------------------------------- STEP: FINANCES */}
          {step === 'finances' && stage === 'Existing' && (
            <Section
              letter="G"
              title="Your business finances"
              blurb="What the business has actually earned and spent. Give your best figures — GDB ranks your bank statements and records above anything declared here, so attach them at the evidence step."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField
                  label="Annual revenue"
                  tag="Declared"
                  value={val('annual_revenue')}
                  onChange={set('annual_revenue')}
                />
                <MoneyField
                  label="Cost of sales"
                  tag="Declared"
                  value={val('cost_of_sales')}
                  onChange={set('cost_of_sales')}
                />
                <MoneyField
                  label="Operating expenses"
                  tag="Declared"
                  value={val('operating_expenses')}
                  onChange={set('operating_expenses')}
                />
                <MoneyField
                  label="Existing loan obligations"
                  tag="Declared"
                  value={val('existing_obligations')}
                  onChange={set('existing_obligations')}
                  hint="What you already repay each year to any lender."
                />
                <MoneyField
                  label="Current cash position"
                  tag="Declared"
                  value={val('cash_position')}
                  onChange={set('cash_position')}
                />
              </div>
              <Notice tone="info">
                These are the figures you are declaring. Where your documents show something
                different, the documents are what GDB uses.
              </Notice>
            </Section>
          )}

          {step === 'finances' && stage === 'New' && (
            <Section
              letter="H"
              title="Your projections"
              blurb="What you expect the venture to do. These are forecasts, and GDB reads them as forecasts — not as filed results."
            >
              <TextAreaField
                label="Expected sales volume"
                value={val('expected_sales_volume')}
                onChange={set('expected_sales_volume')}
                placeholder="How much you expect to sell, and over what period."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField
                  label="Projected annual revenue"
                  tag="Forecast"
                  value={val('projected_revenue')}
                  onChange={set('projected_revenue')}
                />
                <MoneyField
                  label="Projected annual costs"
                  tag="Forecast"
                  value={val('projected_costs')}
                  onChange={set('projected_costs')}
                />
                <MoneyField
                  label="Initial start-up costs"
                  tag="Forecast"
                  value={val('initial_costs')}
                  onChange={set('initial_costs')}
                />
                <MoneyField
                  label="Expected monthly cash position"
                  tag="Forecast"
                  value={val('expected_cash_position')}
                  onChange={set('expected_cash_position')}
                />
              </div>
              <TextAreaField
                label="Assumptions behind these projections"
                value={val('assumptions')}
                onChange={set('assumptions')}
                placeholder="What has to be true for these numbers to hold — prices, harvests, demand, supply."
                hint="An underwriter assesses the assumptions as much as the figures."
              />
            </Section>
          )}

          {step === 'finances' && !stage && (
            <Notice tone="warn">
              Go back to the first step and say whether this is an existing business or a new
              venture — that decides which financial questions apply to you.
            </Notice>
          )}

          {/* -------------------------------------------------- STEP: FUNDING */}
          {step === 'funding' && (
            <>
              <Section letter="I" title="What you are asking for" blurb="GDB lends at zero interest. You repay only what you borrow.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField
                    label="Amount requested"
                    required
                    value={amount}
                    onChange={setAmount}
                  />
                  <TextField
                    label="Term (months)"
                    required
                    type="number"
                    inputMode="numeric"
                    value={term}
                    onChange={setTerm}
                    hint={
                      amount && Number(term) > 0
                        ? `About ${formatGyd(Number(amount) / Number(term))} a month, before GDB sets the final schedule.`
                        : 'Between 1 and 360 months.'
                    }
                  />
                </div>
                <TextAreaField
                  label="Purpose of the loan"
                  required
                  value={purpose}
                  onChange={setPurpose}
                  placeholder="e.g. Working capital for my agro-processing business"
                />

                <div>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    Use of funds<span className="ml-1.5 font-normal text-slate-400">(optional)</span>
                  </span>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {useOfFunds.map((row, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5">
                              <input
                                value={row.item}
                                onChange={(e) =>
                                  setUseOfFunds((rows) =>
                                    rows.map((r, j) => (j === i ? { ...r, item: e.target.value } : r)),
                                  )
                                }
                                placeholder="e.g. New freezer"
                                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm focus:border-brand focus:bg-white focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="number"
                                min={0}
                                value={row.amount || ''}
                                onChange={(e) =>
                                  setUseOfFunds((rows) =>
                                    rows.map((r, j) =>
                                      j === i ? { ...r, amount: Number(e.target.value) || 0 } : r,
                                    ),
                                  )
                                }
                                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-right text-sm tabular-nums focus:border-brand focus:bg-white focus:outline-none"
                              />
                            </td>
                            <td className="px-1 text-center">
                              {useOfFunds.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setUseOfFunds((rows) => rows.filter((_, j) => j !== i))}
                                  className="text-slate-300 hover:text-rose-500"
                                  aria-label="Remove line"
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50/60 font-semibold text-slate-800">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatGyd(useOfFunds.reduce((sum, r) => sum + r.amount, 0))}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseOfFunds((rows) => [...rows, { item: '', amount: 0 }])}
                    className="mt-2 text-xs font-semibold text-brand underline"
                  >
                    Add a line
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField
                    label="Monthly income"
                    value={income}
                    onChange={setIncome}
                    hint="Your own income, if you want GDB to take it into account."
                  />
                  <TextField
                    label="Phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={setPhone}
                    placeholder="600 1234"
                    hint="Guyana number. The +592 is added for you."
                  />
                </div>
              </Section>

              <Section
                letter="J"
                title="Where GDB should pay you"
                blurb="If your loan is approved, funds go to this account. It must be in your own name."
              >
                {accountsLoading && (
                  <p className="text-sm text-slate-500">Finding accounts registered in your name…</p>
                )}

                {!manualAccount && (myAccounts?.length ?? 0) > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">
                      {myAccounts?.length === 1
                        ? 'This account is registered in your name.'
                        : `You hold ${myAccounts?.length} accounts. Which should GDB pay into?`}
                    </p>
                    {myAccounts?.map((a) => {
                      const payable = a.status === 'Active';
                      return (
                        <ChoiceCard
                          key={`${a.bank}-${a.account_number}`}
                          title={a.bank}
                          body={`••••${a.account_number.slice(-4)}${a.account_type ? ` · ${a.account_type}` : ''} · ${a.account_name ?? ''}`}
                          note={
                            payable
                              ? undefined
                              : `${a.status} — your bank cannot receive a payment into this account.`
                          }
                          disabled={!payable}
                          selected={accountNo === a.account_number}
                          onSelect={() => selectAccount(a)}
                        />
                      );
                    })}
                    <p className="text-xs text-slate-500">
                      {myAccounts?.[0]?.source === 'bank_registry'
                        ? 'From your bank. GDB confirms it again before paying out.'
                        : 'Test data — GDB confirms the account with your bank before paying out.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualAccount(true);
                        setAccountNote(null);
                      }}
                      className="text-xs font-semibold text-brand underline"
                    >
                      Pay into a different account
                    </button>
                  </div>
                )}

                {manualAccount && (
                  <>
                    <SelectField
                      label="Bank"
                      required
                      value={bank}
                      onChange={(v) => {
                        setBank(v);
                        setAccountCheck(null);
                      }}
                      options={banks}
                      placeholder="Select your bank…"
                    />
                    <div onBlur={() => void checkTypedAccount()}>
                      <TextField
                        label="Account number"
                        required
                        inputMode="numeric"
                        value={accountNo}
                        onChange={(v) => {
                          setAccountNo(v);
                          setAccountCheck(null);
                        }}
                        placeholder="Digits only, as printed on your statement"
                      />
                    </div>
                    <TextField
                      label="Branch code"
                      value={branchCode}
                      onChange={setBranchCode}
                      placeholder="e.g. DEM-GT-04"
                    />

                    {checking && <p className="text-xs text-slate-500">Checking with the bank…</p>}

                    {/* Three outcomes, never two. "We could not check" is said
                        out loud rather than shown as a pass — and none of them
                        stops the application. */}
                    {accountCheck && !checking && (
                      <Notice tone={accountCheck.result === 'Verified' ? 'good' : 'warn'}>
                        {accountCheck.result === 'Verified' &&
                          `Confirmed — held by ${accountCheck.account_name}.`}
                        {accountCheck.result === 'Name Mismatch' &&
                          'Your bank holds this account in a different name. You can still apply; GDB will check it before paying out.'}
                        {accountCheck.result === 'Inactive Account' &&
                          `This account is ${accountCheck.status?.toLowerCase()} and cannot receive a payment. Nominate another one.`}
                        {accountCheck.result === 'Not Found' &&
                          'Your bank has no account with this number. Check the digits against your statement.'}
                        {accountCheck.result === 'Unavailable' &&
                          'We could not reach your bank to check this. You can still apply; GDB will verify it before paying out.'}
                      </Notice>
                    )}

                    {accountNote && <Notice tone="warn">{accountNote}</Notice>}

                    {(myAccounts?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setManualAccount(false);
                          setAccountCheck(null);
                          setAccountNote(null);
                        }}
                        className="text-xs font-semibold text-brand underline"
                      >
                        Back to my registered accounts
                      </button>
                    )}
                  </>
                )}
              </Section>
            </>
          )}

          {/* ------------------------------------------------- STEP: EVIDENCE */}
          {step === 'evidence' && (
            <>
              <Section
                letter="K"
                title="Check your application"
                blurb="This is what GDB will see. Go back to any step to change it."
              >
                <dl className="divide-y divide-slate-100 text-sm">
                  {[
                    ['Applying as', structure || '—'],
                    [
                      'Filed against',
                      forCluster && cluster ? cluster.name : 'Your own application',
                    ],
                    ...(structure === 'Partnership'
                      ? [['Partners', validCoApplicants.join(', ') || '—'] as [string, string]]
                      : []),
                    ['Business', `${businessName || '—'}${dcra ? ` · ${dcra}` : ''}`],
                    ['Kind', stage === 'Existing' ? 'Existing business' : stage === 'New' ? 'New venture' : '—'],
                    ['Sector', val('sector') || '—'],
                    ['Amount requested', amount ? formatGyd(Number(amount)) : '—'],
                    ['Term', `${term} months`],
                    ['Interest', '0% — interest free'],
                    ['Paid into', bank ? `${bank} ••••${accountNo.slice(-4)}` : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="text-right font-semibold text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>

              {draft && (
                <Section
                  letter="L"
                  title="Your documents"
                  blurb="Attach what you have. You can also submit now and send the rest when GDB asks."
                >
                  <DocumentShelf application={draft.name} canUpload onChange={setMissing} />
                </Section>
              )}

              <div className="rounded-lg bg-slate-50/80 p-5">
                <p className="text-sm font-bold text-slate-900">Submit to GDB</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {missing.length > 0 ? (
                    <>
                      You can submit now. GDB will ask for your <strong>{missing.join(', ')}</strong>{' '}
                      during review — attaching it first usually means a faster decision.
                    </>
                  ) : (
                    'Everything GDB expects is attached. An underwriter reviews your application next and may come back to you with questions.'
                  )}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onFinalSubmit()}
                  className="mt-4 w-full rounded-md bg-brand px-5 py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
                >
                  {busy ? 'Submitting…' : 'Submit my application'}
                </button>
                <p className="mt-2 text-center text-xs text-slate-400">
                  By submitting you confirm the information is true to the best of your knowledge.
                </p>
              </div>
            </>
          )}
        </Card>

        {/* Sticky actions: one blocker, one primary next action. */}
        {!isLast && (
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <button
              type="button"
              onClick={goBack}
              disabled={index === 0}
              className="rounded-md px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
            >
              Back
            </button>
            <span className="order-last w-full text-xs text-slate-400 sm:order-none sm:w-auto">
              {draft ? 'Saved to GDB as a draft' : 'Saved on this device — not sent to GDB yet'}
            </span>
            <button
              type="button"
              onClick={() => void goNext()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? 'Saving…' : step === 'funding' ? 'Save and continue' : 'Continue'}
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
