import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { ApplicationDocuments, type DocRow } from '../components/apply/ApplicationDocuments';
import { DataTable } from '../components/ui/DataTable';
import { Card } from '../components/ui/Card';
import { ArrowRightIcon, CheckIcon } from '../components/ui/icons';
import { AttentionList, QuestionGroup, ReviewSections, StepRail } from '../components/apply/wizard';
import {
  ChoiceCard,
  MoneyField,
  Notice,
  ReadOnlyField,
  Section,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/apply/fields';
import { matchRegion, REGIONS } from '../components/apply/cluster';
import { OwnershipBlock } from '../components/apply/ownership';
import { EMPTY_EID, isCompleteEid } from '../eid';
import type {
  BankAccountRecord,
  CitizenProfile,
  DcraRecord,
  LoanApplication,
  OwnershipRow,
  UseOfFundsRow,
} from '../types';
import { encodeUseOfFunds, formatDate, formatGyd, parseUseOfFunds } from '../utils';
import { CONSENT_TEXT } from '../shared/consent';

/** The guided application.
 *
 *  Deliberately a wizard, not one long form. The first answers change what the
 *  rest of the application may ask: an existing trading business is asked for
 *  its financials, and a start-up for the plan it intends to trade on. Group
 *  (cluster) applications are not filed here: a GDB facilitator prepares them
 *  (features/facilitator).
 *
 *  A single scrolling form cannot express that, and it also cannot
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
type Structure = '' | 'Sole Trader' | 'Partnership' | 'Incorporated (Inc.)';

/** What DCRA's own `business_type` means in the words this form uses. The
 *  register tells three kinds of ownership apart and the portal asks the same
 *  three, so a business that already has a registration is never asked to
 *  repeat what the register already says — the applicant cannot answer it
 *  better than DCRA can, and two answers to one question is how a company
 *  reaches the Bank filed as a sole trader.
 */
const DCRA_STRUCTURE: Record<string, Structure> = {
  'Business Name': 'Sole Trader',
  Company: 'Incorporated (Inc.)',
  Partnership: 'Partnership',
};

/** How each structure reads in a sentence, for the line that tells the
 *  applicant what was taken from the register on their behalf. Silently
 *  deciding this for somebody and never saying so is how they reach the review
 *  step and find "Applying as" holding a word they never chose. */
const STRUCTURE_LABEL: Record<string, string> = {
  'Sole Trader': 'Sole proprietorship',
  'Incorporated (Inc.)': 'Incorporated (Inc.)',
  Partnership: 'Partnership',
};

const STRUCTURE_PROSE: Record<string, string> = {
  'Sole Trader': 'a sole proprietorship',
  'Incorporated (Inc.)': 'an incorporated company',
  Partnership: 'a partnership',
};

/** The ownership DCRA asserts for a registration, or '' when the register
 *  cannot answer: no registration against the e-ID, details the applicant
 *  typed themselves, DCRA unreachable, or a `business_type` this portal does
 *  not recognise. Every one of those falls back to ASKING, because the
 *  alternative is filing somebody as something nobody chose. */
const deriveStructure = (b: DcraRecord | null): Structure =>
  (b?.business_type && DCRA_STRUCTURE[b.business_type]) || '';

type StepId =
  | 'consent'
  | 'route'
  | 'about'
  | 'business'
  | 'operations'
  | 'finances'
  | 'funding'
  | 'evidence';

const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: 'consent', title: 'Consent', blurb: 'Your consent before you apply.' },
  { id: 'route', title: 'Application type', blurb: 'Applicant type and legal structure.' },
  { id: 'about', title: 'About you', blurb: 'Identity details are verified against your e-ID.' },
  { id: 'business', title: 'Business details', blurb: 'Open one group at a time.' },
  { id: 'operations', title: 'Operations', blurb: 'Optional operating information.' },
  { id: 'finances', title: 'Financial information', blurb: 'Financial position of the business.' },
  { id: 'funding', title: 'Funding', blurb: 'Loan amount, tenor and disbursement account.' },
  { id: 'evidence', title: 'Review', blurb: '' },
];

/** Which section an expected document belongs to, so the review flags it
 *  against the right row. Anything else is shown under Documents only. */
const DOC_SECTION: Record<string, StepId> = {
  Identity: 'about',
  'Proof of Address': 'about',
  Financials: 'finances',
  'Business Plan': 'finances',
};

const OTHER_DOC: DocRow = {
  type: 'Other',
  title: 'Other supporting documents',
  hint: 'Letters of support, contracts or licences',
};

type Sections = Record<string, string>;

// The Business details step's groups, by the section keys each one asks.
const BRIEF_KEYS = ['executive_summary', 'products_services', 'unique_selling_point'];
const MARKET_KEYS = ['customer_segments', 'target_market', 'competitors'];
const DIRECTION_KEYS = ['vision', 'mission', 'goals'];

/** Everything the wizard holds before GDB has a Loan Application for it.
 *  Saved server-side on the applicant's own profile
 *  (profiles.save_pending_application) — lending refuses a Loan Application
 *  with no amount or tenor, and writing placeholder figures to get past that
 *  would put numbers in the Bank's record that nobody typed. */
interface Saved {
  stage: '' | 'Existing' | 'New';
  structure: Structure;
  coApplicants: string[];
  amount: string;
  term: string;
  income: string;
  purpose: string;
  dcra: string;
  businessName: string;
  sections: Sections;
  useOfFunds: UseOfFundsRow[];
  step: StepId;
  applicantShare?: string;
  owners?: OwnershipRow[];
  profileDob?: string;
  profilePhone?: string;
  profileEmail?: string;
  profileAddress?: string;
}

/** A GDB Field Officer filling this form WITH the applicant, under their
 *  consent (features/field-officer/AssistedApply). The form is the same one;
 *  what changes is whose name it shows, where its URLs live, and that it ends
 *  in handing the draft back rather than submitting it. */
export interface AssistMode {
  consent: string;
  applicantName: string | null;
  applicantEid: string | null;
  /** Where this form's own URLs live (`/apply` for the applicant). */
  base: string;
  /** Where "back" goes. */
  home: string;
}

