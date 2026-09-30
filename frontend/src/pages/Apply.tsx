import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import { DocumentShelf } from '../components/DocumentShelf';
import { DataTable } from '../components/ui/DataTable';
import { Card } from '../components/ui/Card';
import { ArrowRightIcon, CheckIcon } from '../components/ui/icons';
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
import {
  ClusterIdentity,
  GroupDetails,
  matchRegion,
  MembersTable,
  PLAN_SECTIONS,
  REGIONS,
  SharedPlan,
} from '../components/apply/cluster';
import { OwnershipBlock } from '../components/apply/ownership';
import { EMPTY_EID, isCompleteEid } from '../eid';
import type {
  BankAccountRecord,
  CitizenProfile,
  Cluster,
  ClusterPlan,
  ClusterPlanSection,
  DcraRecord,
  LoanApplication,
  OwnershipRow,
  UseOfFundsRow,
} from '../types';
import { encodeUseOfFunds, formatDate, formatGyd, parseUseOfFunds } from '../utils';

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
type Structure = '' | 'Sole Trader' | 'Partnership' | 'Cluster-supported' | 'Incorporated (Inc.)';

/** What DCRA's own `business_type` means in the words this form uses. The
 *  register tells three kinds of ownership apart and the portal asks the same
 *  three, so a business that already has a registration is never asked to
 *  repeat what the register already says — the applicant cannot answer it
 *  better than DCRA can, and two answers to one question is how a company
 *  reaches the Bank filed as a sole trader.
 *
 *  'Cluster-supported' is deliberately ABSENT. DCRA does not record one,
 *  because borrowing as a group is a decision about this loan, not a fact
 *  about the business — so it stays a question, asked separately. */
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
  | 'group'
  | 'members'
  | 'plan'
  | 'business'
  | 'operations'
  | 'finances'
  | 'funding'
  | 'evidence';

/** The steps only a cluster application asks. They are filtered out entirely
 *  for an applicant applying alone, rather than shown and skipped: a step that
 *  appears in the rail and cannot be reached is a step somebody will phone
 *  GDB about. */
const CLUSTER_STEPS: StepId[] = ['group', 'members', 'plan'];

const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: 'consent', title: 'Consent', blurb: 'Let GDB fetch the records this application needs' },
  { id: 'route', title: 'How you are applying', blurb: 'Who the loan is for, and what kind of business it is' },
  { id: 'about', title: 'About you', blurb: 'Your details, confirmed against your e-ID' },
  { id: 'group', title: 'About your group', blurb: 'What the group does, and where it works' },
  { id: 'members', title: 'Group members', blurb: 'Who is in the group' },
  { id: 'plan', title: 'The shared plan', blurb: 'What the group is building together' },
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
  applyAsCluster: boolean | null;
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
  clusterName?: string;
  wantsFacilitator?: boolean | null;
  facilitatorEid?: string;
  profileDob?: string;
  profilePhone?: string;
  profileEmail?: string;
  profileAddress?: string;
}

// An e-ID directory does not always carry a birth date, and a bank still
// needs a value to hold rather than a blank the applicant could skip past.
// Flagged as a placeholder in the field's own hint text.
const DEFAULT_DOB = '1990-01-01';

