import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { call } from "../api";
import { useAuth } from "../auth";
import {
  ApplicationDocuments,
  type QueuedFiles,
  type DocRow,
} from "../components/apply/ApplicationDocuments";
import { DataTable } from "../components/ui/DataTable";
import { Card } from "../components/ui/Card";
import { ArrowRightIcon, CheckIcon } from "../components/ui/icons";
import {
  AttentionList,
  QuestionGroup,
  ReviewSections,
  StepRail,
} from "../components/apply/wizard";
import {
  ChoiceCard,
  MoneyField,
  Notice,
  PhoneField,
  ReadOnlyField,
  Section,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/apply/fields";
import { matchRegion, REGIONS } from "../components/apply/cluster";
import { OwnershipBlock } from "../components/apply/ownership";
import { EMPTY_EID, isCompleteEid } from "../eid";
import type {
  BankAccountRecord,
  CitizenProfile,
  DcraRecord,
  LoanApplication,
  OwnershipRow,
  UseOfFundsRow,
} from "../types";
import {
  encodeUseOfFunds,
  formatDate,
  formatGyd,
  parseUseOfFunds,
} from "../utils";
import { CONSENT_TEXT, FALSE_INFORMATION_WARNING } from "../shared/consent";
import { Footer, QButton } from "../components/portal/ui";
import { formatPhone } from "../components/PhoneInput";
import { firstRepaymentLine, moratoriumChoice } from "../shared/moratorium";
import { addDocument } from "../components/DocumentShelf";
import type { DocumentShelf as Shelf } from "../types";

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
  "Agriculture",
  "Agro-processing",
  "Fishing and aquaculture",
  "Forestry",
  "Mining and quarrying",
  "Manufacturing",
  "Construction",
  "Retail and wholesale trade",
  "Transport and logistics",
  "Tourism and hospitality",
  "Information technology",
  "Creative industries",
  "Education and training",
  "Health services",
  "Professional services",
  "Other — value creation",
];

/** How the applicant is applying. Asked AFTER existing-vs-new: whether the
 *  business already trades decides which questions the form may ask at all,
 *  and how it is owned is the next question rather than the first one. */
type Structure =
  "" | "Sole Trader" | "Partnership" | "Incorporated (Inc.)" | "Other";

/** What DCRA's own `business_type` means in the words this form uses. The
 *  register tells three kinds of ownership apart and the portal asks the same
 *  three, so a business that already has a registration is never asked to
 *  repeat what the register already says — the applicant cannot answer it
 *  better than DCRA can, and two answers to one question is how a company
 *  reaches the Bank filed as a sole trader.
 */
const DCRA_STRUCTURE: Record<string, Structure> = {
  "Business Name": "Sole Trader",
  Company: "Incorporated (Inc.)",
  Partnership: "Partnership",
};

/** How each structure reads in a sentence, for the line that tells the
 *  applicant what was taken from the register on their behalf. Silently
 *  deciding this for somebody and never saying so is how they reach the review
 *  step and find "Applying as" holding a word they never chose. */
const STRUCTURE_LABEL: Record<string, string> = {
  "Sole Trader": "Sole proprietorship",
  "Incorporated (Inc.)": "Incorporated (Inc.)",
  Partnership: "Partnership",
  Other: "Other",
};

const STRUCTURE_PROSE: Record<string, string> = {
  "Sole Trader": "a sole proprietorship",
  "Incorporated (Inc.)": "an incorporated company",
  Partnership: "a partnership",
  Other: "another structure",
};

/** The ownership DCRA asserts for a registration, or '' when the register
 *  cannot answer: no registration against the e-ID, details the applicant
 *  typed themselves, DCRA unreachable, or a `business_type` this portal does
 *  not recognise. Every one of those falls back to ASKING, because the
 *  alternative is filing somebody as something nobody chose. */
const deriveStructure = (b: DcraRecord | null): Structure =>
  (b?.business_type && DCRA_STRUCTURE[b.business_type]) || "";

type StepId =
  | "route"
  | "about"
  | "business"
  | "operations"
  | "finances"
  | "funding"
  | "evidence";

const STEPS: { id: StepId; title: string; blurb: string }[] = [
  {
    id: "route",
    title: "Application type",
    blurb: "Your details, the business and how it is owned.",
  },
  {
    id: "business",
    title: "Business details",
    blurb: "Open one group at a time.",
  },
  {
    id: "operations",
    title: "Operations",
    blurb: "Optional operating information.",
  },
  {
    id: "finances",
    title: "Financial information",
    blurb: "Financial position of the business.",
  },
  {
    id: "funding",
    title: "Funding",
    blurb: "Loan amount, tenor and disbursement account.",
  },
  { id: "evidence", title: "Review", blurb: "" },
];

/** Which section an expected document belongs to, so the review flags it
 *  against the right row. Anything else is shown under Documents only. */
const DOC_SECTION: Record<string, StepId> = {
  Identity: "route",
  "Proof of Address": "route",
  Financials: "finances",
  "Cash Flow Projection": "finances",
  "Income Statement": "finances",
  "Balance Sheet": "finances",
  "Business Plan": "finances",
};

/** The financial statements asked on Financial information, by route. A
 *  trading business files its own; a new venture projects them. */
const FINANCIAL_DOCS = (stage: "" | "Existing" | "New"): DocRow[] =>
  stage === "New"
    ? [
        {
          type: "Business Plan",
          title: "Business plan",
          hint: "With your financial projections",
        },
        {
          type: "Cash Flow Projection",
          title: "12-month cash flow projection",
          hint: "Money in and out, month by month, for your first year",
        },
        {
          type: "Income Statement",
          title: "Projected income & expenditure",
          hint: "Expected sales and costs for the first year",
        },
        {
          type: "Balance Sheet",
          title: "Opening balance sheet",
          hint: "What the venture owns and owes at the start · if you have one",
        },
      ]
    : [
        {
          type: "Cash Flow Projection",
          title: "12-month cash flow projection",
          hint: "Money in and out, month by month, for the next 12 months",
        },
        {
          type: "Income Statement",
          title: "Income & expenditure statement",
          hint: "Sales, costs and profit for the last financial year",
        },
        {
          type: "Balance Sheet",
          title: "Balance sheet",
          hint: "Assets, liabilities and equity at the last year end",
        },
      ];

const OTHER_DOC: DocRow = {
  type: "Other",
  title: "Other supporting documents",
  hint: "Letters of support, contracts or licences",
};

type Sections = Record<string, string>;

// The Business details step's groups, by the section keys each one asks.
const BRIEF_KEYS = [
  "executive_summary",
  "products_services",
  "unique_selling_point",
];
const MARKET_KEYS = [
  "customer_segments",
  "target_market",
  "primary_market",
  "secondary_market",
  "competitors",
];
const DIRECTION_KEYS = ["vision", "mission", "goals"];

/** Everything the wizard holds before GDB has a Loan Application for it.
 *  Saved server-side on the applicant's own profile
 *  (profiles.save_pending_application) — lending refuses a Loan Application
 *  with no amount or tenor, and writing placeholder figures to get past that
 *  would put numbers in the Bank's record that nobody typed. */
interface Saved {
  stage: "" | "Existing" | "New";
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
  profileTown?: string;
  profileRegion?: string;
  profileZone?: string;
  profileCode?: string;
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
  const user = assist
    ? { full_name: assist.applicantName ?? "", eid: assist.applicantEid }
    : signedIn;
  const base = assist?.base ?? "/apply";
  // Assisted: how the officer finished — handed back, or submitted for them.
  const [assistDone, setAssistDone] = useState<{
    name: string;
    submitted: boolean;
  } | null>(null);
  // Present on `/apply/:name` and absent on `/apply/new`. That single
  // difference is what tells resuming a specific draft apart from starting a
  // fresh application — the two used to share one route and one blob of
  // browser storage, which is why "start an application" continued the last
  // abandoned one.
  // `pid` is an unfinished application kept on the profile (`/apply/draft/:pid`).
  const { name: routeName, pid } = useParams<{ name: string; pid: string }>();

  const [step, setStep] = useState<StepId>("route");
  // The furthest step the applicant has reached. Going back to change an
  // answer must not cost the way forward again: every step up to this one
  // stays one click away on the rail.
  const [furthest, setFurthest] = useState<StepId>("route");
  // Review's two statements (shared/consent.ts) — the only consent the form
  // asks, ticked before the applicant's own submission.
  const [declConsent, setDeclConsent] = useState(false);
  const [declWarning, setDeclWarning] = useState(false);
  const [stage, setStage] = useState<"" | "Existing" | "New">("");
  const [structure, setStructure] = useState<Structure>("");
  // Named partners, as declared. Naming somebody is not the same as that
  // person agreeing — a co-applicant consents through their own sign-in.
  const [coApplicants, setCoApplicants] = useState<string[]>([EMPTY_EID]);
  const [amount, setAmount] = useState("");
  // The SME product's ceiling, from the server that enforces it — so the form
  // can say so at the field instead of the save failing on lending's check.
  const [ceiling, setCeiling] = useState<number | null>(null);
  // The terms and moratoria the server accepts for this product.
  const [termOptions, setTermOptions] = useState<number[]>([6, 12, 18, 24]);
  const [moratoriumOptions, setMoratoriumOptions] = useState<number[]>([
    1, 2, 3,
  ]);
  const [smeRate, setSmeRate] = useState<number | null>(null);
  const [term, setTerm] = useState("12");
  const [income, setIncome] = useState("");
  const [purpose, setPurpose] = useState("");
  const [dcra, setDcra] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [sections, setSections] = useState<Sections>({});
  const [useOfFunds, setUseOfFunds] = useState<UseOfFundsRow[]>([
    { item: "", amount: 0 },
  ]);
  // How much of the business the applicant owns, and who owns the rest. Asked
  // of a partnership and of an incorporated company; a sole trader owns all of
  // it and a cluster is not owned in shares at all. Declared, never verified
  // here — naming a co-owner is not the same as that person agreeing.
  const [applicantShare, setApplicantShare] = useState("");
  const [owners, setOwners] = useState<OwnershipRow[]>([]);