export function Apply({ assist }: { assist?: AssistMode } = {}) {
  const navigate = useNavigate();
  const { user: signedIn } = useAuth();
  // Whose application this is. Assisted, it is the applicant's — never the
  // officer at the keyboard.
  const user = assist ? { full_name: assist.applicantName ?? '', eid: assist.applicantEid } : signedIn;
  const base = assist?.base ?? '/apply';
  // Assisted: how the officer finished — handed back, or submitted for them.
  const [assistDone, setAssistDone] = useState<{ name: string; submitted: boolean } | null>(null);
  // Present on `/apply/:name` and absent on `/apply/new`. That single
  // difference is what tells resuming a specific draft apart from starting a
  // fresh application — the two used to share one route and one blob of
  // browser storage, which is why "start an application" continued the last
  // abandoned one.
  // `pid` is an unfinished application kept on the profile (`/apply/draft/:pid`).
  const { name: routeName, pid } = useParams<{ name: string; pid: string }>();

  const [step, setStep] = useState<StepId>('consent');
  // The furthest step the applicant has reached. Going back to change an
  // answer must not cost the way forward again: every step up to this one
  // stays one click away on the rail.
  const [furthest, setFurthest] = useState<StepId>('consent');
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
  const [purpose, setPurpose] = useState('');
  const [dcra, setDcra] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [sections, setSections] = useState<Sections>({});
  const [useOfFunds, setUseOfFunds] = useState<UseOfFundsRow[]>([{ item: '', amount: 0 }]);
  // How much of the business the applicant owns, and who owns the rest. Asked
  // of a partnership and of an incorporated company; a sole trader owns all of
  // it and a cluster is not owned in shares at all. Declared, never verified
  // here — naming a co-owner is not the same as that person agreeing.
  const [applicantShare, setApplicantShare] = useState('');
  const [owners, setOwners] = useState<OwnershipRow[]>([]);

  // Section A — about the applicant. Name and e-ID come straight off
  // `whoami`, never asked. These four are the GDB Citizen Profile's own
  // declared block — the same fields the standalone Profile page edits —
  // pre-filled here from what the e-ID directory asserted at sign-in.
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [profileDob, setProfileDob] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileAddress, setProfileAddress] = useState('');

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
  // "Do you have a DCRA registration number?" — asked of an existing business.
  // A restored draft that already carries a number has answered it.
  const [hasDcra, setHasDcra] = useState<'yes' | 'no' | null>(null);
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
  const [tab, setTab] = useState<'application' | 'documents'>('application');


  // Ownership shares are a question only where ownership is divided. A sole
  // trader owns all of it.
  const sharesApply = structure === 'Partnership' || structure === 'Incorporated (Inc.)';

  // What the register says this business is, and whether it said anything at
  // all. When it did, the ownership cards come off the screen: DCRA has
  // already answered, and the only thing asking again can add is a different
  // answer to the same question. When it did not, they stay — see
  // `deriveStructure` for every way that happens.
  const registryStructure = deriveStructure(dcraRecord);
  const registryAnswers = stage === 'Existing' && Boolean(registryStructure);

  // Who owns a REGISTERED business is the register's answer too — DCRA names
  // the proprietors of the registration this application is filed against, and
  // they are shown on the business step from the record itself. So the
  // ownership block is asked only where nothing answered it: a new venture,
  // or an existing one DCRA could not speak for.
  const askOwnership = sharesApply && !registryAnswers;

  // The register has not spoken YET — the lookup is still running, or it
  // returned businesses and none has been picked. Neither is an answer of
  // "DCRA cannot help", and treating them as one is what put the ownership
  // cards on screen for as long as the fetch took, only to replace them the
  // moment the record landed.
  const registryPending =
    stage === 'Existing' &&
    (looking || myBusinesses === null || ((myBusinesses?.length ?? 0) > 0 && !dcraRecord));
  const dcraAnswer = hasDcra ?? (dcra.trim() ? 'yes' : null);
  // Rows that actually name somebody. A blank line in a form is not a co-owner.
  const namedOwners = owners.filter((o) => isCompleteEid(o.eid) || o.name.trim());
  const sharesDeclared =
    Number(applicantShare || 0) + namedOwners.reduce((sum, o) => sum + Number(o.share || 0), 0);

  // Who GDB heard this from. DCRA is the only source there is: either the
  // register answered, or nothing is confirmed.
  const dcraSourceLabel = dcraRecord?.source === 'dcra' ? 'Confirmed by DCRA' : 'Not confirmed';

  const steps = STEPS;

  const set = (key: string) => (v: string) => setSections((s) => ({ ...s, [key]: v }));
  const val = (key: string) => sections[key] ?? '';
  // A section answer can come back from the server as a number (an Int field),
  // so anything shown in a box or trimmed goes through String().
  const text = (key: string) => String(sections[key] ?? '');
  const filled = (keys: string[]) => keys.filter((k) => text(k).trim()).length;

  // Which Business details group is open. One at a time.
  const [openGroup, setOpenGroup] = useState(1);
  const toggleGroup = (n: number) => setOpenGroup((g) => (g === n ? 0 : n));
  const jobKeys =
    stage === 'Existing'
      ? ['jobs_created', 'staff_count', 'employment_impact']
      : ['jobs_created', 'employment_impact'];
  const identityTotal = stage === 'Existing' ? 3 : 2;
  const identityAnswered = [businessName, stage === 'Existing' ? dcra : 'n/a', text('sector')].filter(
    (v) => v.trim() && v !== 'n/a',
  ).length;

  // --- resume -------------------------------------------------------------
  /** Load a draft back from GDB. This is the resume path: the server holds the
   *  application, so what is read here is what the Bank will see, not what a
   *  particular browser happens to remember. */
  /** The application this component instance is already holding in its own
   *  state. Saving a draft switches the URL from `/apply/new` to
   *  `/apply/<name>`, which changes `routeName` — and without this the resume
   *  effect would treat that as "open a different draft", re-read it from the
   *  server and reset the wizard to its first step. The applicant would be
   *  thrown back to step 2 at the exact moment their work was first saved. */
  const loaded = useRef<string | null>(null);

  const resumeFromServer = async (name: string) => {
    loaded.current = name;
    setBusy(true);
    try {
      const loan = await call<LoanApplication>('gdb_bank.api.loan_detail', { name });
      if (loan.status !== 'Draft') {
        // Already submitted: there is nothing to edit, and the case page is
        // where it now lives.
        navigate(assist ? `/field/cases/${name}` : `/loans/${name}`, { replace: true });
        return;
      }
      if (loan.cluster) {
        // A group's draft is its facilitator's to prepare; the head reads it.
        navigate(`/loans/${name}`, { replace: true });
        return;
      }
      if (loan.product === 'quick') {
        // A Quick Loan draft is resumed on its own form.
        if (assist) {
          setError('Quick Loan drafts are completed by the applicant.');
          return;
        }
        navigate(`/apply/quick/${name}`, { replace: true });
        return;
      }
      setDraft(loan);
      setStage((loan.business_stage as '' | 'Existing' | 'New') ?? '');
      const filedAs = ((loan.sections?.legal_structure as Structure) ?? '') as Structure;
      setStructure(filedAs);
      setAmount(loan.loan_amount ? String(loan.loan_amount) : '');
      setTerm(loan.term_months ? String(loan.term_months) : '12');
      setIncome(loan.monthly_income ? String(loan.monthly_income) : '');
      setProfilePhone((cur) => cur || loan.phone || '');
      setPurpose(loan.purpose ?? '');
      setDcra(loan.dcra_number ?? '');
      setBusinessName(loan.business_name ?? '');
      setSections((loan.sections ?? {}) as Sections);
      setUseOfFunds(
        loan.use_of_funds?.length ? loan.use_of_funds : [{ item: '', amount: 0 }],
      );
      setApplicantShare(loan.applicant_share != null ? String(loan.applicant_share) : '');
      // A draft saved before the ownership table existed carries its partners
      // only as the co_applicants e-ID list. Seed the rows from it so resuming
      // one shows the partners it was filed with rather than an empty block —
      // with no shares, because that draft never recorded any.
      const declared = (loan.sections?.co_applicants as string | undefined) ?? '';
      const named = declared.split(',').map((s) => s.trim()).filter(Boolean);
      setOwners(
        loan.ownership_lines?.length
          ? loan.ownership_lines
          : named.map((eid) => ({ eid, name: '', share: 0 })),
      );
      setCoApplicants(named.length ? named : [EMPTY_EID]);
      // A resumed draft is past the consent question by definition — it could
      // not have been saved otherwise — so open it on the first step that
      // actually asks something.
      setStep('route');
      // GDB only holds a draft once the funding step has been left, so a
      // resumed draft has been through every step: all of them are reachable.
      setFurthest('evidence');
      setRestored(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'That application could not be opened.',
      );
    } finally {
      setBusy(false);
    }
  };

  // The application in progress before GDB holds a Loan Application for it.
  // Server-side, so it survives a closed tab or another device and leaves
  // nothing personal in this browser. `pendingSavedOn` is the stamp this window
  // last saw; the server refuses a save made over somebody else's newer one.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingSavedOn, setPendingSavedOn] = useState<string | null>(null);
  const loadedPending = useRef<string | null>(null);

  const hydrate = (s: Saved) => {
    setStage(s.stage ?? '');
    setStructure(s.structure ?? '');
    setCoApplicants(s.coApplicants?.length ? s.coApplicants : [EMPTY_EID]);
    setAmount(s.amount ?? '');
    setTerm(s.term ?? '12');
    setIncome(s.income ?? '');
    setPurpose(s.purpose ?? '');
    setDcra(s.dcra ?? '');
    setBusinessName(s.businessName ?? '');
    setSections(s.sections ?? {});
    // A use-of-funds saved before the table existed is one free-text
    // sentence — carried forward as a single row rather than dropped.
    const legacyUseOfFunds = s.sections?.use_of_funds;
    setUseOfFunds(
      s.useOfFunds?.length
        ? s.useOfFunds
        : (parseUseOfFunds(legacyUseOfFunds) ??
            (legacyUseOfFunds ? [{ item: legacyUseOfFunds, amount: 0 }] : [{ item: '', amount: 0 }])),
    );
    setApplicantShare(s.applicantShare ?? '');
    setOwners(s.owners ?? []);
    setProfileDob((cur) => s.profileDob || cur);
    setProfilePhone((cur) => s.profilePhone || cur);
    setProfileEmail((cur) => s.profileEmail || cur);
    setProfileAddress((cur) => s.profileAddress || cur);
    // Consent is the server's record and is re-checked on its own; a step id
    // from an older wizard would point nowhere, so only a current one is used.
    if (s.step && s.step !== 'consent' && STEPS.some((st) => st.id === s.step)) {
      setStep(s.step);
      setFurthest(s.step);
    }
  };

  useEffect(() => {
    // `/apply/:name` resumes that Loan Application draft from GDB.
    if (routeName) {
      // Already ours — this is the URL catching up with a draft we just saved,
      // not a request to open a different one.
      if (loaded.current === routeName) return;
      void resumeFromServer(routeName);
      return;
    }
    // `/apply/draft/:pid` continues that unfinished application. `/apply/new`
    // is always a new one — it never reopens a draft.
    if (pid) {
      if (loadedPending.current === pid) return;
      loadedPending.current = pid;
      call<{ id: string; state: Saved; saved_on: string }>('gdb_bank.profiles.pending_application', { id: pid })
        .then((p) => {
          hydrate(p.state);
          setPendingId(p.id);
          setPendingSavedOn(p.saved_on);
          setRestored(true);
        })
        .catch((err: Error) => setError(err.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeName, pid]);

  const snapshot = (at: StepId): Saved => ({
    stage,
    structure,
    coApplicants,
    amount,
    term,
    income,
    purpose,
    dcra,
    businessName,
    sections,
    useOfFunds,
    step: at,
    applicantShare,
    owners,
    profileDob,
    profilePhone,
    profileEmail,
    profileAddress,
  });

  /** Save wherever this application lives now: the Loan Application draft
   *  once GDB holds one, the profile's in-progress copy before that. `at` is
   *  the step it should reopen on. */
  const saveProgress = async (at: StepId = step) => {
    if (draft) {
      await saveDraft();
      return;
    }
    const saved = await call<{ id: string; saved_on: string }>('gdb_bank.profiles.save_pending_application', {
      state: snapshot(at),
      id: pendingId ?? undefined,
      saved_on: pendingSavedOn,
    });
    setPendingSavedOn(saved.saved_on);
    if (!pendingId) {
      setPendingId(saved.id);
      // The URL becomes the one that continues it, so a reload does too.
      loadedPending.current = saved.id;
      navigate(`${base}/draft/${saved.id}`, { replace: true });
    }
  };

  // --- reference data -----------------------------------------------------
  useEffect(() => {
    call<string[]>('gdb_bank.api.bank_options').then(setBanks).catch(() => setBanks([]));
    void loadMyAccounts();
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((p) => {
        setConsentAccepted(Boolean(p?.consent_version));
        setProfile(p);
        // Prefer what the applicant already declared over the directory's
        // assertion, and never overwrite a value a restored draft already
        // holds — a functional update is what makes both true at once.
        // No invented value: when neither the applicant nor the e-ID directory
        // gave a birth date the field stays empty, and the step asks for it.
        setProfileDob((cur) => cur || p.date_of_birth || p.verified_birth_date || '');
        setProfilePhone((cur) => cur || p.phone || p.verified_phone || '');
        setProfileEmail((cur) => cur || p.email || p.verified_email || '');
        setProfileAddress((cur) => cur || p.address || p.verified_address || '');
      })
      .catch(() => setConsentAccepted(false));
  }, []);

  // Consent is the server's record, not the device's: a restored draft that
  // points past it is sent back to ask. A returning citizen who already
  // agreed is NOT skipped past the screen — every new application shows it
  // again and asks for a deliberate Continue, even though the checkbox
  // itself comes pre-checked from that earlier record.
  useEffect(() => {
    if (consentAccepted === false && step !== 'consent') setStep('consent');
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
        setAccountNote('No account found in your name. Enter it below; GDB verifies it before disbursement.');
      }
    } catch {
      setMyAccounts([]);
      setManualAccount(true);
      setAccountNote('Bank unavailable. Enter your account; GDB verifies it before disbursement.');
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

  // SelectField ties an option's value to its visible label, so the
  // registration number is folded into the label itself rather than hidden
  // behind it — the dropdown still resolves back to a DcraRecord by matching
  // this same string.
  const businessOption = (b: DcraRecord) =>
    `${b.business_name ?? b.registration_number} (${b.registration_number})`;

  const selectBusiness = (b: DcraRecord, opts?: { keepStructure?: boolean }) => {
    setDcraRecord(b);
    setDcra(b.registration_number);
    setBusinessName(b.business_name ?? '');
    setDcraNote(null);
    // The register's answer to "how is this owned", taken rather than asked.
    // Only where it HAS one — an unrecognised `business_type` leaves the cards
    // on screen rather than guessing.
    const fromRegistry = deriveStructure(b);
    if (fromRegistry) {
      setStructure((current) => {
        // Auto-selection while a draft is being restored must not overwrite
        // what the applicant already filed. Only an empty structure is filled
        // in on that path; picking from the dropdown always re-derives.
        if (opts?.keepStructure && current) return current;
        return fromRegistry;
      });
    }
    if (b.region)
      setSections((s) => ({ ...s, operating_location: s.operating_location || matchRegion(b.region!) }));
  };

  const loadMyBusinesses = async () => {
    setLooking(true);
    try {
      const found = await call<DcraRecord[]>('gdb_bank.api.my_businesses');
      setMyBusinesses(found ?? []);
      // A resumed draft already knows its registration number but not the
      // record behind it. Re-attaching it here is what puts the registry's
      // ownership back on screen instead of falling back to the cards —
      // `keepStructure` so what the applicant filed still wins over it.
      const resumed = dcra.trim() && found?.find((b) => b.registration_number === dcra.trim());
      if (resumed) selectBusiness(resumed, { keepStructure: true });
      else if (found?.length === 1) selectBusiness(found[0], { keepStructure: true });
      if (!found?.length) {
        setManualEntry(true);
        setDcraNote('No DCRA registration found for your e-ID. Enter the details; GDB will verify them.');
      }
    } catch {
      setMyBusinesses([]);
      setManualEntry(true);
      setDcraNote('DCRA unavailable. Enter the details; GDB will verify them.');
    } finally {
      setLooking(false);
    }
  };

  // A restored draft only carries `stage` and `dcra` — the fetched business
  // list itself is never persisted. Without this, reloading mid-draft on the
  // existing-business route would show "DCRA has no business registered" even
  // though the list simply has not been re-fetched yet.
  useEffect(() => {
    if (stage === 'Existing' && myBusinesses === null) void loadMyBusinesses();
  }, [stage, myBusinesses]);

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
            ? 'Your e-ID is not listed as a proprietor. GDB will verify your connection.'
            : null,
        );
        if (result.region) {
          setSections((s) => ({
            ...s,
            operating_location: s.operating_location || matchRegion(result.region!),
          }));
        }
      } else {
        setDcraRecord(null);
        setDcraNote(
          result.status === 'Not Found'
            ? 'No DCRA record for that registration number.'
            : 'DCRA unavailable. GDB will verify the number.',
        );
      }
    } catch {
      setDcraRecord(null);
      setDcraNote('DCRA unavailable. GDB will verify the number.');
    } finally {
      setDcraChecking(false);
    }
  };

  /** A typed DCRA number. An edit away from the last confirmed number
   *  invalidates that confirmation at once — nothing may show a stale hit. */
  const onDcraChange = (v: string) => {
    const next = v.toUpperCase();
    setDcra(next);
    if (next !== lastCheckedDcra.current) {
      setDcraRecord(null);
      setDcraNote(null);
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
          ? 'Select the disbursement account.'
          : 'Enter the disbursement account.',
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
      // Asked once, under "About you" — the same number goes on the application.
      phone: profilePhone,
      business_stage: stage,
      dcra_number: dcra,
      business_name: businessName,
      // Always this applicant's own. Group applications are filed by a facilitator.
      cluster: '',
      sections: {
        ...sections,
        legal_structure: structure,
        // Only complete e-IDs travel. A half-typed one is not a partner.
        // Kept in step with the ownership rows, which are now where partners
        // are named: this field is what the desk and older readers show, and
        // leaving it to the retired input would have emptied it on every save.
        co_applicants:
          structure === 'Partnership'
            ? namedOwners.map((o) => o.eid).filter(isCompleteEid).join(', ')
            : '',
        use_of_funds: encodeUseOfFunds(useOfFunds),
        // Shares only where shares exist. A sole trader owns the whole thing
        // and a cluster is not owned in percentages, so sending a figure for
        // either would put a number in the Bank's record that means nothing.
        applicant_share: askOwnership ? applicantShare || 0 : 0,
        ownership_lines: askOwnership ? namedOwners : [],
      },
      name: draft?.name,
      // The unfinished copy this draft continues; the server forgets it now.
      pending: draft ? undefined : (pendingId ?? undefined),
    });
    setDraft(saved);
    setPendingId(null);
    // Claim it before the URL changes, so the resume effect below knows this
    // draft is already on screen and leaves the wizard where it is.
    loaded.current = saved.name;
    // The draft now exists at GDB, so the URL becomes the one that resumes it.
    // Without this a reload would land back on `/apply/new` and open an empty
    // form beside a draft that already exists.
    if (!routeName && saved.name) navigate(`${base}/${saved.name}`, { replace: true });
    return saved;
  };

  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === step),
  );
  const current = steps[index];
  const isLast = index === steps.length - 1;
  // How far along the rail the applicant may go: as far as they have been.
  const reached = Math.max(
    index,
    steps.findIndex((s) => s.id === furthest),
  );
  useEffect(() => {
    if (index > steps.findIndex((s) => s.id === furthest)) setFurthest(step);
  }, [index, steps, furthest, step]);

  /** What a step still needs before it can be left, or null when it is
   *  complete. Presentation only — the server re-checks everything. A plain
   *  function of the answers, so the rail can ask it of ANY step, not only the
   *  one on screen. */
  const blockerFor = (step: StepId): string | null => {
    if (step === 'consent') {
      if (!consentAccepted && !consentChecked) return 'Give your consent to continue.';
    }
    if (step === 'route') {
      if (!stage) return 'Select the application type.';
      // The server refuses an existing business without its DCRA number
      // (services/application.py), so "No" cannot go on as one.
      if (stage === 'Existing') {
        if (!dcraAnswer) return 'Tell us whether you have a DCRA registration number.';
        if (dcraAnswer === 'no') return 'An existing business applies with its DCRA number. Apply as a new venture instead.';
        if (!dcra.trim()) return 'Enter the DCRA registration number.';
      }
      if (registryPending && looking) return 'Checking the register…';
      if (!structure) return 'Select the legal structure.';
      // These three hold the screen open on the ownership block. They are
      // asked ONLY while that block is on it — a rule about a question the
      // applicant cannot see is a dead end, not a check.
      if (askOwnership && structure === 'Partnership' && namedOwners.length === 0) {
        return 'Name at least one partner.';
      }
      if (askOwnership && !applicantShare) {
        return 'Enter your ownership share.';
      }
      // Over 100% cannot be true of anything, and the server refuses it too.
      // Under 100% is deliberately allowed — see OwnershipBlock.
      if (askOwnership && sharesDeclared > 100) {
        return `Ownership shares total ${sharesDeclared}%. They cannot exceed 100%.`;
      }
    }
    if (step === 'about') {
      if (!profileDob) return 'Enter your date of birth.';
      if (!profilePhone.trim()) return 'Enter your phone number.';
      // Guyana numbers are seven digits (592 in front when typed with the
      // country code). The server applies the full check on save.
      const phoneDigits = profilePhone.replace(/\D/g, '');
      if (
        !profilePhone.trim().startsWith('+') &&
        !(phoneDigits.length === 7 || (phoneDigits.length === 10 && phoneDigits.startsWith('592')))
      ) {
        return 'Enter a valid phone number, e.g. 600 1234.';
      }
      if (!profileEmail.trim()) return 'Enter your email address.';
      if (!profileAddress.trim()) return 'Enter your residential address.';
    }
    if (step === 'business') {
      if (!text('executive_summary').trim()) return 'Enter the executive summary.';
      if (!text('products_services').trim()) return 'Enter the products and services.';
      if (!text('unique_selling_point').trim()) return 'Enter the unique selling proposition.';
      if (!businessName.trim()) return 'Enter the business name.';
      if (stage === 'Existing' && !dcra.trim()) return 'Enter the DCRA registration number.';
      if (!text('sector').trim()) return 'Select the sector.';
    }
    if (step === 'funding') {
      if (!amount || Number(amount) <= 0) return 'Enter the loan amount.';
      if (!term || Number(term) < 1 || Number(term) > 360) return 'Enter a tenor of 1 to 360 months.';
      if (!purpose.trim()) return 'Enter the purpose of the loan.';
      if (!bank || !accountNo) return 'Enter the disbursement account.';
    }
    return null;
  };

  /** Leave the step on screen: its check, then whatever it saves. True when
   *  the step may be left. Shared by Continue and by the rail, so there is one
   *  way out of a step and nothing is saved by one path and skipped by the
   *  other. */
  const leaveStep = async (next: StepId): Promise<boolean> => {
    const blocker = blockerFor(step);
    if (blocker) {
      setError(blocker);
      if (step === 'business') setOpenGroup(BRIEF_KEYS.some((k) => !text(k).trim()) ? 1 : 5);
      return false;
    }
    setError(null);
    if (step === 'consent' && !consentAccepted) {
      if (!(await acceptConsent())) return false;
    }

    // Written to the citizen's own profile — the same record the standalone
    // Profile page edits — not to this application. It is one person's
    // details, not one loan's.
    if (step === 'about') {
      setBusy(true);
      try {
        setProfile(
          await call<CitizenProfile>('gdb_bank.profiles.save_profile', {
            date_of_birth: profileDob,
            phone: profilePhone,
            email: profileEmail,
            address: profileAddress,
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your details');
        setBusy(false);
        return false;
      }
      setBusy(false);
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
        return false;
      }
      setBusy(false);
      return true;
    }

    // Every other step saves too, so the application can be left at any point
    // and resumed from My applications on the step that comes next.
    if (draft || stage) {
      setBusy(true);
      try {
        await saveProgress(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your application');
        setBusy(false);
        return false;
      }
      setBusy(false);
    }
    return true;
  };

  const goNext = async () => {
    const next = steps[Math.min(index + 1, steps.length - 1)].id;
    if (!(await leaveStep(next))) return;
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Rail navigation. Back is free. Forward goes as far as the applicant has
   *  already been, through the same check-and-save Continue runs — and stops
   *  at the first step in between that is no longer complete, because an
   *  answer changed on the way back can make a later step wrong. */
  const jumpTo = async (i: number) => {
    if (i === index || i > reached || busy) return;
    if (i < index) {
      setError(null);
      setStep(steps[i].id);
      return;
    }
    if (!(await leaveStep(steps[i].id))) return;
    const stuck = steps.slice(index + 1, i).find((s) => blockerFor(s.id));
    setStep((stuck ?? steps[i]).id);
    if (stuck) setError(blockerFor(stuck.id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Save, then leave for My applications, where it resumes on this step.
   *  Nothing to save before the application type is chosen — consent is
   *  already recorded on the profile. */
  const exitToApplications = async () => {
    if (draft || stage) {
      setBusy(true);
      setError(null);
      try {
        await saveProgress();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your application');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    navigate(assist?.home ?? '/apply');
  };

  const goBack = () => {
    setError(null);
    setStep(steps[Math.max(index - 1, 0)].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Assisted: submit it for the applicant (recorded as the officer's act,
   *  and the applicant is told), or hand it back for them to submit. */
  const finishAssisted = async (submit: boolean) => {
    if (!assist) return;
    if (submit && !window.confirm(`Submit this application to GDB for ${assist.applicantName ?? 'the applicant'}?`)) return;
    setError(null);
    setBusy(true);
    try {
      const saved = await saveDraft();
      await call(
        submit ? 'gdb_bank.field_officer.submit_assisted_application' : 'gdb_bank.field_officer.hand_off_application',
        { consent: assist.consent, name: saved.name },
      );
      setAssistDone({ name: saved.name, submitted: submit });
    } catch (err) {
      setError(err instanceof Error ? err.message : submit ? 'Could not submit' : 'Could not send to the applicant');
    } finally {
      setBusy(false);
    }
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
      setSubmitted(loan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setBusy(false);
    }
  };

  // --- review -------------------------------------------------------------
  const goTo = (id: StepId) => {
    setTab('application');
    setError(null);
    setStep(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Every expected document the wizard can attach, in the order the tab lists
  // them. Financial evidence follows the route: accounts for a trading
  // business, a plan for a new one.
  const docRows: DocRow[] = [
    ...(stage === 'Existing'
      ? [{ type: 'Financials', title: 'Financial statements', hint: 'Accounts for the last financial year · Financial information' }]
      : []),
    ...(stage === 'New'
      ? [{ type: 'Business Plan', title: 'Business plan', hint: 'With financial projections · Financial information' }]
      : []),
    { type: 'Bank Statement', title: 'Bank statements', hint: 'Business account statements' },
    { type: 'Quotation', title: 'Supplier quotations', hint: 'For items to be financed · Funding' },
    { type: 'Identity', title: 'Identity document', hint: 'National ID or passport · About you' },
    { type: 'Proof of Address', title: 'Proof of address', hint: 'Utility bill or bank letter · About you' },
    OTHER_DOC,
  ];
  const docTitle = (type: string) => docRows.find((r) => r.type === type)?.title ?? type;

  const reviewSteps = steps.filter((s) => s.id !== 'consent' && s.id !== 'evidence');
  const fieldIssues = reviewSteps.flatMap((s) => {
    const blocker = blockerFor(s.id);
    return blocker
      ? [{ section: s.id, title: blocker, where: s.title, kind: 'Required field missing', action: 'Go to field', go: () => goTo(s.id) }]
      : [];
  });
  // Advisory: shown, never a bar to submitting — the Bank chases paperwork.
  const docIssues = missing.map((t) => ({
    section: DOC_SECTION[t] ?? ('evidence' as StepId),
    title: `Attach your ${docTitle(t).toLowerCase()}`,
    where: steps.find((s) => s.id === DOC_SECTION[t])?.title ?? 'Documents',
    kind: 'Optional',
    action: 'Go to documents',
    go: () => setTab('documents'),
  }));
  const issues = [...fieldIssues, ...docIssues];
  // Unanswered questions only. Expected documents are counted apart: they are
  // optional at submission, and showing them as "missing" reads as a question
  // left blank.
  const issuesIn = (id: StepId) => fieldIssues.filter((i) => i.section === id).length;
  const docsIn = (id: StepId) => docIssues.filter((i) => i.section === id).length;

  const lastSaved = draft?.modified ?? pendingSavedOn;
  const savedAt = lastSaved
    ? new Date(lastSaved.replace(' ', 'T')).toLocaleTimeString('en-GY', { hour: '2-digit', minute: '2-digit' })
    : null;
  const statusLine = savedAt ? `Draft · Last saved ${savedAt}` : 'Draft';

  const show = (v: string | null | undefined) => (v && String(v).trim()) || '—';
  const money = (key: string) => (val(key) ? formatGyd(Number(val(key))) : '—');
  const stageLabel = stage === 'Existing' ? 'Existing business' : stage === 'New' ? 'New venture' : '';
  const structureLabel = STRUCTURE_LABEL[structure] ?? '';
  const OPERATIONS_KEYS = ['operating_location', 'production_process', 'equipment_required', 'suppliers', 'permits_required'];

  const summaryFor = (id: StepId): string => {
    const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ');
    switch (id) {
      case 'route':
        return join(stageLabel, structureLabel);
      case 'about':
        return join(
          profile?.verified_full_name || user?.full_name,
          (user?.eid || profile?.eid) && `e-ID ${user?.eid || profile?.eid}`,
          profileAddress,
        );
      case 'business':
        return join(businessName, dcra, val('sector'));
      case 'operations':
        return `Optional · ${OPERATIONS_KEYS.filter((k) => val(k).trim()).length} of ${OPERATIONS_KEYS.length} answered`;
      case 'finances':
        return stage === 'Existing' ? 'Declared figures, last financial year' : stage === 'New' ? 'Projections' : '';
      case 'funding':
        return join(amount && formatGyd(Number(amount)), term && `${term} months`, purpose);
      default:
        return '';
    }
  };

  const answersFor = (id: StepId): [string, string][] => {
    switch (id) {
      case 'route':
        return [
          ['Application type', show(stageLabel)],
          ['Legal structure', show(structureLabel)],
          ...(askOwnership
            ? ([
                ['Your ownership share', applicantShare ? `${applicantShare}%` : '—'],
                ['Other owners', show(namedOwners.map((o) => `${o.name || o.eid} (${o.share || 0}%)`).join(', '))],
              ] as [string, string][])
            : []),
        ];
      case 'about':
        return [
          ['Full name', show(profile?.verified_full_name || user?.full_name)],
          ['e-ID', show(user?.eid || profile?.eid)],
          ['Date of birth', profileDob ? formatDate(profileDob) : '—'],
          ['Phone number', show(profilePhone)],
          ['Email address', show(profileEmail)],
          ['Residential address', show(profileAddress)],
        ];
      case 'business':
        return [
          ['Business name', show(businessName)],
          ...(stage === 'Existing' ? [['DCRA registration', show(dcra)] as [string, string]] : []),
          ['Sector', show(text('sector'))],
          ['Sub-sector', show(text('sub_sector'))],
          ['Executive summary', show(text('executive_summary'))],
          ['Products and services', show(text('products_services'))],
          ['Unique selling proposition', show(text('unique_selling_point'))],
          ['Customer segments', show(text('customer_segments'))],
          ['Target market', show(text('target_market'))],
          ['Competitors', show(text('competitors'))],
          ['Jobs to be created', show(text('jobs_created'))],
          ...(stage === 'Existing' ? [['Current staff', show(text('staff_count'))] as [string, string]] : []),
          ['Employment impact', show(text('employment_impact'))],
          ['Vision', show(text('vision'))],
          ['Mission', show(text('mission'))],
          ['Goals', show(text('goals'))],
        ];
      case 'operations':
        return [
          ['Operating region', show(val('operating_location'))],
          ['Production process', show(val('production_process'))],
          ['Equipment and fixed assets', show(val('equipment_required'))],
          ['Key suppliers', show(val('suppliers'))],
          ['Licences and permits', show(val('permits_required'))],
        ];
      case 'finances':
        return stage === 'Existing'
          ? [
              ['Annual revenue', money('annual_revenue')],
              ['Cost of sales', money('cost_of_sales')],
              ['Operating expenses', money('operating_expenses')],
              ['Annual debt service', money('existing_obligations')],
              ['Cash and bank balances', money('cash_position')],
            ]
          : stage === 'New'
            ? [
                ['Projected sales volume', show(val('expected_sales_volume'))],
                ['Projected annual revenue', money('projected_revenue')],
                ['Projected annual costs', money('projected_costs')],
                ['Start-up costs', money('initial_costs')],
                ['Projected monthly cash flow', money('expected_cash_position')],
                ['Key assumptions', show(val('assumptions'))],
              ]
            : [];
      case 'funding':
        return [
          ['Loan amount', amount ? formatGyd(Number(amount)) : '—'],
          ['Tenor', term ? `${term} months` : '—'],
          ['Interest rate', '0%'],
          ['Purpose', show(purpose)],
          [
            'Use of proceeds',
            show(
              useOfFunds
                .filter((r) => r.item.trim())
                .map((r) => `${r.item} — ${formatGyd(r.amount || 0)}`)
                .join('\n'),
            ),
          ],
          ['Personal monthly income', income ? formatGyd(Number(income)) : '—'],
          ['Disbursement account', bank ? `${bank} ••••${accountNo.slice(-4)}` : '—'],
        ];
      default:
        return [];
    }
  };

  const reviewSections = reviewSteps.map((s) => ({
    id: s.id,
    title: s.title,
    summary: summaryFor(s.id),
    issues: issuesIn(s.id),
    docs: docsIn(s.id),
    answers: answersFor(s.id),
  }));

  if (assistDone && assist) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">
          {assistDone.submitted ? 'Submitted for the applicant' : 'Sent to applicant'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Reference {assistDone.name}. {assistDone.submitted ? 'The applicant has been told.' : 'Waiting for the applicant to submit.'}
        </p>
        <button
          type="button"
          onClick={() => navigate(assist.home)}
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-brand px-6 py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          Done
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Application submitted</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Reference {submitted.name}. Now with an underwriter.
        </p>
        <button
          type="button"
          onClick={() => navigate(`/loans/${submitted.name}`)}
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-brand px-6 py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          View application
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => void exitToApplications()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 transition-colors hover:text-brand disabled:opacity-50"
      >
        <ArrowRightIcon className="h-4 w-4 rotate-180" />
        {assist ? 'Back' : 'My applications'}
      </button>

      {/* Every step is visible from the start, because an applicant deciding
          whether to begin needs to see what the whole thing asks. */}
      <StepRail
        steps={steps}
        index={index}
        reached={reached}
        active={tab === 'application'}
        attention={(id) => id !== 'evidence' && issuesIn(id as StepId) > 0}
        onJump={(i) => {
          setTab('application');
          void jumpTo(i);
        }}
      />

      <div className="flex gap-6 border-b border-slate-200" role="tablist">
        {(
          [
            ['application', 'Your application'],
            ['documents', 'Documents'],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${
              tab === id ? 'border-brand text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'documents' && (
        <Card className="space-y-4 p-6">
          <header>
            <h2 className="text-xl font-bold text-slate-900">Documents</h2>
            <p className="mt-1 text-sm text-slate-500">Each document is linked to its section.</p>
          </header>
          {draft ? (
            <ApplicationDocuments application={draft.name} rows={docRows} onChange={setMissing} />
          ) : (
            <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Available once the Funding step is saved.
            </p>
          )}
          <button
            type="button"
            onClick={() => setTab('application')}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to application
          </button>
        </Card>
      )}

      <div className={`min-w-0 ${tab === 'application' ? '' : 'hidden'}`}>
        {assist && (
          <div className="mb-4">
            <Notice tone="warn">Assisting {assist.applicantName}</Notice>
          </div>
        )}
        {!assist && draft?.handed_off_on && (
          <div className="mb-4">
            <Notice tone="info">Prepared with {draft.assisted_by_name ?? 'a GDB Field Officer'}. Check it and submit.</Notice>
          </div>
        )}
        {restored && (
          <div className="mb-4">
            <Notice tone="info">Resumed from your saved draft.</Notice>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            {error}
          </div>
        )}

        {/* `pb-20` clears the sticky action bar below. Without it the bar
            rests ON the card's last control once the page is scrolled to the
            end — and the last control on a step can be a REQUIRED question,
            so a translucent bar sitting over it is not a cosmetic problem: the
            answer cannot be given, and the click lands on Continue instead. */}
        <Card className={`space-y-6 p-6 ${isLast ? '' : 'pb-20'}`}>
          {!isLast && (
            <header>
              <h2 className="text-xl font-bold text-slate-900">
                {current.title}
                {step === 'business' && stageLabel ? ` · ${stageLabel}` : ''}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {step === 'business' && stageLabel ? `${stageLabel} · ${statusLine}` : statusLine}
              </p>
              {current.blurb && <p className="mt-1 text-sm text-slate-500">{current.blurb}</p>}
            </header>
          )}

          {/* --------------------------------------------------- STEP: CONSENT */}
          {step === 'consent' && (
            <Section letter="1" title="Consent">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50/80 p-3.5">
                <input
                  type="checkbox"
                  checked={consentChecked || Boolean(consentAccepted)}
                  disabled={Boolean(consentAccepted)}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                <span className="text-sm font-medium text-slate-800">{CONSENT_TEXT}</span>
              </label>
            </Section>
          )}

          {/* ---------------------------------------------------- STEP: ROUTE */}
          {step === 'route' && (
            <>
              <Section
                letter="1"
                title="Application type"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    title="Existing business"
                    body="Already trading."
                    selected={stage === 'Existing'}
                    onSelect={() => {
                      setStage('Existing');
                      setHasDcra(null);
                      setDcraNote(null);
                      setDcraRecord(null);
                      setManualEntry(false);
                      // The structure question is asked of an existing
                      // business too, below. It used to be forced to Sole
                      // Trader here, which meant a trading company or
                      // partnership — the ordinary case for a business that
                      // already has a DCRA registration — had no way to say
                      // what it was, and every one of them reached the Bank
                      // filed as a sole trader.
                    }}
                  />
                  <ChoiceCard
                    title="New venture"
                    body="Start-up, not yet registered."
                    selected={stage === 'New'}
                    onSelect={() => {
                      setStage('New');
                      setDcra('');
                      setDcraRecord(null);
                      setDcraNote(null);
                    }}
                  />
                  {/* The Quick Loan is chosen before this form, on "Choose
                      your loan" (/apply/new) — it is a different product on its
                      own short form, not a third stage of this one. */}
                </div>
              </Section>

              {/* An existing business is asked for its DCRA registration right
                  here — not deferred to the business-identity step — so
                  Continue is all that is left once it is given. "No" cannot
                  continue as an existing business: the server requires the
                  number (services/application.py), so it is offered the
                  new-venture form instead, by the applicant's own choice. */}
              {stage === 'Existing' && (
                <Section letter="2" title="Do you have a DCRA registration number?">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      title="Yes"
                      body="Enter it and GDB checks it with DCRA."
                      selected={dcraAnswer === 'yes'}
                      onSelect={() => {
                        setHasDcra('yes');
                        setManualEntry(true);
                      }}
                    />
                    <ChoiceCard
                      title="No"
                      body="The business is not registered with DCRA."
                      selected={dcraAnswer === 'no'}
                      onSelect={() => {
                        setHasDcra('no');
                        setDcra('');
                        setDcraRecord(null);
                        setDcraNote(null);
                        lastCheckedDcra.current = '';
                      }}
                    />
                  </div>

                  {dcraAnswer === 'yes' && (
                    <>
                      {looking && <p className="text-sm text-slate-500">Retrieving DCRA records…</p>}
                      {!looking && (myBusinesses?.length ?? 0) > 0 && (
                        <SelectField
                          label="Registered to your e-ID"
                          value={
                            myBusinesses?.find((b) => b.registration_number === dcra)
                              ? businessOption(myBusinesses.find((b) => b.registration_number === dcra)!)
                              : ''
                          }
                          onChange={(v) => {
                            const chosen = myBusinesses?.find((b) => businessOption(b) === v);
                            if (chosen) selectBusiness(chosen);
                          }}
                          options={(myBusinesses ?? []).map(businessOption)}
                          placeholder="Choose, or type the number below"
                        />
                      )}
                      <div onBlur={() => void checkTypedDcra()}>
                        <TextField
                          label="DCRA registration number"
                          required
                          value={dcra}
                          onChange={onDcraChange}
                          placeholder="BN-2024-004512"
                        />
                      </div>
                      {dcraChecking && <p className="text-sm text-slate-500">Checking DCRA…</p>}
                      {dcraRecord?.business_name && (
                        <Notice tone="good">
                          {dcraRecord.business_name} · {dcraRecord.status} · {dcraSourceLabel}
                        </Notice>
                      )}
                      {dcraNote && <Notice tone="warn">{dcraNote}</Notice>}
                    </>
                  )}

                  {dcraAnswer === 'no' && (
                    <>
                      <Notice tone="warn">
                        An existing business applies with its DCRA registration number. If it is not
                        registered yet, apply as a new venture and fill in its details.
                      </Notice>
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setStage('New');
                            setHasDcra(null);
                            setDcra('');
                            setDcraRecord(null);
                            setDcraNote(null);
                          }}
                          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                        >
                          Apply as a new venture instead
                        </button>
                      </div>
                    </>
                  )}
                </Section>
              )}

              {/* Asked of BOTH routes once the stage is answered. How a
                  business is owned is a fact about it whether or not it is
                  already trading, and an underwriter deciding a development
                  loan needs to know whether they are lending to one person or
                  to their share of something larger.

                  Where DCRA has already said which it is, it is STATED rather
                  than asked — and the only thing left on this screen is the
                  one question the register cannot answer. */}
              {stage && (
                <Section
                  letter={stage === 'Existing' ? '3' : '2'}
                  title="Legal structure"
                  blurb={registryAnswers ? 'From the DCRA register.' : undefined}
                >
                  {registryPending ? (
                    <p className="text-sm text-slate-500">
                      {looking ? 'Retrieving DCRA records…' : 'Select the registered business above.'}
                    </p>
                  ) : registryAnswers ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                      <p className="text-sm text-slate-700">
                        <span className="font-bold text-slate-900">
                          {dcraRecord?.business_name ?? dcra}
                        </span>{' '}
                        — filed as {STRUCTURE_PROSE[registryStructure]}.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Corrections are made at DCRA.</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <ChoiceCard
                        title="Sole proprietorship"
                        selected={structure === 'Sole Trader'}
                        onSelect={() => setStructure('Sole Trader')}
                      />
                      <ChoiceCard
                        title="Incorporated (Inc.)"
                        selected={structure === 'Incorporated (Inc.)'}
                        onSelect={() => setStructure('Incorporated (Inc.)')}
                      />
                      <ChoiceCard
                        title="Partnership"
                        selected={structure === 'Partnership'}
                        onSelect={() => setStructure('Partnership')}
                      />
                    </div>
                  )}

                  {/* A partnership and an incorporated company ask the same
                      two things — what the applicant owns, and who owns the
                      rest — so they share one block. Only the wording differs,
                      because a partner and a shareholder are not the same word
                      to the person filling this in. Co-owners are named by
                      e-ID, never by mailbox: the e-ID is how GDB identifies a
                      person everywhere else in the bank.

                      Not asked of a registered business: DCRA already names
                      who owns it, and the record itself is shown on the
                      business step. */}
                  {askOwnership && (
                    <OwnershipBlock
                      structure={structure}
                      applicantShare={applicantShare}
                      onApplicantShare={setApplicantShare}
                      owners={owners}
                      onOwners={setOwners}
                      declared={sharesDeclared}
                    />
                  )}

                </Section>
              )}
            </>
          )}

          {/* ---------------------------------------------------- STEP: ABOUT */}
          {step === 'about' && (
            <Section
              letter="A"
              title="Applicant details"
            >
              {/* The identity directory's own assertion, shown the same grey
                  way as DCRA's. These two are not answers the applicant gave
                  and must not look like fields they may change — the portal
                  keeps what was VERIFIED apart from what was DECLARED
                  everywhere else (GDB Citizen Profile holds the two blocks
                  separately and never merges them), and this is where that
                  distinction first meets the applicant. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnlyField
                  label="Full name"
                  value={profile?.verified_full_name || user?.full_name}
                  source="From your e-ID"
                  checked={profile?.verified_on ? formatDate(profile.verified_on) : null}
                />
                <ReadOnlyField
                  label="National e-ID"
                  value={user?.eid || profile?.eid}
                  source="From your e-ID"
                />
              </div>

              <TextField
                label="Date of birth"
                type="date"
                value={profileDob}
                onChange={setProfileDob}
                required
                hint={
                  profile && !profile.date_of_birth && !profile.verified_birth_date
                    ? 'Not provided by your e-ID.'
                    : undefined
                }
              />
              <TextField
                label="Phone number"
                type="tel"
                inputMode="tel"
                value={profilePhone}
                onChange={setProfilePhone}
                required
                placeholder="600 1234"
              />
              <TextField
                label="Email address"
                type="email"
                value={profileEmail}
                onChange={setProfileEmail}
                required
                placeholder="you@example.gy"
              />
              <TextAreaField
                label="Residential address"
                value={profileAddress}
                onChange={setProfileAddress}
                required
                rows={2}
              />
            </Section>
          )}

          {/* ------------------------------------------------- STEP: BUSINESS */}
          {/* Grouped, one open at a time: a long page of text boxes is where a
              phone applicant gives up. Each group says how far it is answered. */}
          {step === 'business' && (
            <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
              <QuestionGroup
                n={1}
                title="Your business in brief"
                hint="What the business is and what the loan will help it achieve."
                answered={filled(BRIEF_KEYS)}
                total={BRIEF_KEYS.length}
                open={openGroup === 1}
                onToggle={() => toggleGroup(1)}
              >
                <TextAreaField
                  label="Executive summary"
                  required
                  max={1000}
                  value={text('executive_summary')}
                  onChange={set('executive_summary')}
                />
                <TextAreaField
                  label="Products and services"
                  required
                  max={1000}
                  value={text('products_services')}
                  onChange={set('products_services')}
                />
                <TextAreaField
                  label="Unique selling proposition"
                  required
                  max={1000}
                  value={text('unique_selling_point')}
                  onChange={set('unique_selling_point')}
                />
                {stage === 'New' && draft && (
                  <div className="rounded-lg bg-brand-light/40 p-3">
                    <ApplicationDocuments
                      application={draft.name}
                      rows={[{ type: 'Business Plan', title: 'Business plan document', hint: 'Optional' }]}
                      onChange={setMissing}
                    />
                  </div>
                )}
              </QuestionGroup>

              <QuestionGroup
                n={2}
                title="Market and customers"
                hint="Who the business serves and the market it operates in."
                answered={filled(MARKET_KEYS)}
                total={MARKET_KEYS.length}
                open={openGroup === 2}
                onToggle={() => toggleGroup(2)}
              >
                <TextAreaField
                  label="Customer segments"
                  max={1000}
                  value={text('customer_segments')}
                  onChange={set('customer_segments')}
                />
                <TextAreaField
                  label="Target market"
                  max={1000}
                  value={text('target_market')}
                  onChange={set('target_market')}
                />
                <TextAreaField
                  label="Competitors"
                  max={1000}
                  value={text('competitors')}
                  onChange={set('competitors')}
                />
              </QuestionGroup>

              <QuestionGroup
                n={3}
                title="Jobs"
                hint="Jobs the business will create in its first year."
                answered={filled(jobKeys)}
                total={jobKeys.length}
                open={openGroup === 3}
                onToggle={() => toggleGroup(3)}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Jobs to be created"
                    type="number"
                    inputMode="numeric"
                    value={text('jobs_created')}
                    onChange={set('jobs_created')}
                  />
                  {stage === 'Existing' && (
                    <TextField
                      label="Current staff"
                      type="number"
                      inputMode="numeric"
                      value={text('staff_count')}
                      onChange={set('staff_count')}
                    />
                  )}
                </div>
                <TextAreaField
                  label="Employment impact"
                  max={1000}
                  value={text('employment_impact')}
                  onChange={set('employment_impact')}
                />
              </QuestionGroup>

              <QuestionGroup
                n={4}
                title="Direction and goals"
                hint="Vision · Mission · Goals"
                answered={filled(DIRECTION_KEYS)}
                total={DIRECTION_KEYS.length}
                open={openGroup === 4}
                onToggle={() => toggleGroup(4)}
              >
                <TextAreaField label="Vision" max={1000} value={text('vision')} onChange={set('vision')} />
                <TextAreaField label="Mission" max={1000} value={text('mission')} onChange={set('mission')} />
                <TextAreaField label="Goals" max={1000} value={text('goals')} onChange={set('goals')} />
              </QuestionGroup>

              <QuestionGroup
                n={5}
                title="Registration and sector"
                hint={stage === 'Existing' ? 'Verified against the DCRA register.' : 'Trading name and sector.'}
                answered={identityAnswered}
                total={identityTotal}
                open={openGroup === 5}
                onToggle={() => toggleGroup(5)}
              >
                {stage === 'Existing' && (
                  <>
                    {looking && <p className="text-sm text-slate-500">Retrieving DCRA records…</p>}

                    {manualEntry && (
                      <div onBlur={() => void checkTypedDcra()}>
                        <TextField
                          label="DCRA registration number"
                          required
                          value={dcra}
                          onChange={onDcraChange}
                          placeholder="BN-2024-004512"
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
                        {/* Grey, not white: the register's values, never
                            fields the applicant may answer — each attributed to
                            whoever GDB heard it from. */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <ReadOnlyField
                            label="Registered business name"
                            value={dcraRecord.business_name}
                            source={dcraSourceLabel}
                          />
                          <ReadOnlyField
                            label="Registration number"
                            value={dcraRecord.registration_number}
                            source={dcraSourceLabel}
                          />
                          {dcraRecord.business_type && (
                            <ReadOnlyField
                              label="Structure on the register"
                              // DCRA's "Business Name" is a sole proprietorship
                              // in the applicant's words; the raw value shows
                              // where the portal has no word for it.
                              value={
                                STRUCTURE_LABEL[deriveStructure(dcraRecord)] ??
                                dcraRecord.business_type
                              }
                              source={dcraSourceLabel}
                            />
                          )}
                          {dcraRecord.registered_on && (
                            <ReadOnlyField
                              label="Registered on"
                              value={dcraRecord.registered_on}
                              source={dcraSourceLabel}
                            />
                          )}
                          {dcraRecord.region && (
                            <ReadOnlyField label="Region" value={dcraRecord.region} source={dcraSourceLabel} />
                          )}
                          {dcraRecord.proprietors?.length ? (
                            <ReadOnlyField
                              label="Proprietors"
                              value={dcraRecord.proprietors.join(', ')}
                              source={dcraSourceLabel}
                            />
                          ) : null}
                        </div>
                        {dcraRecord.status && dcraRecord.status !== 'Active' && (
                          <div className="mt-2">
                            <Notice tone="warn">
                              Registration inactive. Reinstatement may be required before
                              disbursement.
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
                        placeholder="As on the certificate"
                      />
                    )}
                    {dcraNote && <Notice tone="warn">{dcraNote}</Notice>}
                  </>
                )}

                {stage === 'New' && (
                  <>
                    <TextField label="Proposed trading name" required value={businessName} onChange={setBusinessName} />
                    <Notice tone="info">DCRA registration is required before disbursement.</Notice>
                  </>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Sector"
                    required
                    value={text('sector')}
                    onChange={set('sector')}
                    options={SECTORS}
                    placeholder="Select sector…"
                  />
                  <TextField
                    label="Sub-sector"
                    value={text('sub_sector')}
                    onChange={set('sub_sector')}
                    placeholder="e.g. Poultry"
                  />
                </div>
              </QuestionGroup>
            </div>
          )}

          {/* ----------------------------------------------- STEP: OPERATIONS */}
          {step === 'operations' && (
            <Section letter="E" title="Operating information">
              <SelectField
                label="Operating region"
                value={val('operating_location')}
                onChange={set('operating_location')}
                options={REGIONS}
              />
              <TextAreaField
                label="Production process"
                value={val('production_process')}
                onChange={set('production_process')}
              />
              <TextAreaField
                label="Equipment and fixed assets"
                value={val('equipment_required')}
                onChange={set('equipment_required')}
              />
              <TextAreaField
                label="Key suppliers"
                value={val('suppliers')}
                onChange={set('suppliers')}
              />
              <TextAreaField
                label="Licences and permits"
                value={val('permits_required')}
                onChange={set('permits_required')}
              />
            </Section>
          )}

          {/* ------------------------------------------------- STEP: FINANCES */}
          {step === 'finances' && stage === 'Existing' && (
            <Section
              letter="G"
              title="Financial position"
              blurb="Last financial year. Financial statements take precedence over declared figures."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField
                  label="Annual revenue"
                  value={val('annual_revenue')}
                  onChange={set('annual_revenue')}
                />
                <MoneyField
                  label="Cost of sales"
                  value={val('cost_of_sales')}
                  onChange={set('cost_of_sales')}
                />
                <MoneyField
                  label="Operating expenses"
                  value={val('operating_expenses')}
                  onChange={set('operating_expenses')}
                />
                <MoneyField
                  label="Annual debt service"
                  value={val('existing_obligations')}
                  onChange={set('existing_obligations')}
                />
                <MoneyField
                  label="Cash and bank balances"
                  value={val('cash_position')}
                  onChange={set('cash_position')}
                />
              </div>
            </Section>
          )}

          {step === 'finances' && stage === 'New' && (
            <Section
              letter="H"
              title="Financial projections"
              blurb="First year of trading."
            >
              <TextAreaField
                label="Projected sales volume"
                value={val('expected_sales_volume')}
                onChange={set('expected_sales_volume')}
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
                  label="Start-up costs"
                  tag="Forecast"
                  value={val('initial_costs')}
                  onChange={set('initial_costs')}
                />
                <MoneyField
                  label="Projected monthly cash flow"
                  tag="Forecast"
                  value={val('expected_cash_position')}
                  onChange={set('expected_cash_position')}
                />
              </div>
              <TextAreaField
                label="Key assumptions"
                value={val('assumptions')}
                onChange={set('assumptions')}
                placeholder="Prices, volumes, demand, supply"
              />
            </Section>
          )}

          {step === 'finances' && !stage && (
            <Notice tone="warn">
              Select the application type first.
            </Notice>
          )}

          {/* -------------------------------------------------- STEP: FUNDING */}
          {step === 'funding' && (
            <>
              <Section letter="I" title="Facility request" blurb="Interest-free. Principal repayment only.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField
                    label="Loan amount"
                    required
                    value={amount}
                    onChange={setAmount}
                  />
                  <TextField
                    label="Tenor (months)"
                    required
                    type="number"
                    inputMode="numeric"
                    value={term}
                    onChange={setTerm}
                  />
                </div>
                <TextAreaField
                  label="Purpose of loan"
                  required
                  value={purpose}
                  onChange={setPurpose}
                  placeholder="e.g. Working capital"
                />

                <div>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    Use of proceeds
                  </span>
                  <DataTable
                    caption="Use of proceeds"
                    columns={[
                      {
                        key: 'item',
                        header: 'Item',
                        cell: (row, i) => (
                          <input
                            value={row.item}
                            onChange={(e) =>
                              setUseOfFunds((rows) =>
                                rows.map((r, j) => (j === i ? { ...r, item: e.target.value } : r)),
                              )
                            }
                            aria-label={`Use of funds line ${i + 1}, item`}
                            placeholder="e.g. Chest freezer"
                            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm focus:border-brand focus:bg-white focus:outline-none"
                          />
                        ),
                      },
                      {
                        key: 'amount',
                        header: 'Amount',
                        align: 'right',
                        cell: (row, i) => (
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
                            aria-label={`Use of funds line ${i + 1}, amount in Guyanese dollars`}
                            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-right text-sm tabular-nums focus:border-brand focus:bg-white focus:outline-none"
                          />
                        ),
                      },
                      {
                        key: 'remove',
                        header: '',
                        align: 'right',
                        stackLabel: '',
                        className: 'w-8',
                        cell: (_, i) =>
                          useOfFunds.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => setUseOfFunds((rows) => rows.filter((_, j) => j !== i))}
                              className="text-slate-300 hover:text-rose-500"
                              aria-label={`Remove use of funds line ${i + 1}`}
                            >
                              ×
                            </button>
                          ) : null,
                      },
                    ]}
                    rows={useOfFunds}
                    rowKey={(_, i) => String(i)}
                    dense
                    footnote={false}
                    total={{
                      // A running sum as the applicant types. The figure GDB
                      // records is Frappe's own SUM of the saved lines.
                      item: 'Total',
                      amount: formatGyd(useOfFunds.reduce((sum, r) => sum + (r.amount || 0), 0)),
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setUseOfFunds((rows) => [...rows, { item: '', amount: 0 }])}
                    className="mt-2 text-xs font-semibold text-brand underline"
                  >
                    Add line
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField
                    label="Personal monthly income"
                    value={income}
                    onChange={setIncome}
                    tag="Optional"
                  />
                </div>
              </Section>

              <Section
                letter="J"
                title="Disbursement account"
                blurb="Must be held in your name."
              >
                {accountsLoading && (
                  <p className="text-sm text-slate-500">Retrieving your accounts…</p>
                )}

                {!manualAccount && (myAccounts?.length ?? 0) > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">
                      {myAccounts?.length === 1
                        ? 'Account held in your name.'
                        : 'Select the disbursement account.'}
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
                              : `${a.status} — cannot receive funds.`
                          }
                          disabled={!payable}
                          selected={accountNo === a.account_number}
                          onSelect={() => selectAccount(a)}
                        />
                      );
                    })}
                    <p className="text-xs text-slate-500">
                      {myAccounts?.[0]?.source === 'bank_registry'
                        ? 'From your bank. Re-verified before disbursement.'
                        : 'Re-verified with your bank before disbursement.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualAccount(true);
                        setAccountNote(null);
                      }}
                      className="text-xs font-semibold text-brand underline"
                    >
                      Use another account
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
                      placeholder="Select bank…"
                    />
                    <div onBlur={() => void checkTypedAccount()}>
                      <TextField
                        label="Account number"
                        required
                        inputMode="numeric"
                        value={accountNo}
                        onChange={(v) => {
                          // Digits only, as the server requires — a stray
                          // full stop or space never reaches the save.
                          setAccountNo(v.replace(/\D/g, ''));
                          setAccountCheck(null);
                        }}
                        placeholder="Digits only"
                      />
                    </div>
                    <TextField
                      label="Branch code"
                      value={branchCode}
                      onChange={setBranchCode}
                      placeholder="DEM-GT-04"
                    />

                    {checking && <p className="text-xs text-slate-500">Verifying with the bank…</p>}

                    {/* Three outcomes, never two. "We could not check" is said
                        out loud rather than shown as a pass — and none of them
                        stops the application. */}
                    {accountCheck && !checking && (
                      <Notice tone={accountCheck.result === 'Verified' ? 'good' : 'warn'}>
                        {accountCheck.result === 'Verified' &&
                          `Verified — ${accountCheck.account_name}.`}
                        {accountCheck.result === 'Name Mismatch' &&
                          'Account name does not match. GDB verifies before disbursement.'}
                        {accountCheck.result === 'Inactive Account' &&
                          `Account ${accountCheck.status?.toLowerCase()}. Nominate another account.`}
                        {accountCheck.result === 'Not Found' &&
                          'Account not found. Check the number.'}
                        {accountCheck.result === 'Unavailable' &&
                          'Bank unavailable. GDB verifies before disbursement.'}
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
                        Use a registered account
                      </button>
                    )}
                  </>
                )}
              </Section>
            </>
          )}

          {/* --------------------------------------------------- STEP: REVIEW */}
          {step === 'evidence' && (
            <div className="space-y-5">
              <header>
                <h2 className="text-xl font-bold text-slate-900">Review your application</h2>
                <p className="mt-0.5 text-xs text-slate-400">{statusLine}</p>
                <p className="mt-1 text-sm text-slate-500">Review does not submit your application.</p>
              </header>

              <AttentionList issues={issues} blocking={fieldIssues.length > 0} />
              <ReviewSections sections={reviewSections} onEdit={(id) => goTo(id as StepId)} />

              {draft && (
                <div className="rounded-lg bg-brand-light/40 p-4">
                  <p className="mb-3 text-sm font-semibold text-slate-800">
                    Anything else to add? <span className="font-normal text-slate-500">(optional)</span>
                  </p>
                  <ApplicationDocuments application={draft.name} rows={[OTHER_DOC]} onChange={setMissing} />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back to {steps[index - 1]?.title.toLowerCase()}
                </button>
                <div className="flex flex-wrap gap-2">
                  {assist && (
                    <button
                      type="button"
                      disabled={busy || fieldIssues.length > 0}
                      onClick={() => void finishAssisted(false)}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Send to applicant
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || fieldIssues.length > 0}
                    onClick={() => void (assist ? finishAssisted(true) : onFinalSubmit())}
                    className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
                  >
                    {busy ? 'Submitting…' : assist ? 'Submit for applicant' : 'Submit application'}
                  </button>
                </div>
              </div>
              <p className="text-right text-xs text-slate-400">
                {assist
                  ? 'The applicant is told it was submitted for them.'
                  : 'By submitting you confirm the information is true and complete.'}
              </p>
            </div>
          )}
        </Card>

        {/* Sticky actions: one blocker, one primary next action. */}
        {!isLast && tab === 'application' && (
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <button
              type="button"
              onClick={goBack}
              disabled={index === 0}
              className="rounded-md px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void goNext()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save and continue'}
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