export function Apply() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Present on `/apply/:name` and absent on `/apply/new`. That single
  // difference is what tells resuming a specific draft apart from starting a
  // fresh application — the two used to share one route and one blob of
  // browser storage, which is why "start an application" continued the last
  // abandoned one.
  const { name: routeName } = useParams<{ name: string }>();

  const [step, setStep] = useState<StepId>('consent');
  // null = not checked yet. Fetched once from the citizen's own profile, so a
  // returning applicant who already agreed is never asked again.
  const [consentAccepted, setConsentAccepted] = useState<boolean | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [stage, setStage] = useState<'' | 'Existing' | 'New'>('');
  const [structure, setStructure] = useState<Structure>('');
  // null = not answered yet. Asked of an existing business INSTEAD of the
  // ownership cards, and held apart from `structure` on purpose: once the
  // register supplies the ownership, `structure` is never empty, so it can no
  // longer tell an unanswered cluster question from a "No" nobody gave.
  const [applyAsCluster, setApplyAsCluster] = useState<boolean | null>(null);
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

  // The cluster this application is being filed for, once it exists, and the
  // groups this citizen already heads. A person may lead several — each group
  // applies separately, and naming one here is what makes this the group's
  // application rather than their own.
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [myClusters, setMyClusters] = useState<Cluster[]>([]);
  const [chosenCluster, setChosenCluster] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [wantsFacilitator, setWantsFacilitator] = useState<boolean | null>(null);
  const [facilitatorEid, setFacilitatorEid] = useState(EMPTY_EID);
  const [groupPurpose, setGroupPurpose] = useState('');
  const [groupRegion, setGroupRegion] = useState('');
  const [groupLocality, setGroupLocality] = useState('');
  const [groupRegistered, setGroupRegistered] = useState('');
  const [plan, setPlan] = useState<ClusterPlan>({
    plan_executive_summary: '',
    plan_how_formed: '',
    plan_governance: '',
    plan_market: '',
    plan_shared_project: '',
    plan_operations: '',
    plan_impact: '',
  });
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
  const storageKey = `gdb.apply.${user?.user ?? 'anon'}`;

  // Ownership shares are a question only where ownership is divided. A sole
  // trader owns all of it; a cluster is a group of separate borrowers, not a
  // jointly-owned company.
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
  // Rows that actually name somebody. A blank line in a form is not a co-owner.
  const namedOwners = owners.filter((o) => isCompleteEid(o.eid) || o.name.trim());
  const sharesDeclared =
    Number(applicantShare || 0) + namedOwners.reduce((sum, o) => sum + Number(o.share || 0), 0);

  // Who GDB actually heard this from. A confirmed registry hit and a name
  // recalled from the applicant's own earlier filing are not the same evidence
  // and must not carry the same label — the adapter's `source` is the only
  // thing that can tell them apart, so it is what the badge reads.
  const dcraSourceLabel =
    dcraRecord?.source === 'dcra'
      ? 'Confirmed by DCRA'
      : dcraRecord?.source === 'gdb_history'
        ? 'From your earlier application'
        : 'Not confirmed';

  // Only the steps this route actually asks. A sole trader never sees the
  // group screens at all.
  const steps = useMemo(
    () => STEPS.filter((s) => forCluster || !CLUSTER_STEPS.includes(s.id)),
    [forCluster],
  );

  // A group's application is a DIFFERENT application, never the personal draft
  // carried over. Switching route — or switching which group — drops the
  // server draft so the next save opens a new one, and the case an underwriter
  // reads is the one that was actually filled in for that group.
  const lastTarget = useRef<string | null>(null);
  useEffect(() => {
    const target = forCluster ? `cluster:${chosenCluster || clusterName}` : 'own';
    if (lastTarget.current !== null && lastTarget.current !== target) {
      setDraft(null);
      setMissing([]);
    }
    lastTarget.current = target;
  }, [forCluster, chosenCluster, clusterName]);

  // A step that has just been filtered away must not be the one on screen.
  useEffect(() => {
    if (!steps.some((s) => s.id === step)) setStep('route');
  }, [steps, step]);
  const validCoApplicants = coApplicants.filter(isCompleteEid);

  const set = (key: string) => (v: string) => setSections((s) => ({ ...s, [key]: v }));
  const val = (key: string) => sections[key] ?? '';

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
        navigate(`/loans/${name}`, { replace: true });
        return;
      }
      setDraft(loan);
      setStage((loan.business_stage as '' | 'Existing' | 'New') ?? '');
      const filedAs = ((loan.sections?.legal_structure as Structure) ?? '') as Structure;
      setStructure(filedAs);
      // A draft that was already filed has answered the cluster question by
      // filing — re-asking it on resume would block a returning applicant on a
      // decision they have made. A draft holding no structure at all never got
      // that far, so it is still unanswered.
      setApplyAsCluster(filedAs ? filedAs === 'Cluster-supported' : null);
      setAmount(loan.loan_amount ? String(loan.loan_amount) : '');
      setTerm(loan.term_months ? String(loan.term_months) : '12');
      setIncome(loan.monthly_income ? String(loan.monthly_income) : '');
      setPhone(loan.phone ?? '');
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
      if (loan.cluster) setChosenCluster(loan.cluster);
      // A resumed draft is past the consent question by definition — it could
      // not have been saved otherwise — so open it on the first step that
      // actually asks something.
      setStep('route');
      setRestored(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'That application could not be opened.',
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // `/apply/:name` resumes that draft from GDB. `/apply/new` starts empty and
    // deliberately ignores — and clears — whatever this browser was holding:
    // "start an application" has to mean a new one.
    if (routeName) {
      // Already ours — this is the URL catching up with a draft we just saved,
      // not a request to open a different one.
      if (loaded.current === routeName) return;
      void resumeFromServer(routeName);
      return;
    }
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* a browser that refuses storage is not a reason to block an application */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeName, storageKey]);

  // Crash recovery for the window BEFORE a server draft exists — the funding
  // step is the earliest point the server will accept one, and a connection
  // that drops before then should not cost the applicant everything they
  // typed. Superseded by the server draft the moment there is one, which is
  // why the write below stops and clears once `draft` is set.
  useEffect(() => {
    if (routeName || draft) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Saved;
      setStage(s.stage ?? '');
      setStructure(s.structure ?? '');
      setApplyAsCluster(s.applyAsCluster ?? null);
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
      setClusterName(s.clusterName ?? '');
      setWantsFacilitator(s.wantsFacilitator ?? null);
      setFacilitatorEid(s.facilitatorEid ?? EMPTY_EID);
      setProfileDob(s.profileDob ?? '');
      setProfilePhone(s.profilePhone ?? '');
      setProfileEmail(s.profileEmail ?? '');
      setProfileAddress(s.profileAddress ?? '');
      if (s.step && s.step !== 'consent' && STEPS.some((st) => st.id === s.step)) setStep(s.step);
      setRestored(true);
    } catch {
      /* a browser that refuses storage is not a reason to block an application */
    }
    // Deliberately keyed on the storage key alone: this is a once-on-mount
    // recovery, and re-running it as `draft` changes would overwrite what the
    // applicant is typing with what the browser last wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    // Once GDB holds the draft, GDB is where it lives. Keeping a second copy
    // on the device would be duplicated server state, and — because these
    // fields are somebody's address, phone and income — it would leave that
    // PII in localStorage for whoever opens the browser next. Cleared here
    // rather than merely stopped, so an earlier copy does not survive.
    if (draft || routeName) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* private window, quota, blocked storage — never fatal */
      }
      return;
    }
    const payload: Saved = {
      stage,
      structure,
      applyAsCluster,
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
      clusterName,
      wantsFacilitator,
      facilitatorEid,
      profileDob,
      profilePhone,
      profileEmail,
      profileAddress,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* private window, quota, blocked storage — never fatal */
    }
  }, [
    stage,
    structure,
    applyAsCluster,
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
    routeName,
    storageKey,
    clusterName,
    wantsFacilitator,
    facilitatorEid,
    profileDob,
    profilePhone,
    profileEmail,
    profileAddress,
  ]);

  // --- reference data -----------------------------------------------------
  useEffect(() => {
    call<Cluster[]>('gdb_bank.api.my_clusters')
      .then((all) => {
        const mine = (all ?? []).filter((c) => c.is_head);
        setMyClusters(mine);
        // Only pre-select when there is exactly one and no ambiguity about
        // which group is meant. Two groups is a question for the applicant.
        if (mine.length === 1) {
          setCluster(mine[0]);
          if (mine[0].loan_purpose) setPurpose((p) => p || mine[0].loan_purpose || '');
        }
      })
      .catch(() => setMyClusters([]));
    call<string[]>('gdb_bank.api.bank_options').then(setBanks).catch(() => setBanks([]));
    void loadMyAccounts();
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((p) => {
        setConsentAccepted(Boolean(p?.consent_version));
        setProfile(p);
        // Prefer what the applicant already declared over the directory's
        // assertion, and never overwrite a value a restored draft already
        // holds — a functional update is what makes both true at once.
        setProfileDob((cur) => cur || p.date_of_birth || p.verified_birth_date || DEFAULT_DOB);
        setProfilePhone((cur) => cur || p.phone || p.verified_phone || '');
        setProfileEmail((cur) => cur || p.email || p.verified_email || '');
        setProfileAddress((cur) => cur || p.address || p.verified_address || '');
        // The funding step asks for a contact number of its own — default it
        // from the same source so the applicant is not asked twice, without
        // touching anything they may already have typed there.
        setPhone((cur) => cur || p.phone || p.verified_phone || '');
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
        // A cluster answer belongs to the applicant, not to the register.
        // Changing which business the loan is for must not silently un-choose
        // it — that decision was about how they want to borrow.
        if (current === 'Cluster-supported') return current;
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

  /** The cluster question, asked of an existing business in place of the
   *  ownership cards it no longer needs. Answering it is what sets
   *  `structure`: "yes" files the application against the group, "no" returns
   *  it to whatever the register said this business is. */
  const chooseCluster = (wants: boolean) => {
    setApplyAsCluster(wants);
    setStructure(wants ? 'Cluster-supported' : registryStructure);
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
            ? "This registration doesn't list your e-ID as a proprietor. GDB will confirm your connection to it before this goes further."
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
    });
    setDraft(saved);
    // Claim it before the URL changes, so the resume effect below knows this
    // draft is already on screen and leaves the wizard where it is.
    loaded.current = saved.name;
    // The draft now exists at GDB, so the URL becomes the one that resumes it.
    // Without this a reload would land back on `/apply/new` and open an empty
    // form beside a draft that already exists.
    if (!routeName && saved.name) navigate(`/apply/${saved.name}`, { replace: true });
    return saved;
  };

  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === step),
  );
  const current = steps[index];
  const isLast = index === steps.length - 1;

  // The rail hides its own scrollbar (deliberately — see .scrollbar-none),
  // which removes the one hint that there was more to scroll to. Without
  // this, advancing past whatever fits the viewport leaves the active step
  // sitting off-screen with nothing on screen moving to show it.
  const activeStepRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [index]);

  /** What this step still needs before it can be left. Returns null when the
   *  step is complete. Presentation only — the server re-checks everything. */
  const blocker = useMemo((): string | null => {
    if (step === 'consent') {
      if (!consentAccepted && !consentChecked) return 'Agree to let GDB fetch these records to continue.';
    }
    if (step === 'route') {
      if (!stage) return 'Tell us whether this is an existing business or a new venture.';
      if (stage === 'Existing' && (myBusinesses?.length ?? 0) > 0 && !dcra.trim()) {
        return 'Tell us which business this application is for.';
      }
      // Where the register answered the ownership, `structure` is already set
      // and can no longer hold this screen open — so the cluster question
      // blocks on its own. Without it, "No" would be applied to somebody who
      // never read the question.
      if (registryPending && looking) return 'Checking the register…';
      if (registryAnswers && applyAsCluster === null) {
        return 'Tell us whether you want to apply as a cluster.';
      }
      if (!structure) return 'Tell us how you are applying.';
      // These three hold the screen open on the ownership block. They are
      // asked ONLY while that block is on it — a rule about a question the
      // applicant cannot see is a dead end, not a check.
      if (askOwnership && structure === 'Partnership' && namedOwners.length === 0) {
        return 'Name at least one partner, or apply as a sole proprietorship.';
      }
      if (askOwnership && !applicantShare) {
        return structure === 'Partnership'
          ? 'Tell us what share of the partnership is yours.'
          : 'Tell us what share of the company is yours.';
      }
      // Over 100% cannot be true of anything, and the server refuses it too.
      // Under 100% is deliberately allowed — see OwnershipBlock.
      if (askOwnership && sharesDeclared > 100) {
        return `The declared shares add up to ${sharesDeclared}%. They cannot exceed 100%.`;
      }
      if (forCluster) {
        if (!chosenCluster && !clusterName.trim()) return 'Give your group a name.';
        if (wantsFacilitator === null) return 'Tell us whether you would like a regional facilitator.';
        // Nothing to validate on the facilitator itself: it is chosen from a
        // list the server supplied, and choosing nobody is a valid answer —
        // GDB attaches one for the group's region instead.
      }
    }
    if (step === 'about') {
      if (!profileDob) return 'Give a date of birth.';
      if (!profileEmail.trim()) return 'Give an email address.';
      if (!profileAddress.trim()) return 'Give a residential address.';
    }
    if (step === 'group') {
      if (!groupPurpose.trim()) return 'Tell us what the group does.';
      if (!groupRegion) return 'Tell us which region the group works in.';
      if (!groupRegistered) return 'Tell us whether the group is registered.';
    }
    if (step === 'members') {
      // One member besides the head. A "group" of one is an individual
      // application, and filing it as a group's would put a facility in a
      // name nobody else agreed to.
      const others = (cluster?.members ?? []).filter((m) => !m.is_head);
      if (others.length === 0) return 'Add at least one other member to the group.';
    }
    if (step === 'plan') {
      if (!(plan.plan_executive_summary ?? '').trim()) {
        return 'Write the executive summary — it is what an underwriter reads first.';
      }
      if (!(plan.plan_shared_project ?? '').trim()) {
        return 'Describe the shared project the group is building.';
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
    registryAnswers,
    registryPending,
    looking,
    applyAsCluster,
    // The ownership block's state, all of it. Missing from here, the memo kept
    // answering "name at least one partner" after a partner had been named —
    // the rule was right and simply never re-ran.
    namedOwners.length,
    applicantShare,
    sharesApply,
    askOwnership,
    sharesDeclared,
    forCluster,
    chosenCluster,
    clusterName,
    wantsFacilitator,
    facilitatorEid,
    profileDob,
    profileEmail,
    profileAddress,
    groupPurpose,
    groupRegion,
    groupRegistered,
    cluster,
    plan,
    businessName,
    dcra,
    myBusinesses,
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

    // Leaving the route step on the cluster path is what BRINGS THE GROUP INTO
    // BEING: the head has named it and said whether they want a facilitator,
    // which is everything a group needs to exist. The rest — what it does,
    // who is in it, what it plans — is asked of a group that already has a
    // name, because members are invited to something.
    if (step === 'route' && forCluster) {
      setBusy(true);
      try {
        const group = chosenCluster
          ? await call<Cluster>('gdb_bank.api.cluster_view', { cluster: chosenCluster })
          : cluster?.name === clusterName.trim()
            ? cluster
            : await call<Cluster>('gdb_bank.api.create_cluster', {
                cluster_name: clusterName.trim(),
                facilitator_eid: wantsFacilitator && isCompleteEid(facilitatorEid) ? facilitatorEid : '',
                facilitator_requested: wantsFacilitator ? 1 : 0,
              });
        setCluster(group);
        // A group picked from the list arrives with its own answers already
        // in it; the screens ahead edit those rather than start blank.
        setGroupPurpose((v) => v || group.group_purpose || '');
        setGroupRegion((v) => v || group.region || '');
        setGroupLocality((v) => v || group.locality || '');
        setGroupRegistered((v) => v || group.is_registered || '');
        setPlan((p) => ({ ...p, ...Object.fromEntries(
          PLAN_SECTIONS.map((sec) => [sec.key, p[sec.key] || group.plan?.[sec.key] || '']),
        ) } as ClusterPlan));
        if (group.facilitator_eid && !isCompleteEid(facilitatorEid)) {
          setFacilitatorEid(group.facilitator_eid);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create your group');
        setBusy(false);
        return;
      }
      setBusy(false);
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
        return;
      }
      setBusy(false);
    }

    if (step === 'group' && cluster) {
      setBusy(true);
      try {
        setCluster(
          await call<Cluster>('gdb_bank.api.save_cluster_details', {
            cluster: cluster.name,
            group_purpose: groupPurpose,
            region: groupRegion,
            locality: groupLocality,
            is_registered: groupRegistered,
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save your group's details");
        setBusy(false);
        return;
      }
      setBusy(false);
    }

    if (step === 'plan' && cluster) {
      setBusy(true);
      try {
        setCluster(
          await call<Cluster>('gdb_bank.api.save_cluster_plan', { cluster: cluster.name, ...plan }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the shared plan');
        setBusy(false);
        return;
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
        return;
      }
      setBusy(false);
    }
    setStep(steps[Math.min(index + 1, steps.length - 1)].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    setError(null);
    setStep(steps[Math.max(index - 1, 0)].id);
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
      <nav className="mb-6 overflow-x-auto scrollbar-none">
        <ol className="flex min-w-max items-center">
          {steps.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.id} className="flex items-center">
                <button
                  ref={active ? activeStepRef : undefined}
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
            Step {index + 1} of {steps.length}
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

        {/* `pb-20` clears the sticky action bar below. Without it the bar
            rests ON the card's last control once the page is scrolled to the
            end — and the last control on this step is now a REQUIRED question,
            so a translucent bar sitting over it is not a cosmetic problem: the
            answer cannot be given, and the click lands on Continue instead. */}
        <Card className="space-y-6 pb-20">
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

              {/* An existing business is asked which DCRA registration this
                  application is for, right here — not deferred to the
                  business-identity step — so Continue is all that is left to
                  do once a business is picked. */}
              {stage === 'Existing' && (
                <Section
                  letter="2"
                  title="Which business is this for?"
                  blurb="The businesses DCRA has registered against your e-ID."
                >
                  {looking && (
                    <p className="text-sm text-slate-500">Finding your businesses at DCRA…</p>
                  )}
                  {!looking && (myBusinesses?.length ?? 0) > 0 && (
                    <SelectField
                      label="Business"
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
                      required
                    />
                  )}
                  {!looking && !(myBusinesses?.length ?? 0) && (
                    <Notice tone="info">
                      DCRA has no business registered to your e-ID yet. You can enter its
                      registration number yourself on the next step.
                    </Notice>
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
                  title="Type of business"
                  blurb={
                    registryAnswers
                      ? 'Taken from the register — you are not asked to repeat it.'
                      : stage === 'Existing'
                        ? 'How the business you picked above is owned.'
                        : 'How the business you intend to trade as will be owned.'
                  }
                >
                  {registryPending ? (
                    <p className="text-sm text-slate-500">
                      {looking
                        ? 'Checking what the register says about this business…'
                        : 'Pick the business above and the register will answer this.'}
                    </p>
                  ) : registryAnswers ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                      <p className="text-sm leading-relaxed text-slate-700">
                        DCRA has{' '}
                        <span className="font-bold text-slate-900">
                          {dcraRecord?.business_name ?? dcra}
                        </span>{' '}
                        registered as a{' '}
                        <span className="font-bold text-slate-900">
                          {dcraRecord?.business_type}
                        </span>
                        , so this application is filed as {STRUCTURE_PROSE[registryStructure]}.
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-slate-500">
                        If that is wrong, it is the registration that needs correcting at DCRA —
                        GDB lends against the register, not against what the form was told.
                      </p>
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
                      <ChoiceCard
                        title="Cluster"
                        selected={structure === 'Cluster-supported'}
                        onSelect={() => setStructure('Cluster-supported')}
                      />
                    </div>
                  )}

                  {/* The one thing DCRA has no answer for. A registered
                      business may still borrow as part of a group, so this is
                      asked of every existing business whose ownership came off
                      the register — and answering it is what sets the
                      structure either way. */}
                  {registryAnswers && (
                    <div className="mt-5">
                      <p className="text-sm font-bold text-slate-800">
                        Do you want to apply as a cluster?
                        <span className="ml-1 text-rose-600">*</span>
                      </p>
                      <p className="mt-1 mb-3 text-xs leading-relaxed text-slate-500">
                        A cluster borrows as a group: the head applies for everyone, each member
                        keeps their own record, and every one of them signs before GDB releases a
                        dollar. This is about how you want to borrow, not about the business — so
                        the register cannot answer it for you.
                      </p>
                      <div className="flex gap-2">
                        {[
                          { label: 'Yes, as a cluster', value: true },
                          { label: 'No, on my own', value: false },
                        ].map((opt) => (
                          <button
                            key={String(opt.value)}
                            type="button"
                            onClick={() => chooseCluster(opt.value)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                              applyAsCluster === opt.value
                                ? 'bg-brand text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
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

                  {/* The group is named here and nowhere else. Asking for it
                      on a separate page and sending the applicant back would
                      lose them the wizard they are halfway through. */}
                  {forCluster && (
                    <div className="rounded-lg bg-slate-50/80 p-4">
                      <ClusterIdentity
                        clusterName={clusterName}
                        onName={setClusterName}
                        wantsFacilitator={wantsFacilitator}
                        onWantsFacilitator={setWantsFacilitator}
                        facilitatorEid={facilitatorEid}
                        onFacilitatorEid={setFacilitatorEid}
                        existing={myClusters}
                        chosen={chosenCluster}
                        onChoose={setChosenCluster}
                        locked={Boolean(cluster && cluster.name === clusterName.trim())}
                      />
                    </div>
                  )}

                  {forCluster && (
                    <Notice tone="info">
                      This is the group&rsquo;s application, not yours. Every active member can see
                      it, and every one of them signs the Letter of Offer before GDB releases a
                      dollar.
                    </Notice>
                  )}
                </Section>
              )}
            </>
          )}

          {/* ---------------------------------------------------- STEP: ABOUT */}
          {step === 'about' && (
            <Section
              letter="A"
              title="About you"
              blurb="Confirmed against your e-ID. What it holds cannot be edited here."
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
                  label="Name"
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
                    ? 'Your e-ID did not carry a date of birth — check this before continuing.'
                    : undefined
                }
              />
              <TextField
                label="Phone"
                type="tel"
                inputMode="tel"
                value={profilePhone}
                onChange={setProfilePhone}
                placeholder="600 1234"
                hint="Guyana number. The +592 is added for you."
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
                hint="Where you live, not the business."
              />
            </Section>
          )}

          {/* ---------------------------------------------------- STEP: GROUP */}
          {step === 'group' && (
            <Section
              letter="C1"
              title="About your group"
              blurb="What the group does, and where it works. The region decides which GDB regional facilitator can be attached to help you."
            >
              <GroupDetails
                purpose={groupPurpose}
                onPurpose={setGroupPurpose}
                region={groupRegion}
                onRegion={setGroupRegion}
                locality={groupLocality}
                onLocality={setGroupLocality}
                registered={groupRegistered}
                onRegistered={setGroupRegistered}
              />
              {cluster?.facilitator_name && (
                <Notice tone="good">
                  <strong>{cluster.facilitator_name}</strong> is attached to this group as its
                  facilitator. They can help you write the shared plan, and they see nothing else.
                </Notice>
              )}
              {cluster?.facilitator_requested && !cluster.facilitator && (
                <Notice tone="info">
                  GDB has your request for a facilitator. One will be attached for{' '}
                  {groupRegion || 'your region'}.
                </Notice>
              )}
            </Section>
          )}

          {/* -------------------------------------------------- STEP: MEMBERS */}
          {step === 'members' && (
            <Section
              letter="C2"
              title="Group members"
              blurb="Add each member by their national e-ID. Everyone you add is invited — they join by accepting, signed in as themselves."
            >
              <MembersTable cluster={cluster} onChanged={setCluster} />
              <Notice tone="info">
                An e-ID that has never signed in to GDB is still a valid member. The invitation
                waits for them, and attaches itself the first time they sign in.
              </Notice>
            </Section>
          )}

          {/* ----------------------------------------------------- STEP: PLAN */}
          {step === 'plan' && (
            <Section
              letter="C3"
              title="The shared plan"
              blurb="The group's case, in its own words. This is what an underwriter reads before anything else."
            >
              <SharedPlan
                plan={plan}
                onChange={(key: ClusterPlanSection, value: string) =>
                  setPlan((p) => ({ ...p, [key]: value }))
                }
              />
            </Section>
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

                    {/* Which business this is for was already asked, with a
                        dropdown, on the previous step. */}

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
                        {/* Grey, not white: these are the register's values,
                            and the portal must not dress them as fields the
                            applicant may answer. Each one is attributed to
                            whoever GDB actually heard it from — a confirmed
                            DCRA hit and a name recalled from an earlier
                            application are not the same evidence, and the
                            source line says which this is. */}
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
                              // DCRA's own vocabulary is not the applicant's:
                              // "Business Name" is what the register calls a
                              // sole proprietorship, and nobody reading this
                              // page is obliged to know that. The raw value
                              // still shows where the portal has no word for
                              // it, rather than leaving the field blank.
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
                            <ReadOnlyField
                              label="Region"
                              value={dcraRecord.region}
                              source={dcraSourceLabel}
                            />
                          )}
                          {dcraRecord.proprietors?.length ? (
                            <ReadOnlyField
                              label="Proprietors"
                              value={dcraRecord.proprietors.join(', ')}
                              source={dcraSourceLabel}
                            />
                          ) : null}
                        </div>
                        {dcraRecord.source === 'dcra' ? (
                          <p className="mt-2 text-[11px] text-slate-400">
                            Confirmed by the DCRA register.
                          </p>
                        ) : dcraRecord.source === 'gdb_history' ? (
                          <p className="mt-2 text-[11px] text-slate-400">
                            From your earlier GDB application — GDB will verify it against DCRA.
                          </p>
                        ) : null}
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
              <SelectField
                label="Operating region"
                value={val('operating_location')}
                onChange={set('operating_location')}
                options={REGIONS}
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
                  <DataTable
                    caption="What this loan will be spent on, line by line"
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
                            placeholder="e.g. New freezer"
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
                      // The total is Frappe's SUM of the lines as saved on the
                      // draft — never added up here. Before the first save
                      // there is nothing for Frappe to total yet.
                      item: (
                        <>
                          Total{' '}
                          <span className="font-normal text-slate-400">
                            {draft?.use_of_funds_total != null
                              ? '(as saved)'
                              : '(worked out when you save)'}
                          </span>
                        </>
                      ),
                      amount:
                        draft?.use_of_funds_total != null
                          ? formatGyd(draft.use_of_funds_total)
                          : '—',
                    }}
                  />
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
                  <DocumentShelf application={draft.name} onChange={setMissing} />
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