  // Section A — about the applicant. Name and e-ID come straight off
  // `whoami`, never asked. These four are the GDB Citizen Profile's own
  // declared block — the same fields the standalone Profile page edits —
  // pre-filled here from what the e-ID directory asserted at sign-in.
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [profileDob, setProfileDob] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileTown, setProfileTown] = useState("");
  const [profileRegion, setProfileRegion] = useState("");
  const [profileZone, setProfileZone] = useState("");
  const [profileCode, setProfileCode] = useState("");
  // Case documents picked before the draft exists, uploaded once it does.
  const [queued, setQueued] = useState<QueuedFiles>({});

  const [banks, setBanks] = useState<string[]>([]);
  const [bank, setBank] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [myAccounts, setMyAccounts] = useState<BankAccountRecord[] | null>(
    null,
  );
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [manualAccount, setManualAccount] = useState(false);
  const [accountNote, setAccountNote] = useState<string | null>(null);
  const [accountCheck, setAccountCheck] = useState<BankAccountRecord | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [dcraNote, setDcraNote] = useState<string | null>(null);
  const [dcraRecord, setDcraRecord] = useState<DcraRecord | null>(null);
  const [myBusinesses, setMyBusinesses] = useState<DcraRecord[] | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  // "Do you have a DCRA registration number?" — asked of an existing business.
  // A restored draft that already carries a number has answered it.
  const [hasDcra, setHasDcra] = useState<"yes" | "no" | null>(null);
  const [looking, setLooking] = useState(false);
  const [dcraChecking, setDcraChecking] = useState(false);
  // Guards a re-blur of an unchanged number from refiring the lookup, and
  // lets an edit after a confirmed hit be told apart from that same hit.
  const lastCheckedDcra = useRef("");

  const [draft, setDraft] = useState<LoanApplication | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [submitted, setSubmitted] = useState<LoanApplication | null>(null);
  const [tab, setTab] = useState<"application" | "documents">("application");

  // Ownership shares are a question only where ownership is divided. A sole
  // trader owns all of it.
  const sharesApply =
    structure === "Partnership" || structure === "Incorporated (Inc.)";

  // What the register says this business is, and whether it said anything at
  // all. When it did, the ownership cards come off the screen: DCRA has
  // already answered, and the only thing asking again can add is a different
  // answer to the same question. When it did not, they stay — see
  // `deriveStructure` for every way that happens.
  const registryStructure = deriveStructure(dcraRecord);
  const registryAnswers = stage === "Existing" && Boolean(registryStructure);

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
    stage === "Existing" &&
    (looking ||
      myBusinesses === null ||
      ((myBusinesses?.length ?? 0) > 0 && !dcraRecord));
  // An existing business is asked for its number directly — there is no "No":
  // one without a registration applies as a new venture.
  const dcraAnswer = stage === "Existing" ? "yes" : hasDcra;
  // Rows that actually name somebody. A blank line in a form is not a co-owner.
  const namedOwners = owners.filter(
    (o) => isCompleteEid(o.eid) || o.name.trim(),
  );
  const sharesDeclared =
    Number(applicantShare || 0) +
    namedOwners.reduce((sum, o) => sum + Number(o.share || 0), 0);

  // Who GDB heard this from. DCRA is the only source there is: either the
  // register answered, or nothing is confirmed.
  const dcraSourceLabel =
    dcraRecord?.source === "dcra"
      ? "Confirmed by the business registry"
      : "Not confirmed";

  const steps = STEPS;
  const moratorium = Number(sections.moratorium_months || 0);
  const profileHas = {
    dob: Boolean(profile?.date_of_birth || profile?.verified_birth_date),
    phone: Boolean(profile?.phone || profile?.verified_phone),
    email: Boolean(profile?.email || profile?.verified_email),
  };

  const set = (key: string) => (v: string) =>
    setSections((s) => ({ ...s, [key]: v }));
  const val = (key: string) => sections[key] ?? "";
  // A section answer can come back from the server as a number (an Int field),
  // so anything shown in a box or trimmed goes through String().
  const text = (key: string) => String(sections[key] ?? "");
  const filled = (keys: string[]) => keys.filter((k) => text(k).trim()).length;

  // Which Business details group is open. One at a time.
  const [openGroup, setOpenGroup] = useState(1);
  const toggleGroup = (n: number) => setOpenGroup((g) => (g === n ? 0 : n));
  const jobKeys =
    stage === "Existing"
      ? ["jobs_created", "staff_count", "employment_impact"]
      : ["jobs_created", "employment_impact"];
  const identityTotal = stage === "Existing" ? 3 : 2;
  const identityAnswered = [
    businessName,
    stage === "Existing" ? dcra : "n/a",
    text("sector"),
  ].filter((v) => v.trim() && v !== "n/a").length;

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
      const loan = await call<LoanApplication>("gdb_bank.api.loan_detail", {
        name,
      });
      if (loan.status !== "Draft") {
        // Already submitted: there is nothing to edit, and the case page is
        // where it now lives.
        navigate(assist ? `/field/cases/${name}` : `/loans/${name}`, {
          replace: true,
        });
        return;
      }
      if (loan.cluster) {
        // A group's draft is its facilitator's to prepare; the head reads it.
        navigate(`/loans/${name}`, { replace: true });
        return;
      }
      if (loan.product === "quick") {
        // A Quick Loan draft is resumed on its own form.
        if (assist) {
          setError("Quick Loan drafts are completed by the applicant.");
          return;
        }
        navigate(`/apply/quick/${name}`, { replace: true });
        return;
      }
      setDraft(loan);
      setStage((loan.business_stage as "" | "Existing" | "New") ?? "");
      const filedAs = ((loan.sections?.legal_structure as Structure) ??
        "") as Structure;
      setStructure(filedAs);
      setAmount(loan.loan_amount ? String(loan.loan_amount) : "");
      setTerm(loan.term_months ? String(loan.term_months) : "12");
      setIncome(loan.monthly_income ? String(loan.monthly_income) : "");
      setProfilePhone((cur) => cur || loan.phone || "");
      setPurpose(loan.purpose ?? "");
      setDcra(loan.dcra_number ?? "");
      setBusinessName(loan.business_name ?? "");
      setSections((loan.sections ?? {}) as Sections);
      setUseOfFunds(
        loan.use_of_funds?.length
          ? loan.use_of_funds
          : [{ item: "", amount: 0 }],
      );
      setApplicantShare(
        loan.applicant_share != null ? String(loan.applicant_share) : "",
      );
      // A draft saved before the ownership table existed carries its partners
      // only as the co_applicants e-ID list. Seed the rows from it so resuming
      // one shows the partners it was filed with rather than an empty block —
      // with no shares, because that draft never recorded any.
      const declared =
        (loan.sections?.co_applicants as string | undefined) ?? "";
      const named = declared
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      setOwners(
        loan.ownership_lines?.length
          ? loan.ownership_lines
          : named.map((eid) => ({ eid, name: "", share: 0 })),
      );
      setCoApplicants(named.length ? named : [EMPTY_EID]);
      // A resumed draft is past the consent question by definition — it could
      // not have been saved otherwise — so open it on the first step that
      // actually asks something.
      setStep("route");
      // GDB only holds a draft once the funding step has been left, so a
      // resumed draft has been through every step: all of them are reachable.
      setFurthest("evidence");
      setRestored(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That application could not be opened.",
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
    setStage(s.stage ?? "");
    setStructure(s.structure ?? "");
    setCoApplicants(s.coApplicants?.length ? s.coApplicants : [EMPTY_EID]);
    setAmount(s.amount ?? "");
    setTerm(s.term ?? "12");
    setIncome(s.income ?? "");
    setPurpose(s.purpose ?? "");
    setDcra(s.dcra ?? "");
    setBusinessName(s.businessName ?? "");
    setSections(s.sections ?? {});
    // A use-of-funds saved before the table existed is one free-text
    // sentence — carried forward as a single row rather than dropped.
    const legacyUseOfFunds = s.sections?.use_of_funds;
    setUseOfFunds(
      s.useOfFunds?.length
        ? s.useOfFunds
        : (parseUseOfFunds(legacyUseOfFunds) ??
            (legacyUseOfFunds
              ? [{ item: legacyUseOfFunds, amount: 0 }]
              : [{ item: "", amount: 0 }])),
    );
    setApplicantShare(s.applicantShare ?? "");
    setOwners(s.owners ?? []);
    setProfileDob((cur) => s.profileDob || cur);
    setProfilePhone((cur) => s.profilePhone || cur);
    setProfileEmail((cur) => s.profileEmail || cur);
    setProfileAddress((cur) => s.profileAddress || cur);
    setProfileTown((cur) => s.profileTown || cur);
    setProfileRegion((cur) => s.profileRegion || cur);
    setProfileZone((cur) => s.profileZone || cur);
    setProfileCode((cur) => s.profileCode || cur);
    // A step id from an older wizard would point nowhere, so only a current one is used.
    if (s.step && STEPS.some((st) => st.id === s.step)) {
      setStep(s.step);
      setFurthest(s.step);
    }
  };

  useEffect(() => {
    call<{
      ceiling: number;
      term_options?: number[];
      moratorium_options?: number[];
      rate_of_interest?: number;
    }>("gdb_bank.api.sme_loan_terms")
      .then((t) => {
        setCeiling(t.ceiling || null);
        if (t.term_options?.length) setTermOptions(t.term_options);
        if (t.moratorium_options?.length)
          setMoratoriumOptions(t.moratorium_options);
        setSmeRate(t.rate_of_interest ?? null);
      })
      .catch(() => setCeiling(null));
  }, []);

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
      call<{ id: string; state: Saved; saved_on: string }>(
        "gdb_bank.profiles.pending_application",
        { id: pid },
      )
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
    profileTown,
    profileRegion,
    profileZone,
    profileCode,
  });

  /** Save wherever this application lives now: the Loan Application draft
   *  once GDB holds one, the profile's in-progress copy before that. `at` is
   *  the step it should reopen on. */
  const saveProgress = async (at: StepId = step) => {
    if (draft) {
      await saveDraft();
      return;
    }
    const saved = await call<{ id: string; saved_on: string }>(
      "gdb_bank.profiles.save_pending_application",
      {
        state: snapshot(at),
        id: pendingId ?? undefined,
        saved_on: pendingSavedOn,
      },
    );
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
    call<string[]>("gdb_bank.api.bank_options")
      .then(setBanks)
      .catch(() => setBanks([]));
    void loadMyAccounts();
    call<CitizenProfile>("gdb_bank.profiles.my_profile")
      .then((p) => {
        setProfile(p);
        // Prefer what the applicant already declared over the directory's
        // assertion, and never overwrite a value a restored draft already
        // holds — a functional update is what makes both true at once.
        // No invented value: when neither the applicant nor the e-ID directory
        // gave a birth date the field stays empty, and the step asks for it.
        setProfileDob(
          (cur) => cur || p.date_of_birth || p.verified_birth_date || "",
        );
        setProfilePhone((cur) => cur || p.phone || p.verified_phone || "");
        setProfileEmail((cur) => cur || p.email || p.verified_email || "");
        setProfileAddress(
          (cur) => cur || p.address || p.verified_address || "",
        );
        setProfileTown((cur) => cur || p.village_or_town || "");
        setProfileRegion((cur) => cur || p.region || "");
        setProfileZone((cur) => cur || p.address_zone || "");
        setProfileCode((cur) => cur || p.address_code || "");
      })
      .catch(() => {});
  }, []);

  const selectAccount = (a: BankAccountRecord) => {
    setBank(a.bank);
    setAccountNo(a.account_number);
    setBranchCode(a.branch_code ?? "");
    setAccountCheck(null);
    setAccountNote(null);
  };

  // Ask the switch which accounts this applicant holds. One selects itself;
  // several offer a choice; none falls back to typing, because a switch that
  // cannot answer must not stop an application.
  const loadMyAccounts = async () => {
    setAccountsLoading(true);
    try {
      const found = await call<BankAccountRecord[]>(
        "gdb_bank.api.my_bank_accounts",
      );
      setMyAccounts(found ?? []);
      if (found?.length === 1) selectAccount(found[0]);
      if (!found?.length) {
        setManualAccount(true);
        await call<{
          bank: string;
          bank_account_no: string;
          branch_code: string;
        } | null>("gdb_bank.api.my_bank_details")
          .then((d) => {
            if (!d) return;
            setBank(d.bank ?? "");
            setAccountNo(d.bank_account_no ?? "");
            setBranchCode(d.branch_code ?? "");
          })
          .catch(() => undefined);
        setAccountNote(
          "No account found in your name. Enter it below; GDB verifies it before disbursement.",
        );
      }
    } catch {
      setMyAccounts([]);
      setManualAccount(true);
      setAccountNote(
        "Bank unavailable. Enter your account; GDB verifies it before disbursement.",
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
        await call<BankAccountRecord>("gdb_bank.api.verify_bank_account", {
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

  const selectBusiness = (
    b: DcraRecord,
    opts?: { keepStructure?: boolean },
  ) => {
    setDcraRecord(b);
    setDcra(b.registration_number);
    setBusinessName(b.business_name ?? "");
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
      setSections((s) => ({
        ...s,
        operating_location: s.operating_location || matchRegion(b.region!),
      }));
  };

  const loadMyBusinesses = async () => {
    setLooking(true);
    try {
      const found = await call<DcraRecord[]>("gdb_bank.api.my_businesses");
      setMyBusinesses(found ?? []);
      // A resumed draft already knows its registration number but not the
      // record behind it. Re-attaching it here is what puts the registry's
      // ownership back on screen instead of falling back to the cards —
      // `keepStructure` so what the applicant filed still wins over it.
      const resumed =
        dcra.trim() &&
        found?.find((b) => b.registration_number === dcra.trim());
      if (resumed) selectBusiness(resumed, { keepStructure: true });
      else if (found?.length === 1)
        selectBusiness(found[0], { keepStructure: true });
      if (!found?.length) {
        setManualEntry(true);
        setDcraNote(
          "No business registration found for your e-ID. Enter the details; GDB will verify them.",
        );
      }
    } catch {
      setMyBusinesses([]);
      setManualEntry(true);
      setDcraNote(
        "The business registry is unavailable. Enter the details; GDB will verify them.",
      );
    } finally {
      setLooking(false);
    }
  };

  // A restored draft only carries `stage` and `dcra` — the fetched business
  // list itself is never persisted. Without this, reloading mid-draft on the
  // existing-business route would show "DCRA has no business registered" even
  // though the list simply has not been re-fetched yet.
  useEffect(() => {
    if (stage === "Existing" && myBusinesses === null) void loadMyBusinesses();
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
      const result = await call<DcraRecord>("gdb_bank.api.dcra_lookup", {
        dcra_number: number,
      });
      if (result.business_name) {
        setDcraRecord(result);
        setBusinessName(result.business_name);
        setDcraNote(
          result.owned_by_caller === false
            ? "Your e-ID is not listed as a proprietor. GDB will verify your connection."
            : null,
        );
        if (result.region) {
          setSections((s) => ({
            ...s,
            operating_location:
              s.operating_location || matchRegion(result.region!),
          }));
        }
      } else {
        setDcraRecord(null);
        setDcraNote(
          result.status === "Not Found"
            ? "No business registration found for that number."
            : "The business registry is unavailable. GDB will verify the number.",
        );
      }
    } catch {
      setDcraRecord(null);
      setDcraNote(
        "The business registry is unavailable. GDB will verify the number.",
      );
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

  // --- saving -------------------------------------------------------------
  /** Open or update the server draft. Only possible once the funding request
   *  is answered — the server refuses an application with no amount, term or
   *  purpose, and it is right to. */
  const saveDraft = async (): Promise<LoanApplication> => {
    if (!bank || !accountNo) {
      throw new Error(
        (myAccounts?.length ?? 0) > 0 && !manualAccount
          ? "Select the disbursement account."
          : "Enter the disbursement account.",
      );
    }
    // The payout destination first: if this fails the applicant should fix it
    // and retry, not end up with a loan nobody can pay.
    await call("gdb_bank.api.save_bank_details", {
      bank,
      bank_account_no: accountNo,
      branch_code: branchCode,
    });
    const saved = await call<LoanApplication>("gdb_bank.api.save_application", {
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
      cluster: "",
      sections: {
        ...sections,
        legal_structure: structure,
        // Only complete e-IDs travel. A half-typed one is not a partner.
        // Kept in step with the ownership rows, which are now where partners
        // are named: this field is what the desk and older readers show, and
        // leaving it to the retired input would have emptied it on every save.
        co_applicants:
          structure === "Partnership"
            ? namedOwners
                .map((o) => o.eid)
                .filter(isCompleteEid)
                .join(", ")
            : "",
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
    if (!routeName && saved.name)
      navigate(`${base}/${saved.name}`, { replace: true });
    return saved;
  };

  /** Upload what was picked before the draft existed. A file that fails is
   *  reported and left in the queue; the draft itself is already saved. */
  const flushQueued = async (application: string) => {
    const waiting = Object.entries(queued).filter(([, f]) => f.length);
    if (waiting.length === 0) return;
    const shelf = await call<Shelf>("gdb_bank.documents.list_documents", {
      application,
    });
    const left: QueuedFiles = {};
    for (const [type, files] of waiting) {
      for (const file of files) {
        try {
          await addDocument(file, type, shelf.settings, application);
        } catch {
          left[type] = [...(left[type] ?? []), file];
        }
      }
    }
    setQueued(left);
    if (Object.keys(left).length)
      setError(
        "Your application is saved, but some documents did not upload. Try them again on the Documents tab.",
      );
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
    if (step === "route") {
      if (!stage) return "Select the application type.";
      // The server refuses an existing business without its DCRA number
      // (services/application.py), so "No" cannot go on as one.
      if (stage === "Existing" && !dcra.trim())
        return "Enter the business registration number.";
      if (registryPending && looking) return "Checking the register…";
      if (!structure) return "Select the legal structure.";
      if (structure === "Other" && !text("legal_structure_other").trim())
        return "Describe the legal structure.";
      // These three hold the screen open on the ownership block. They are
      // asked ONLY while that block is on it — a rule about a question the
      // applicant cannot see is a dead end, not a check.
      if (
        askOwnership &&
        structure === "Partnership" &&
        namedOwners.length === 0
      ) {
        return "Name at least one partner.";
      }
      if (askOwnership && !applicantShare) {
        return "Enter your ownership share.";
      }
      // Over 100% cannot be true of anything, and the server refuses it too.
      // Under 100% is deliberately allowed — see OwnershipBlock.
      if (askOwnership && sharesDeclared > 100) {
        return `Ownership shares total ${sharesDeclared}%. They cannot exceed 100%.`;
      }
    }
    if (step === "about" || step === "route") {
      if (!profileDob) return "Enter your date of birth.";
      if (!profilePhone.trim()) return "Enter your phone number.";
      // Guyana numbers are seven digits (592 in front when typed with the
      // country code). The server applies the full check on save.
      const phoneDigits = profilePhone.replace(/\D/g, "");
      if (
        !profilePhone.trim().startsWith("+") &&
        !(
          phoneDigits.length === 7 ||
          (phoneDigits.length === 10 && phoneDigits.startsWith("592"))
        )
      ) {
        return "Enter a valid phone number, e.g. 600 1234.";
      }
      if (!profileEmail.trim()) return "Enter your email address.";
      if (!profileAddress.trim()) return "Enter your residential address.";
      if (!profileRegion) return "Select the region you live in.";
    }
    if (step === "business") {
      if (!text("executive_summary").trim())
        return "Enter the executive summary.";
      if (!text("products_services").trim())
        return "Enter the products and services.";
      if (!text("unique_selling_point").trim())
        return "Enter the marketing strategy.";
      if (!businessName.trim()) return "Enter the business name.";
      if (stage === "Existing" && !dcra.trim())
        return "Enter the business registration number.";
      if (!text("sector").trim()) return "Select the sector.";
    }
    if (step === "funding") {
      if (!amount || Number(amount) <= 0) return "Enter the loan amount.";
      if (ceiling && Number(amount) > ceiling)
        return `The SME Direct Loan is up to ${formatGyd(ceiling)}.`;
      if (!termOptions.includes(Number(term)))
        return `Choose a repayment term of ${termOptions.slice(0, -1).join(", ")} or ${termOptions[termOptions.length - 1]} months.`;
      if (!moratoriumOptions.includes(moratorium))
        return "Choose when you want to start repaying.";
      if (!purpose.trim()) return "Enter the purpose of the loan.";
      if (!bank || !accountNo) return "Enter the disbursement account.";
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
      if (step === "business")
        setOpenGroup(BRIEF_KEYS.some((k) => !text(k).trim()) ? 1 : 5);
      return false;
    }
    setError(null);

    // Written to the citizen's own profile — the same record the standalone
    // Profile page edits — not to this application. It is one person's
    // details, not one loan's.
    if (step === "about" || step === "route") {
      setBusy(true);
      try {
        setProfile(
          await call<CitizenProfile>("gdb_bank.profiles.save_profile", {
            date_of_birth: profileDob,
            phone: profilePhone,
            email: profileEmail,
            address: profileAddress,
            village_or_town: profileTown,
            region: profileRegion,
            address_zone: profileZone,
            address_code: profileCode,
          }),
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save your details",
        );
        setBusy(false);
        return false;
      }
      setBusy(false);
    }

    // From the funding step onward there is enough to hold a server draft, and
    // from then on every move forward writes one.
    if (step === "funding") {
      setBusy(true);
      try {
        const saved = await saveDraft();
        await flushQueued(saved.name);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not save your application",
        );
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
        setError(
          err instanceof Error
            ? err.message
            : "Could not save your application",
        );
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        setError(
          err instanceof Error
            ? err.message
            : "Could not save your application",
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    navigate(assist?.home ?? "/apply");
  };

  const goBack = () => {
    setError(null);
    setStep(steps[Math.max(index - 1, 0)].id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Assisted: submit it for the applicant (recorded as the officer's act,
   *  and the applicant is told), or hand it back for them to submit. */
  const finishAssisted = async (submit: boolean) => {
    if (!assist) return;
    if (
      submit &&
      !window.confirm(
        `Submit this application to GDB for ${assist.applicantName ?? "the applicant"}?`,
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      const saved = await saveDraft();
      await call(
        submit
          ? "gdb_bank.field_officer.submit_assisted_application"
          : "gdb_bank.field_officer.hand_off_application",
        { consent: assist.consent, name: saved.name },
      );
      setAssistDone({ name: saved.name, submitted: submit });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : submit
            ? "Could not submit"
            : "Could not send to the applicant",
      );
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
      // The first statement on Review IS the consent the profile records.
      await call("gdb_bank.profiles.record_consent");
      const loan = await call<LoanApplication>(
        "gdb_bank.api.submit_application",
        {
          name: saved.name,
        },
      );
      setSubmitted(loan);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not submit application",
      );
    } finally {
      setBusy(false);
    }
  };

  // --- review -------------------------------------------------------------
  const goTo = (id: StepId) => {
    setTab("application");
    setError(null);
    setStep(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Every expected document the wizard can attach, in the order the tab lists
  // them. Financial evidence follows the route: accounts for a trading
  // business, a plan for a new one.
  const docRows: DocRow[] = [
    ...(stage
      ? FINANCIAL_DOCS(stage).map((r) => ({
          ...r,
          hint: `${r.hint} · Financial information`,
        }))
      : []),
    {
      type: "Bank Statement",
      title: "Bank statements",
      hint: "Business account statements",
    },
    {
      type: "Quotation",
      title: "Supplier quotations",
      hint: "For items to be financed · Funding",
    },
    {
      type: "Identity",
      title: "Identity document",
      hint: "National ID or passport · Your details",
    },
    {
      type: "Proof of Address",
      title: "Proof of address",
      hint: "Utility bill or bank letter · Your details",
    },
    OTHER_DOC,
  ];
  const docTitle = (type: string) =>
    docRows.find((r) => r.type === type)?.title ?? type;

  const reviewSteps = steps.filter((s) => s.id !== "evidence");
  const fieldIssues = reviewSteps.flatMap((s) => {
    const blocker = blockerFor(s.id);
    return blocker
      ? [
          {
            section: s.id,
            title: blocker,
            where: s.title,
            kind: "Required field missing",
            action: "Go to field",
            go: () => goTo(s.id),
          },
        ]
      : [];
  });
  // Advisory: shown, never a bar to submitting — the Bank chases paperwork.
  const docIssues = missing.map((t) => ({
    section: DOC_SECTION[t] ?? ("evidence" as StepId),
    title: `Attach your ${docTitle(t).toLowerCase()}`,
    where: steps.find((s) => s.id === DOC_SECTION[t])?.title ?? "Documents",
    kind: "Optional",
    action: "Go to documents",
    go: () => setTab("documents"),
  }));
  const issues = [...fieldIssues, ...docIssues];
  // Unanswered questions only. Expected documents are counted apart: they are
  // optional at submission, and showing them as "missing" reads as a question
  // left blank.
  const issuesIn = (id: StepId) =>
    fieldIssues.filter((i) => i.section === id).length;
  const docsIn = (id: StepId) =>
    docIssues.filter((i) => i.section === id).length;

  const lastSaved = draft?.modified ?? pendingSavedOn;
  const savedAt = lastSaved
    ? new Date(lastSaved.replace(" ", "T")).toLocaleTimeString("en-GY", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const show = (v: string | null | undefined) => (v && String(v).trim()) || "—";
  const money = (key: string) => (val(key) ? formatGyd(Number(val(key))) : "—");
  const stageLabel =
    stage === "Existing"
      ? "Existing business"
      : stage === "New"
        ? "New venture"
        : "";
  const structureLabel = STRUCTURE_LABEL[structure] ?? "";
  const OPERATIONS_KEYS = [
    "operating_location",
    "production_process",
    "equipment_required",
    "suppliers",
    "permits_required",
  ];

  const summaryFor = (id: StepId): string => {
    const join = (...parts: (string | false | null | undefined)[]) =>
      parts.filter(Boolean).join(" · ");
    switch (id) {
      case "route":
        return join(stageLabel, structureLabel);
      case "about":
        return join(
          profile?.verified_full_name || user?.full_name,
          (user?.eid || profile?.eid) && `e-ID ${user?.eid || profile?.eid}`,
          profileAddress,
        );
      case "business":
        return join(businessName, dcra, val("sector"));
      case "operations":
        return `Optional · ${OPERATIONS_KEYS.filter((k) => val(k).trim()).length} of ${OPERATIONS_KEYS.length} answered`;
      case "finances":
        return stage === "Existing"
          ? "Declared figures, last financial year"
          : stage === "New"
            ? "Projections"
            : "";
      case "funding":
        return join(
          amount && formatGyd(Number(amount)),
          term && `${term} months`,
          purpose,
        );
      default:
        return "";
    }
  };

  const answersFor = (id: StepId): [string, string][] => {
    switch (id) {
      case "route":
        return [
          ...answersFor("about"),
          ["Application type", show(stageLabel)],
          [
            "Legal structure",
            show(
              structure === "Other"
                ? `Other — ${text("legal_structure_other")}`
                : structureLabel,
            ),
          ],
          ...(askOwnership
            ? ([
                [
                  "Your ownership share",
                  applicantShare ? `${applicantShare}%` : "—",
                ],
                [
                  "Other owners",
                  show(
                    namedOwners
                      .map((o) => `${o.name || o.eid} (${o.share || 0}%)`)
                      .join(", "),
                  ),
                ],
              ] as [string, string][])
            : []),
        ];
      case "about":
        return [
          ["Full name", show(profile?.verified_full_name || user?.full_name)],
          ["e-ID", show(user?.eid || profile?.eid)],
          ["Date of birth", profileDob ? formatDate(profileDob) : "—"],
          ["Phone number", show(profilePhone)],
          ["Email address", show(profileEmail)],
          [
            "Residential address",
            show(
              [profileAddress, profileTown, profileRegion]
                .filter((v) => v.trim())
                .join(", "),
            ),
          ],
          ["Zone", show(profileZone)],
          ["Address code", show(profileCode)],
        ];
      case "business":
        return [
          ["Business name", show(businessName)],
          ...(stage === "Existing"
            ? [["Business registration number", show(dcra)] as [string, string]]
            : []),
          ["Sector", show(text("sector"))],
          ["Sub-sector", show(text("sub_sector"))],
          ["Executive summary", show(text("executive_summary"))],
          ["Products and services", show(text("products_services"))],
          ["Marketing strategy", show(text("unique_selling_point"))],
          ["Customer segments", show(text("customer_segments"))],
          ["Target market", show(text("target_market"))],
          ["Competitors", show(text("competitors"))],
          ["Jobs to be created", show(text("jobs_created"))],
          ...(stage === "Existing"
            ? [["Current staff", show(text("staff_count"))] as [string, string]]
            : []),
          ["Economic impact", show(text("employment_impact"))],
          ["Vision", show(text("vision"))],
          ["Mission", show(text("mission"))],
          ["Goals", show(text("goals"))],
        ];
      case "operations":
        return [
          ["Operating region", show(val("operating_location"))],
          ["Production process", show(val("production_process"))],
          ["Equipment and fixed assets", show(val("equipment_required"))],
          ["Key suppliers", show(val("suppliers"))],
          ["Licences and permits", show(val("permits_required"))],
        ];
      case "finances":
        return stage === "Existing"
          ? [
              ["Annual revenue", money("annual_revenue")],
              ["Cost of sales", money("cost_of_sales")],
              ["Operating expenses", money("operating_expenses")],
              ["Annual debt service", money("existing_obligations")],
              ["Cash and bank balances", money("cash_position")],
            ]
          : stage === "New"
            ? [
                ["Projected sales volume", show(val("expected_sales_volume"))],
                ["Projected annual revenue", money("projected_revenue")],
                ["Projected annual costs", money("projected_costs")],
                ["Start-up costs", money("initial_costs")],
                [
                  "Projected monthly cash flow",
                  money("expected_cash_position"),
                ],
                ["Key assumptions", show(val("assumptions"))],
              ]
            : [];
      case "funding":
        return [
          ["Loan amount", amount ? formatGyd(Number(amount)) : "—"],
          ["Repayment term", term ? `${term} months` : "—"],
          ["Moratorium", moratoriumChoice(moratorium)],
          ["Interest rate", "0%"],
          ["Purpose", show(purpose)],
          [
            "Use of proceeds",
            show(
              useOfFunds
                .filter((r) => r.item.trim())
                .map((r) => `${r.item} — ${formatGyd(r.amount || 0)}`)
                .join("\n"),
            ),
          ],
          ["Personal monthly income", income ? formatGyd(Number(income)) : "—"],
          [
            "Disbursement account",
            bank ? `${bank} ••••${accountNo.slice(-4)}` : "—",
          ],
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
          {assistDone.submitted
            ? "Submitted for the applicant"
            : "Sent to applicant"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Reference {assistDone.name}.{" "}
          {assistDone.submitted
            ? "The applicant has been told."
            : "Waiting for the applicant to submit."}
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
        <h1 className="text-2xl font-bold text-slate-900">
          Application submitted
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Reference {submitted.name}. Now with a loan officer.
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

  // Sections with every required answer given, among those already reached.
  const formSteps = steps.filter((s) => s.id !== "evidence");
  const doneCount = formSteps.filter(
    (s, i) => i < reached && issuesIn(s.id) === 0,
  ).length;
  const amountValue = Number(amount) || 0;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => void exitToApplications()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand transition-colors hover:text-brand-dark disabled:opacity-50"
      >
        <ArrowRightIcon className="h-4 w-4 rotate-180" />
        {assist ? "Back" : "My applications"}
      </button>

      {/* Which form, which step, whether it is saved — and every step, visible
          from the start, because an applicant deciding whether to begin needs
          to see what the whole thing asks. */}
      <header className="rounded-2xl border border-slate-200 bg-white px-5 pt-4 pb-3 shadow-xs sm:px-6">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-600">
              SME Direct Loan application
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {tab === "documents"
                ? "Documents"
                : `Step ${index + 1} of ${steps.length} · ${current.title}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              <span
                className={`h-1.5 w-1.5 rounded-full ${savedAt ? "bg-emerald-500" : "bg-slate-400"}`}
              />
              {savedAt ? `Saved ${savedAt}` : "Not saved yet"}
            </span>
            <div
              className="inline-flex rounded-xl bg-slate-100 p-1"
              role="tablist"
              aria-label="View"
            >
              {(
                [
                  ["application", "Application"],
                  ["documents", "Documents"],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                    tab === id
                      ? "bg-white text-brand-dark shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {text}
                  {id === "documents" && draft && missing.length > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-black text-amber-700">
                      {missing.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        <StepRail
          bare
          steps={steps}
          index={index}
          reached={reached}
          active={tab === "application"}
          attention={(id) => id !== "evidence" && issuesIn(id as StepId) > 0}
          onJump={(i) => {
            setTab("application");
            void jumpTo(i);
          }}
        />
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {tab === "documents" && (
            <Card className="space-y-4 rounded-2xl! p-6">
              <header className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-dark text-amber-300 ring-4 ring-emerald-50">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-5 w-5"
                    aria-hidden
                  >
                    <path
                      d="M5 2.5h6.5L15 6v11.5H5v-15Zm6 0V6.5h4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black leading-tight tracking-tight text-slate-900">
                    Documents
                  </h2>
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    {draft
                      ? "Everything for this application in one place. Drop a file on any card."
                      : "Add them now — your identity documents upload straight away, the rest when you save Funding."}
                  </p>
                </div>
              </header>
              <ApplicationDocuments
                application={draft?.name ?? null}
                rows={docRows}
                onChange={setMissing}
                queued={queued}
                onQueue={setQueued}
              />
              <QButton
                kind="secondary"
                back
                onClick={() => setTab("application")}
              >
                Back to application
              </QButton>
            </Card>
          )}

          <div className={`min-w-0 ${tab === "application" ? "" : "hidden"}`}>
            {assist && (
              <div className="mb-4">
                <Notice tone="warn">Assisting {assist.applicantName}</Notice>
              </div>
            )}
            {!assist && draft?.handed_off_on && (
              <div className="mb-4">
                <Notice tone="info">
                  Prepared with{" "}
                  {draft.assisted_by_name ?? "a GDB Field Officer"}. Check it
                  and submit.
                </Notice>
              </div>
            )}
            {restored && (
              <div className="mb-4">
                <Notice tone="info">Resumed from your saved draft.</Notice>
              </div>
            )}

            {error && (
              <div
                className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
                role="alert"
              >
                {error}
              </div>
            )}

            {/* `pb-20` clears the sticky action bar below. Without it the bar
            rests ON the card's last control once the page is scrolled to the
            end — and the last control on a step can be a REQUIRED question,
            so a translucent bar sitting over it is not a cosmetic problem: the
            answer cannot be given, and the click lands on Continue instead. */}
            <Card
              className={`space-y-6 rounded-2xl! p-5! shadow-xs sm:p-6! ${isLast ? "" : "pb-20!"}`}
            >
              {!isLast && (
                <header className="flex items-center gap-3 border-b border-slate-100 pb-4">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-dark text-base font-black text-amber-300 ring-4 ring-emerald-50">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-black leading-tight tracking-tight text-slate-900">
                      {current.title}
                      {step === "business" && stageLabel ? (
                        <span className="ml-2 align-middle rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                          {stageLabel}
                        </span>
                      ) : null}
                    </h2>
                    {current.blurb && (
                      <p className="mt-0.5 text-[13px] text-slate-500">
                        {current.blurb}
                      </p>
                    )}
                  </div>
                </header>
              )}

              {/* ---------------------------------------------------- STEP: ROUTE */}
              {step === "route" && (
                <>
                  {/* Who is applying, from the account — never asked again. A
                  detail the account does not hold yet is asked here, in place;
                  the address is always open, in its parts. */}
                  <section
                    aria-label="Your details"
                    className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[11px] font-black uppercase tracking-wider text-emerald-800">
                        {assist ? "Applicant's details" : "Your details"}
                      </p>
                      {!assist && (
                        <p className="text-[11px] text-slate-500">
                          From your account. To change them, go to{" "}
                          <Link
                            to="/profile"
                            className="font-bold text-brand hover:underline"
                          >
                            My details
                          </Link>
                          .
                        </p>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
                      {(
                        [
                          [
                            "Name",
                            profile?.verified_full_name ||
                              user?.full_name ||
                              "—",
                          ],
                          [
                            "e-ID",
                            user?.eid ||
                              profile?.eid ||
                              (user && "tin" in user ? user.tin : null) ||
                              "—",
                          ],
                          ...(profileHas.phone
                            ? [["Phone", formatPhone(profilePhone) || "—"]]
                            : []),
                          ...(profileHas.dob
                            ? [
                                [
                                  "Date of birth",
                                  profileDob ? formatDate(profileDob) : "—",
                                ],
                              ]
                            : []),
                          ...(profileHas.email
                            ? [["Email", profileEmail || "—"]]
                            : []),
                        ] as [string, string][]
                      ).map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {k}
                          </dt>
                          <dd
                            className={`break-words text-sm font-bold text-slate-900 ${k === "e-ID" ? "font-mono" : ""}`}
                          >
                            {v}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {(!profileHas.dob ||
                      !profileHas.phone ||
                      !profileHas.email) && (
                      <div className="mt-3 grid gap-4 border-t border-emerald-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                        {!profileHas.dob && (
                          <TextField
                            label="Date of birth"
                            type="date"
                            value={profileDob}
                            onChange={setProfileDob}
                            required
                          />
                        )}
                        {!profileHas.phone && (
                          <PhoneField
                            label="Phone number"
                            value={profilePhone}
                            onChange={setProfilePhone}
                            required
                          />
                        )}
                        {!profileHas.email && (
                          <TextField
                            label="Email address"
                            type="email"
                            value={profileEmail}
                            onChange={setProfileEmail}
                            required
                            placeholder="you@example.gy"
                          />
                        )}
                      </div>
                    )}

                    <div className="mt-3 border-t border-emerald-100 pt-3">
                      <p className="mb-2 text-[13px] font-extrabold text-slate-900">
                        Residential address
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                        <div className="sm:col-span-2 lg:col-span-3">
                          <TextField
                            label="House and street"
                            required
                            value={profileAddress}
                            onChange={setProfileAddress}
                            placeholder="Lot 12 Main Street"
                          />
                        </div>
                        <div className="lg:col-span-3">
                          <TextField
                            label="Village or town"
                            value={profileTown}
                            onChange={setProfileTown}
                            placeholder="e.g. Bartica"
                          />
                        </div>
                        <div className="sm:col-span-2 lg:col-span-2">
                          <SelectField
                            label="Region"
                            required
                            value={profileRegion}
                            onChange={setProfileRegion}
                            options={REGIONS}
                            placeholder="Choose a region"
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <TextField
                            label="Zone"
                            value={profileZone}
                            onChange={setProfileZone}
                            placeholder="e.g. Zone B"
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <TextField
                            label="Code"
                            value={profileCode}
                            onChange={setProfileCode}
                            placeholder="e.g. 4-AB-102"
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                  <Section letter="1" title="Application type">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ChoiceCard
                        title="Existing business"
                        body="Already trading."
                        selected={stage === "Existing"}
                        onSelect={() => {
                          setStage("Existing");
                          setHasDcra("yes");
                          setDcraNote(null);
                          setDcraRecord(null);
                          setManualEntry(true);
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
                        body="A start-up, or a business about to begin trading."
                        selected={stage === "New"}
                        onSelect={() => {
                          setStage("New");
                          setDcra("");
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
                  {stage === "Existing" && (
                    <Section
                      letter="2"
                      title="Business registration number"
                      blurb="GDB checks it with the business registry."
                    >
                      {dcraAnswer === "yes" && (
                        <>
                          {looking && (
                            <p className="text-sm text-slate-500">
                              Retrieving business registrations…
                            </p>
                          )}
                          {!looking && (myBusinesses?.length ?? 0) > 0 && (
                            <SelectField
                              label="Registered to your e-ID"
                              value={
                                myBusinesses?.find(
                                  (b) => b.registration_number === dcra,
                                )
                                  ? businessOption(
                                      myBusinesses.find(
                                        (b) => b.registration_number === dcra,
                                      )!,
                                    )
                                  : ""
                              }
                              onChange={(v) => {
                                const chosen = myBusinesses?.find(
                                  (b) => businessOption(b) === v,
                                );
                                if (chosen) selectBusiness(chosen);
                              }}
                              options={(myBusinesses ?? []).map(businessOption)}
                              placeholder="Choose, or type the number below"
                            />
                          )}
                          <div onBlur={() => void checkTypedDcra()}>
                            <TextField
                              label="Business registration number"
                              required
                              value={dcra}
                              onChange={onDcraChange}
                              placeholder="BN-2024-004512"
                            />
                          </div>
                          {dcraChecking && (
                            <p className="text-sm text-slate-500">
                              Checking the business registry…
                            </p>
                          )}
                          {dcraRecord?.business_name && (
                            <Notice tone="good">
                              {dcraRecord.business_name} · {dcraRecord.status} ·{" "}
                              {dcraSourceLabel}
                            </Notice>
                          )}
                          {dcraNote && <Notice tone="warn">{dcraNote}</Notice>}
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
                      letter={stage === "Existing" ? "3" : "2"}
                      title="Legal structure"
                      blurb={
                        registryAnswers
                          ? "From the business registry."
                          : undefined
                      }
                    >
                      {registryPending ? (
                        <p className="text-sm text-slate-500">
                          {looking
                            ? "Retrieving business registrations…"
                            : "Select the registered business above."}
                        </p>
                      ) : registryAnswers ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                          <p className="text-sm text-slate-700">
                            <span className="font-bold text-slate-900">
                              {dcraRecord?.business_name ?? dcra}
                            </span>{" "}
                            — filed as {STRUCTURE_PROSE[registryStructure]}.
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Corrections are made at the business registry.
                          </p>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <ChoiceCard
                            title="Sole proprietorship"
                            selected={structure === "Sole Trader"}
                            onSelect={() => setStructure("Sole Trader")}
                          />
                          <ChoiceCard
                            title="Incorporated (Inc.)"
                            selected={structure === "Incorporated (Inc.)"}
                            onSelect={() => setStructure("Incorporated (Inc.)")}
                          />
                          <ChoiceCard
                            title="Partnership"
                            selected={structure === "Partnership"}
                            onSelect={() => setStructure("Partnership")}
                          />
                          <ChoiceCard
                            title="Other"
                            body="A co-operative, society or trust."
                            selected={structure === "Other"}
                            onSelect={() => setStructure("Other")}
                          />
                        </div>
                      )}
                      {structure === "Other" && !registryAnswers && (
                        <TextField
                          label="What is the legal structure?"
                          required
                          value={text("legal_structure_other")}
                          onChange={set("legal_structure_other")}
                          placeholder="e.g. Co-operative society"
                        />
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

              {/* ------------------------------------------------- STEP: BUSINESS */}
              {/* Grouped, one open at a time: a long page of text boxes is where a
              phone applicant gives up. Each group says how far it is answered. */}
              {step === "business" && (
                <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 shadow-xs">
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
                      value={text("executive_summary")}
                      onChange={set("executive_summary")}
                    />
                    <TextAreaField
                      label="Products and services"
                      required
                      max={1000}
                      value={text("products_services")}
                      onChange={set("products_services")}
                    />
                    <TextAreaField
                      label="Marketing strategy"
                      hint="How you will reach customers and win them over."
                      required
                      max={1000}
                      value={text("unique_selling_point")}
                      onChange={set("unique_selling_point")}
                    />
                    {stage === "New" && draft && (
                      <div className="rounded-lg bg-brand-light/40 p-3">
                        <ApplicationDocuments
                          application={draft.name}
                          rows={[
                            {
                              type: "Business Plan",
                              title: "Business plan document",
                              hint: "Optional",
                            },
                          ]}
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
                      value={text("customer_segments")}
                      onChange={set("customer_segments")}
                    />
                    <TextAreaField
                      label="Target market"
                      max={1000}
                      value={text("target_market")}
                      onChange={set("target_market")}
                    />
                    <div className="grid gap-4 lg:grid-cols-2">
                      <TextAreaField
                        label="Primary market"
                        hint="Where most of your sales come from."
                        max={1000}
                        value={text("primary_market")}
                        onChange={set("primary_market")}
                      />
                      <TextAreaField
                        label="Secondary market"
                        hint="Other customers or places you sell to, or plan to."
                        max={1000}
                        value={text("secondary_market")}
                        onChange={set("secondary_market")}
                      />
                    </div>
                    <TextAreaField
                      label="Competitors"
                      max={1000}
                      value={text("competitors")}
                      onChange={set("competitors")}
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
                        value={text("jobs_created")}
                        onChange={set("jobs_created")}
                      />
                      {stage === "Existing" && (
                        <TextField
                          label="Current staff"
                          type="number"
                          inputMode="numeric"
                          value={text("staff_count")}
                          onChange={set("staff_count")}
                        />
                      )}
                    </div>
                    <TextAreaField
                      label="Economic impact"
                      max={1000}
                      value={text("employment_impact")}
                      onChange={set("employment_impact")}
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
                    <TextAreaField
                      label="Vision"
                      max={1000}
                      value={text("vision")}
                      onChange={set("vision")}
                    />
                    <TextAreaField
                      label="Mission"
                      max={1000}
                      value={text("mission")}
                      onChange={set("mission")}
                    />
                    <TextAreaField
                      label="Goals"
                      max={1000}
                      value={text("goals")}
                      onChange={set("goals")}
                    />
                  </QuestionGroup>

                  <QuestionGroup
                    n={5}
                    title="Registration and sector"
                    hint={
                      stage === "Existing"
                        ? "Verified against the business registry."
                        : "Trading name and sector."
                    }
                    answered={identityAnswered}
                    total={identityTotal}
                    open={openGroup === 5}
                    onToggle={() => toggleGroup(5)}
                  >
                    {stage === "Existing" && (
                      <>
                        {looking && (
                          <p className="text-sm text-slate-500">
                            Retrieving business registrations…
                          </p>
                        )}

                        {manualEntry && (
                          <div onBlur={() => void checkTypedDcra()}>
                            <TextField
                              label="Business registration number"
                              required
                              value={dcra}
                              onChange={onDcraChange}
                              placeholder="BN-2024-004512"
                            />
                          </div>
                        )}
                        {dcraChecking && (
                          <p className="text-sm text-slate-500">
                            Checking the business registry…
                          </p>
                        )}

                        {dcraRecord?.business_name && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <p className="font-bold text-slate-900">
                                  {dcraRecord.business_name}
                                </p>
                                <p className="font-mono text-xs text-slate-500">
                                  {dcraRecord.registration_number}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                  dcraRecord.status === "Active"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700"
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
                                    STRUCTURE_LABEL[
                                      deriveStructure(dcraRecord)
                                    ] ?? dcraRecord.business_type
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
                                  value={dcraRecord.proprietors.join(", ")}
                                  source={dcraSourceLabel}
                                />
                              ) : null}
                            </div>
                            {dcraRecord.status &&
                              dcraRecord.status !== "Active" && (
                                <div className="mt-2">
                                  <Notice tone="warn">
                                    Registration inactive. Reinstatement may be
                                    required before disbursement.
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

                    {stage === "New" && (
                      <>
                        <TextField
                          label="Proposed trading name"
                          required
                          value={businessName}
                          onChange={setBusinessName}
                        />
                        <Notice tone="info">
                          Business registration is required before disbursement.
                        </Notice>
                      </>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField
                        label="Sector"
                        required
                        value={text("sector")}
                        onChange={set("sector")}
                        options={SECTORS}
                        placeholder="Select sector…"
                      />
                      <TextField
                        label="Sub-sector"
                        value={text("sub_sector")}
                        onChange={set("sub_sector")}
                        placeholder="e.g. Poultry"
                      />
                    </div>
                  </QuestionGroup>
                </div>
              )}

              {/* ----------------------------------------------- STEP: OPERATIONS */}
              {step === "operations" && (
                <Section letter="E" title="Operating information">
                  <SelectField
                    label="Operating region"
                    value={val("operating_location")}
                    onChange={set("operating_location")}
                    options={REGIONS}
                  />
                  <TextAreaField
                    label="Production process"
                    value={val("production_process")}
                    onChange={set("production_process")}
                  />
                  <TextAreaField
                    label="Equipment and fixed assets"
                    value={val("equipment_required")}
                    onChange={set("equipment_required")}
                  />
                  <TextAreaField
                    label="Key suppliers"
                    value={val("suppliers")}
                    onChange={set("suppliers")}
                  />
                  <TextAreaField
                    label="Licences and permits"
                    value={val("permits_required")}
                    onChange={set("permits_required")}
                  />
                </Section>
              )}

              {/* ------------------------------------------------- STEP: FINANCES */}
              {step === "finances" && stage === "Existing" && (
                <Section
                  letter="G"
                  title="Financial position"
                  blurb="Last financial year. Financial statements take precedence over declared figures."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MoneyField
                      label="Annual revenue"
                      value={val("annual_revenue")}
                      onChange={set("annual_revenue")}
                    />
                    <MoneyField
                      label="Cost of sales"
                      value={val("cost_of_sales")}
                      onChange={set("cost_of_sales")}
                    />
                    <MoneyField
                      label="Operating expenses"
                      value={val("operating_expenses")}
                      onChange={set("operating_expenses")}
                    />
                    <MoneyField
                      label="Annual debt service"
                      value={val("existing_obligations")}
                      onChange={set("existing_obligations")}
                    />
                    <MoneyField
                      label="Cash and bank balances"
                      value={val("cash_position")}
                      onChange={set("cash_position")}
                    />
                  </div>
                </Section>
              )}

              {step === "finances" && stage === "New" && (
                <Section
                  letter="H"
                  title="Financial projections"
                  blurb="First year of trading."
                >
                  <TextAreaField
                    label="Projected sales volume"
                    value={val("expected_sales_volume")}
                    onChange={set("expected_sales_volume")}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MoneyField
                      label="Projected annual revenue"
                      tag="Forecast"
                      value={val("projected_revenue")}
                      onChange={set("projected_revenue")}
                    />
                    <MoneyField
                      label="Projected annual costs"
                      tag="Forecast"
                      value={val("projected_costs")}
                      onChange={set("projected_costs")}
                    />
                    <MoneyField
                      label="Start-up costs"
                      tag="Forecast"
                      value={val("initial_costs")}
                      onChange={set("initial_costs")}
                    />
                    <MoneyField
                      label="Projected monthly cash flow"
                      tag="Forecast"
                      value={val("expected_cash_position")}
                      onChange={set("expected_cash_position")}
                    />
                  </div>
                  <TextAreaField
                    label="Key assumptions"
                    value={val("assumptions")}
                    onChange={set("assumptions")}
                    placeholder="Prices, volumes, demand, supply"
                  />
                </Section>
              )}

              {step === "finances" && stage && (
                <Section
                  letter="F"
                  title="Financial statements"
                  blurb={
                    draft
                      ? "Optional at submission, but GDB decides faster with them. PDF, up to 10 MB each."
                      : "Optional at submission. Files you add now upload when you save Funding."
                  }
                >
                  <ApplicationDocuments
                    application={draft?.name ?? null}
                    rows={FINANCIAL_DOCS(stage)}
                    onChange={setMissing}
                    queued={queued}
                    onQueue={setQueued}
                  />
                </Section>
              )}

              {step === "finances" && !stage && (
                <Notice tone="warn">Select the application type first.</Notice>
              )}

              {/* -------------------------------------------------- STEP: FUNDING */}
              {step === "funding" && (
                <>
                  <Section
                    letter="I"
                    title="Facility request"
                    blurb="Interest-free. Principal repayment only."
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <MoneyField
                        label="Loan amount"
                        required
                        value={amount}
                        onChange={setAmount}
                        hint={
                          ceiling ? (
                            ceiling && Number(amount) > ceiling ? (
                              <span className="font-semibold text-rose-600">
                                Up to {formatGyd(ceiling)} — reduce the amount
                                to continue.
                              </span>
                            ) : (
                              `Up to ${formatGyd(ceiling)}. GDB decides the approved amount.`
                            )
                          ) : undefined
                        }
                      />
                    </div>
                    {/* Closed answers, the programme's own: a term and when
                    repayments begin. Both are checked again by the server. */}
                    <div className="grid gap-4 lg:grid-cols-2">
                      <ChipGroup
                        label="Repayment term"
                        hint="How long you will take to repay."
                        options={termOptions.map((t) => [t, `${t} months`])}
                        value={Number(term)}
                        onChange={(v) => setTerm(String(v))}
                      />
                      <ChipGroup
                        label="Moratorium"
                        hint="Months after the funds are released before your first instalment."
                        options={moratoriumOptions.map((m) => [
                          m,
                          moratoriumChoice(m),
                        ])}
                        value={moratorium}
                        onChange={(v) => set("moratorium_months")(String(v))}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
                      <span className="font-bold text-emerald-900">
                        {firstRepaymentLine(moratorium)}
                      </span>
                      {smeRate === 0 &&
                        Number(amount) > 0 &&
                        Number(term) > 0 && (
                          <span className="text-emerald-800">
                            About{" "}
                            <b>
                              {formatGyd(
                                Math.ceil(Number(amount) / Number(term)),
                              )}
                            </b>{" "}
                            a month for {term} months, interest-free.
                          </span>
                        )}
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
                            key: "item",
                            header: "Item",
                            cell: (row, i) => (
                              <input
                                value={row.item}
                                onChange={(e) =>
                                  setUseOfFunds((rows) =>
                                    rows.map((r, j) =>
                                      j === i
                                        ? { ...r, item: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                                aria-label={`Use of funds line ${i + 1}, item`}
                                placeholder="e.g. Chest freezer"
                                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm focus:border-brand focus:bg-white focus:outline-none"
                              />
                            ),
                          },
                          {
                            key: "amount",
                            header: "Amount",
                            align: "right",
                            cell: (row, i) => (
                              <input
                                type="number"
                                min={0}
                                value={row.amount || ""}
                                onChange={(e) =>
                                  setUseOfFunds((rows) =>
                                    rows.map((r, j) =>
                                      j === i
                                        ? {
                                            ...r,
                                            amount: Number(e.target.value) || 0,
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                aria-label={`Use of funds line ${i + 1}, amount in Guyanese dollars`}
                                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-right text-sm tabular-nums focus:border-brand focus:bg-white focus:outline-none"
                              />
                            ),
                          },
                          {
                            key: "remove",
                            header: "",
                            align: "right",
                            stackLabel: "",
                            className: "w-8",
                            cell: (_, i) =>
                              useOfFunds.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setUseOfFunds((rows) =>
                                      rows.filter((_, j) => j !== i),
                                    )
                                  }
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
                          item: "Total",
                          amount: formatGyd(
                            useOfFunds.reduce(
                              (sum, r) => sum + (r.amount || 0),
                              0,
                            ),
                          ),
                        }}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setUseOfFunds((rows) => [
                            ...rows,
                            { item: "", amount: 0 },
                          ])
                        }
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
                      <p className="text-sm text-slate-500">
                        Retrieving your accounts…
                      </p>
                    )}

                    {!manualAccount && (myAccounts?.length ?? 0) > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-slate-700">
                          {myAccounts?.length === 1
                            ? "Account held in your name."
                            : "Select the disbursement account."}
                        </p>
                        {myAccounts?.map((a) => {
                          const payable = a.status === "Active";
                          return (
                            <ChoiceCard
                              key={`${a.bank}-${a.account_number}`}
                              title={a.bank}
                              body={`••••${a.account_number.slice(-4)}${a.account_type ? ` · ${a.account_type}` : ""} · ${a.account_name ?? ""}`}
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
                          {myAccounts?.[0]?.source === "bank_registry"
                            ? "From your bank. Re-verified before disbursement."
                            : "Re-verified with your bank before disbursement."}
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
                              setAccountNo(v.replace(/\D/g, ""));
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

                        {checking && (
                          <p className="text-xs text-slate-500">
                            Verifying with the bank…
                          </p>
                        )}

                        {/* Three outcomes, never two. "We could not check" is said
                        out loud rather than shown as a pass — and none of them
                        stops the application. */}
                        {accountCheck && !checking && (
                          <Notice
                            tone={
                              accountCheck.result === "Verified"
                                ? "good"
                                : "warn"
                            }
                          >
                            {accountCheck.result === "Verified" &&
                              `Verified — ${accountCheck.account_name}.`}
                            {accountCheck.result === "Name Mismatch" &&
                              "Account name does not match. GDB verifies before disbursement."}
                            {accountCheck.result === "Inactive Account" &&
                              `Account ${accountCheck.status?.toLowerCase()}. Nominate another account.`}
                            {accountCheck.result === "Not Found" &&
                              "Account not found. Check the number."}
                            {accountCheck.result === "Unavailable" &&
                              "Bank unavailable. GDB verifies before disbursement."}
                          </Notice>
                        )}

                        {accountNote && (
                          <Notice tone="warn">{accountNote}</Notice>
                        )}

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
              {step === "evidence" && (
                <div className="space-y-5">
                  <header className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-dark text-base font-black text-amber-300 ring-4 ring-emerald-50">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-black leading-tight tracking-tight text-slate-900">
                        Review your application
                      </h2>
                      <p className="mt-0.5 text-[13px] text-slate-500">
                        Check each section, then submit. Nothing is sent to GDB
                        until you do.
                      </p>
                    </div>
                  </header>

                  <AttentionList
                    issues={issues}
                    blocking={fieldIssues.length > 0}
                  />
                  <ReviewSections
                    sections={reviewSections}
                    onEdit={(id) => goTo(id as StepId)}
                  />

                  {draft && (
                    <div className="rounded-lg bg-brand-light/40 p-4">
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Anything else to add?{" "}
                        <span className="font-normal text-slate-500">
                          (optional)
                        </span>
                      </p>
                      <ApplicationDocuments
                        application={draft.name}
                        rows={[OTHER_DOC]}
                        onChange={setMissing}
                      />
                    </div>
                  )}

                  {!assist && (
                    <section
                      aria-label="Declarations"
                      className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-4"
                    >
                      <p className="text-sm font-bold text-slate-900">
                        Consent
                      </p>
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={declConsent}
                          onChange={(e) => setDeclConsent(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                        />
                        <span className="text-sm text-slate-700">
                          {CONSENT_TEXT}
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={declWarning}
                          onChange={(e) => setDeclWarning(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                        />
                        <span className="text-sm text-slate-700">
                          {FALSE_INFORMATION_WARNING}
                        </span>
                      </label>
                    </section>
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
                        disabled={
                          busy ||
                          fieldIssues.length > 0 ||
                          (!assist && !(declConsent && declWarning))
                        }
                        onClick={() =>
                          void (assist ? finishAssisted(true) : onFinalSubmit())
                        }
                        className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
                      >
                        {busy
                          ? "Submitting…"
                          : assist
                            ? "Submit for applicant"
                            : "Submit application"}
                      </button>
                    </div>
                  </div>
                  <p className="text-right text-xs text-slate-400">
                    {assist
                      ? "The applicant is told it was submitted for them."
                      : declConsent && declWarning
                        ? "You cannot edit the application after you submit it."
                        : "Tick both statements above to submit."}
                  </p>
                </div>
              )}
            </Card>

            {/* Sticky actions: one blocker, one primary next action. */}
            {!isLast && tab === "application" && (
              <div className="mt-4">
                <Footer>
                  <QButton
                    kind="secondary"
                    back
                    onClick={goBack}
                    disabled={index === 0}
                  >
                    Back
                  </QButton>
                  <span className="hidden text-xs font-medium text-slate-400 sm:block">
                    Step {index + 1} of {steps.length}
                  </span>
                  <QButton next onClick={() => void goNext()} disabled={busy}>
                    {busy ? "Saving…" : "Save and continue"}
                  </QButton>
                </Footer>
              </div>
            )}
          </div>
        </div>

        <aside
          className="space-y-4 scrollbar-none lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
          aria-label="Your SME loan"
        >
          <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#022c19] via-brand-dark to-brand text-white shadow-lg shadow-emerald-950/20">
            <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative px-5 pt-4 pb-3">
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-300">
                Your SME loan
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight">
                {amountValue > 0
                  ? formatGyd(amountValue)
                  : "Amount not set yet"}
              </p>
              <p className="mt-0.5 text-xs text-emerald-100">
                {ceiling ? `Up to ${formatGyd(ceiling)} · ` : ""}GDB decides the
                approved amount
              </p>
            </div>
            <dl className="relative grid grid-cols-2 border-t border-white/10 bg-black/20 text-sm">
              <div className="border-r border-white/10 px-5 py-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/90">
                  Term
                </dt>
                <dd className="font-black">{term ? `${term} months` : "—"}</dd>
              </div>
              <div className="px-5 py-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/90">
                  First instalment
                </dt>
                <dd className="truncate font-black">
                  {moratorium ? `${moratorium + 1} months after release` : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-extrabold text-slate-900">
                Your progress
              </p>
              <span className="text-xs font-bold text-slate-500">
                {doneCount} of {formSteps.length}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-amber-400 transition-all"
                style={{ width: `${(doneCount / formSteps.length) * 100}%` }}
              />
            </div>
            <ul className="mt-3 space-y-1">
              {formSteps.map((s, i) => {
                const open = i <= reached;
                const short = open && issuesIn(s.id) > 0 && i < reached;
                const done = open && i < reached && !short;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!open}
                      onClick={() => {
                        setTab("application");
                        void jumpTo(i);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] transition-colors disabled:cursor-default ${
                        i === index && tab === "application"
                          ? "bg-emerald-50 font-bold text-brand-dark"
                          : "text-slate-600 enabled:hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`grid h-4 w-4 flex-none place-items-center rounded-full text-[9px] font-black ${
                          done
                            ? "bg-brand text-white"
                            : short
                              ? "bg-amber-100 text-amber-700"
                              : "border border-slate-300 text-slate-400"
                        }`}
                      >
                        {done ? "✓" : short ? "!" : ""}
                      </span>
                      <span className="flex-1 truncate">{s.title}</span>
                      {short && (
                        <span className="text-[11px] font-semibold text-amber-700">
                          {issuesIn(s.id)} to do
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
            <p className="text-sm font-extrabold text-slate-900">
              Have these to hand
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              {[
                "Your business registration number, if the business has one",
                "Recent sales, costs and cash-flow figures",
                "How you will use the funds, item by item",
                "The bank account the loan should be paid into",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11px] text-slate-500">
              Each step is saved when you continue, so you can leave and come
              back.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** One closed answer as a row of chips — a term, a moratorium. */
function ChipGroup({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: [number, string][];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-bold text-slate-800">
        {label}
        <span className="ml-0.5 text-rose-500">*</span>
      </legend>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={label}
      >
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`rounded-xl border-2 px-3.5 py-2 text-sm font-bold transition-all ${
              value === v
                ? "border-brand bg-brand text-white shadow-sm shadow-brand/30"
                : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </fieldset>
  );
}
