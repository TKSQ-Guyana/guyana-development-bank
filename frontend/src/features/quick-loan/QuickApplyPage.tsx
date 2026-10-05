import { DateInput } from "../../components/DateInput";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EID_FORMAT_HINT,
  EMPLOYER_CATEGORIES,
  INCOME_BANDS,
  subSectorLabel,
  typedEid,
  useIndustries,
} from "../../shared/declarations";
import { firstRepaymentLine, moratoriumChoice } from "../../shared/moratorium";
import { useNavigate, useParams } from "react-router-dom";
import { useOneAtATime } from "../../components/apply/OneAtATime";
import { call } from "../../api";
import { useAuth } from "../../auth";
import { DocumentShelf, docLabel } from "../../components/DocumentShelf";
import { FacilitatedBanks } from "../../components/apply/FacilitatedBanks";
import { REGIONS } from "../../components/apply/cluster";
import { LocationPicker } from "../../components/LocationPicker";
import { formatPhone, PhoneInput } from "../../components/PhoneInput";
import { formatDate } from "../../utils";
import {
  PayoutAccount,
  useAccountOnFile,
} from "../../components/apply/PayoutAccount";
import {
  ApplicationsIcon,
  BankIcon,
  CheckIcon,
  PaymentsIcon,
  PulseIcon,
  UsersIcon,
} from "../../components/ui/icons";
import { FieldOfficerRequest } from "./FieldOfficerRequest";
import { SubmittedScreen } from "../applications/SubmittedScreen";
import { CONSENT_TEXT } from "../../shared/consent";
import type {
  BankAccountRecord,
  CitizenProfile,
  LoanApplication,
} from "../../types";
import {
  ACCOUNT_TYPES,
  blockerFor,
  confirmErrors,
  EMPTY_ANSWERS,
  fromDraft,
  gyd,
  needsOfficerReview,
  QUICK_STEPS,
  RAIL_STEPS,
  termList,
  toSavePayload,
  hasSubSectors,
  type QuickAnswers,
  type QuickLoanTerms,
  type QuickStepId,
  type SupportContact,
  YES_NO,
} from "./model/quickLoan";
import {
  Banner,
  Bar,
  Card,
  Check,
  Chips,
  Footer,
  Hero,
  inputClass,
  LinkButton,
  Panel,
  Pill,
  QButton,
  QField,
  QSelect,
  QTextArea,
  RadioCard,
  SecHead,
  SectionTitle,
  Spinner,
  StepRail,
  Tabs,
  type StepState,
} from "../../components/portal/ui";

/** The Quick Loan application — an informal trader's own short form.
 *
 *  Deliberately NOT a branch of the SME wizard: no TIN, no DCRA, no accounts, no
 *  business plan. Who they are, what they do and where, how much and what
 *  for, and where to pay them. No identity document and no photos are asked for. The rules live in
 *  model/quickLoan.ts; the enforcement lives on the server. The screens follow
 *  the approved prototype (gdb-quick-loan-flow), drawn from ./ui.
 *
 *  Nothing is kept on the device. Until the loan step there is nothing the
 *  server will hold as a draft, and after it every step is saved to GDB — the
 *  applicant's answers never sit in browser storage.
 */

/** Where each document type is filed, for the Documents tab. */
const DOC_SLOTS: [
  type: string,
  title: string,
  help: string,
  step: QuickStepId,
][] = [["Payslip", "Payslip", "Optional. Added in About you.", "about"]];

const clock = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const regionShort = (r: string) => r.split(" — ")[0];

/** The steps whose answers every draft save carries and the server checks. */
const DRAFT_STEPS: QuickStepId[] = ["about", "business", "loan"];

/** Who the Quick Loan is for — the eligibility screen's list, as chips. */
const FOR_WHOM = [
  "Market vendors",
  "Repairs, hair & tailoring",
  "Home-based & mobile",
  "Other small businesses",
];

/** Each step's icon, on its heading and on its Review card. */
const STEP_ICON: Partial<Record<QuickStepId, ReactNode>> = {
  about: <UsersIcon />,
  business: <PulseIcon />,
  loan: <PaymentsIcon />,
  bank: <BankIcon />,
  review: <ApplicationsIcon />,
};

export function QuickApplyPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { name: routeName } = useParams<{ name: string }>();
  // One Quick Loan at a time — told before the form, not at the first save.
  const blocked = useOneAtATime("quick", !routeName);

  const [terms, setTerms] = useState<QuickLoanTerms | null>(null);
  const [answers, setAnswers] = useState<QuickAnswers>(EMPTY_ANSWERS);
  // GDB's industries, for the business step's Industry and Sub Sector.
  const industries = useIndustries();
  // A bank account already on file: "I don't have a bank account" is not asked.
  const accountOnFile = useAccountOnFile();
  useEffect(() => {
    if (accountOnFile)
      setAnswers((a) => (a.noBankAccount ? { ...a, noBankAccount: false } : a));
  }, [accountOnFile]);
  const [branchCode, setBranchCode] = useState("");
  const [step, setStep] = useState<QuickStepId>("eligibility");
  const [tab, setTab] = useState<"app" | "docs">("app");
  const [draft, setDraft] = useState<LoanApplication | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<LoanApplication | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState<string | null>(null);
  // "I need help from a field officer" — the request form instead of the steps.
  const [helping, setHelping] = useState(false);
  const [confirmTried, setConfirmTried] = useState(false);
  // The draft this page already holds — so the URL moving from /apply/quick to
  // /apply/quick/<name> on the first save is not read as "open another draft".
  const loaded = useRef<string | null>(null);
  // A draft just opened from its link, still to be routed to the first step
  // it is missing an answer on (see the effect below `furthest`).
  const resumed = useRef(false);
  // Shown once on a reopened draft that is missing a newer question.
  const [notice, setNotice] = useState<string | null>(null);

  const set =
    <K extends keyof QuickAnswers>(key: K) =>
    (value: QuickAnswers[K]) => {
      // An answer being changed is the applicant acting on the message.
      setError(null);
      setAnswers((a) => ({ ...a, [key]: value }));
    };

  useEffect(() => {
    call<QuickLoanTerms>("gdb_bank.api.quick_loan_terms")
      .then(setTerms)
      .catch((err: Error) => setError(err.message));
    call<CitizenProfile>("gdb_bank.profiles.my_profile")
      .then((p) => {
        setProfile(p);
        setAnswers((a) => ({
          ...a,
          phone: a.phone || p.phone || p.verified_phone || "",
          dob: a.dob || p.date_of_birth || p.verified_birth_date || "",
          // The region on record (from the KYC register at sign-up); still
          // theirs to change if they trade elsewhere.
          region:
            a.region ||
            (p.region && REGIONS.includes(p.region) ? p.region : ""),
          holder: a.holder || user?.full_name || "",
          // An account opened by e-ID already knows it; still theirs to type.
          eid: a.eid || user?.eid || "",
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!routeName || loaded.current === routeName) return;
    loaded.current = routeName;
    setBusy(true);
    call<LoanApplication>("gdb_bank.api.loan_detail", { name: routeName })
      .then((loan) => {
        if (loan.status !== "Draft") {
          navigate(`/loans/${loan.name}`, { replace: true });
          return;
        }
        if (loan.product !== "quick") {
          navigate(`/apply/${loan.name}`, { replace: true });
          return;
        }
        setDraft(loan);
        setAnswers((a) => {
          const saved = fromDraft(loan);
          return { ...a, ...saved, eid: saved.eid || a.eid };
        });
        setStep("bank");
        resumed.current = true;
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }, [routeName, navigate]);

  // What is still not on file, for Review's "Not on file yet" note.
  const refreshShelf = (application: string) =>
    call<{ missing: string[] }>("gdb_bank.documents.list_documents", {
      application,
    }).then((shelf) => setMissing(shelf.missing));
  useEffect(() => {
    if (!draft?.name) return;
    refreshShelf(draft.name).catch((err: Error) => setError(err.message));
  }, [draft?.name, step, tab]);

  // A date of birth the account does not hold is asked in Your details.
  const dobOnFile = Boolean(
    profile?.date_of_birth || profile?.verified_birth_date,
  );

  const index = QUICK_STEPS.findIndex((s) => s.id === step);
  const current = QUICK_STEPS[index];
  // How far the applicant has got. Going back to change an answer must not
  // cost the way forward again, so the rail stays open up to here.
  const [furthest, setFurthest] = useState(0);
  useEffect(() => {
    setFurthest((f) => Math.max(f, index));
  }, [index]);

  /** The first step before `upTo` whose answers the draft save needs and does
   *  not have. Business and Loan details are the two the server checks on
   *  every save, so a draft missing one of them can never be saved from a
   *  later step — the applicant has to be taken back to it. */
  const gapBefore = (upTo: QuickStepId): QuickStepId | null => {
    if (!terms) return null;
    const limit = QUICK_STEPS.findIndex((s) => s.id === upTo);
    return (
      DRAFT_STEPS.find(
        (id) =>
          QUICK_STEPS.findIndex((s) => s.id === id) < limit &&
          blockerFor(id, answers, terms),
      ) ?? null
    );
  };

  // A reopened draft starts at Bank information — unless something it was
  // saved without is now asked for (a question added since), in which case it
  // starts there.
  useEffect(() => {
    if (!resumed.current || !terms || !draft) return;
    resumed.current = false;
    setFurthest(QUICK_STEPS.findIndex((s) => s.id === "bank"));
    const gap = gapBefore("bank");
    if (gap) {
      setStep(gap);
      setNotice(
        "We have added a few questions since you saved this draft. Answer them below to carry on.",
      );
    }
  }, [terms, draft, answers]);

  const saveDraft = async (): Promise<LoanApplication> => {
    const saved = await call<LoanApplication>(
      "gdb_bank.api.save_application",
      toSavePayload(answers, draft?.name),
    );
    setDraft(saved);
    setSavedAt(new Date());
    loaded.current = saved.name;
    if (routeName !== saved.name)
      navigate(`/apply/quick/${saved.name}`, { replace: true });
    return saved;
  };

  const setContact =
    (i: 0 | 1, key: keyof SupportContact) => (value: string) => {
      setError(null);
      setAnswers((a) => {
        const contacts = [...a.contacts] as QuickAnswers["contacts"];
        contacts[i] = { ...contacts[i], [key]: value };
        return { ...a, contacts };
      });
    };

  // The account type already on file, for an applicant coming back to Bank.
  useEffect(() => {
    if (step !== "bank" || answers.accountType) return;
    call<BankAccountRecord & { account_type?: string | null }>(
      "gdb_bank.api.my_bank_details",
    )
      .then((saved) => {
        const t = saved?.account_type;
        if (t === "Checking" || t === "Savings")
          setAnswers((a) => (a.accountType ? a : { ...a, accountType: t }));
      })
      .catch(() => {});
  }, [step]);

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goTo = (id: QuickStepId) => {
    setError(null);
    setNotice(null);
    setTab("app");
    setStep(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Leave the step on screen: its check, then whatever it saves. True when
   *  the step may be left. Shared by Continue and by the rail. */
  const leave = async (): Promise<boolean> => {
    if (!terms) return false;
    const blocker = blockerFor(step, answers, terms);
    if (blocker) {
      setError(blocker);
      return false;
    }
    // Bank saves the draft, and the server refuses a draft missing an earlier
    // step's answers — say so where those answers are, not here.
    const gap = step === "bank" ? gapBefore("bank") : null;
    if (gap) {
      goTo(gap);
      setError(blockerFor(gap, answers, terms));
      return false;
    }
    if (step === "eligibility" && answers.how === "help") {
      setError(null);
      setHelping(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return false;
    }
    // A date of birth asked here is the person's, so it goes on the profile.
    if (
      step === "about" &&
      !dobOnFile &&
      !(await run(async () => {
        setProfile(
          await call<CitizenProfile>("gdb_bank.profiles.save_profile", {
            date_of_birth: answers.dob,
          }),
        );
      }))
    )
      return false;
    // The loan step is the first the server will hold as a draft; from here
    // on, moving forward saves to GDB.
    if (
      step === "loan" &&
      !(await run(async () => {
        const saved = await saveDraft();
        await refreshShelf(saved.name);
      }))
    )
      return false;
    if (step === "bank") {
      const saved = await run(async () => {
        // No account yet: nothing to nominate — the draft records the answer.
        if (!answers.noBankAccount)
          await call("gdb_bank.api.save_bank_details", {
            bank: answers.bank,
            bank_account_no: answers.accountNo,
            branch_code: branchCode,
            branch: answers.manualAccount ? answers.branch : undefined,
            account_name: answers.holder,
            account_type: answers.accountType,
          });
        await saveDraft();
      });
      if (!saved) return false;
    }
    return true;
  };

  const goNext = async () => {
    if (await leave())
      goTo(QUICK_STEPS[Math.min(index + 1, QUICK_STEPS.length - 1)].id);
  };

  /** Rail navigation. Back is free. Forward goes as far as the applicant has
   *  already been, and stops at the first step in between that is no longer
   *  complete. */
  const jumpTo = async (i: number) => {
    if (i === index || i > furthest || busy || !terms) return;
    if (i < index) {
      goTo(QUICK_STEPS[i].id);
      return;
    }
    if (!(await leave())) return;
    const stuck = QUICK_STEPS.slice(index + 1, i).find((s) =>
      blockerFor(s.id, answers, terms),
    );
    goTo((stuck ?? QUICK_STEPS[i]).id);
    if (stuck) setError(blockerFor(stuck.id, answers, terms));
  };

  const submit = async () => {
    setConfirmTried(true);
    if (Object.keys(confirmErrors(answers)).length) return;
    const gap =
      gapBefore("review") ??
      (terms && blockerFor("bank", answers, terms) ? "bank" : null);
    if (gap && terms) {
      goTo(gap);
      setError(blockerFor(gap, answers, terms));
      return;
    }
    setSubmitting(true);
    setSubmitFailed(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      // The first statement IS the consent the profile records.
      await call("gdb_bank.profiles.record_consent");
      const saved = await saveDraft();
      setSubmitted(
        await call<LoanApplication>("gdb_bank.api.submit_application", {
          name: saved.name,
          accept_terms: 1,
          credit_check_consent: 1,
        }),
      );
      setSubmittedAt(new Date());
    } catch (err) {
      setSubmitFailed(
        err instanceof Error
          ? err.message
          : "The submission did not go through.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const screen = (): ReactNode => {
    if (!terms) {
      return error ? (
        <Banner kind="error" title={error} />
      ) : (
        <p className="text-ql-muted">Loading…</p>
      );
    }
    const amount = gyd(Number(answers.amount));
    const months = `${answers.term} month${answers.term === "1" ? "" : "s"}`;

    if (submitted) {
      return (
        <SubmittedScreen
          reference={submitted.name}
          product="Quick Loan"
          detail={`${amount} · ${months}`}
          submittedAt={submittedAt}
          onView={() => navigate(`/loans/${submitted.name}`)}
          onApplications={() => navigate("/apply")}
        />
      );
    }

    if (submitting) {
      return (
        <Panel>
          <div className="flex items-center gap-4">
            <Spinner />
            <div>
              <h2 className="text-[23px] font-semibold leading-tight">
                Submitting your application
              </h2>
              <p className="text-ql-ink2">Sending your application to GDB</p>
            </div>
          </div>
          <p className="text-[13px] text-ql-ink2">
            Please wait for confirmation before trying again. No approval or
            lending decision has been made.
          </p>
          <Card tone="soft">
            <b className="font-semibold">Submission in progress</b>
            <div className="text-[13px] text-ql-ink2">
              Quick Loan · {amount}. Your saved information and attached
              documents are being submitted together.
            </div>
          </Card>
          <div>
            <QButton disabled>Submitting…</QButton>
          </div>
        </Panel>
      );
    }

    if (submitFailed) {
      return (
        <Panel>
          <Hero kind="err" title="We could not submit your application">
            Your draft and documents are saved. Check your connection and try
            again.
          </Hero>
          <Card tone="soft">
            <b className="font-semibold">Your application is still a draft</b>
            <div className="text-[13px] text-ql-ink2">
              You can submit again. Trying again never creates a second
              application.
              <br />
              <span className="text-ql-muted">{submitFailed}</span>
            </div>
          </Card>
          <Footer>
            <QButton
              kind="secondary"
              onClick={() => {
                setSubmitFailed(null);
              }}
            >
              Back to review
            </QButton>
            <QButton onClick={() => void submit()}>Try again</QButton>
          </Footer>
        </Panel>
      );
    }

    if (helping) {
      return (
        <FieldOfficerRequest
          defaultName={user?.full_name ?? ""}
          defaultPhone={answers.phone}
          onBack={() => setHelping(false)}
          onApplySelf={() => {
            set("how")("self");
            setHelping(false);
          }}
        />
      );
    }

    if (step === "eligibility") {
      return (
        <div className="flex flex-col gap-4">
          <section className="relative overflow-hidden rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-[#071a3d] via-brand-dark to-brand p-5 text-white shadow-xl shadow-emerald-950/20 sm:px-7 sm:py-6">
            <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-70" />
            <div className="pointer-events-none absolute -right-10 -bottom-10 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-black/30 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                  Quick Loan
                </span>
                <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
                  Before you start
                </h1>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-emerald-100">
                  A short application for small businesses. No business
                  registration needed.
                </p>
                <ul
                  className="mt-3 flex flex-wrap gap-1.5"
                  aria-label="Who it is for"
                >
                  {FOR_WHOM.map((x) => (
                    <li
                      key={x}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white"
                    >
                      <CheckIcon className="h-3.5 w-3.5 text-amber-300" />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
              <dl className="grid grid-cols-3 gap-4 rounded-xl bg-black/20 px-4 py-3 backdrop-blur-xs lg:min-w-[380px]">
                {[
                  ["Loan up to", gyd(terms.ceiling), true],
                  ["Interest", `${terms.rate_of_interest}%`, false],
                  ["Collateral", "None", false],
                ].map(([k, v, gold]) => (
                  <div
                    key={String(k)}
                    className={`border-l-2 pl-3 ${gold ? "border-amber-400/80" : "border-emerald-400/80"}`}
                  >
                    <dt
                      className={`text-[10px] font-bold uppercase tracking-wider ${gold ? "text-amber-300/90" : "text-emerald-200/90"}`}
                    >
                      {k}
                    </dt>
                    <dd
                      className={`mt-0.5 text-base font-black tracking-tight sm:text-lg ${gold ? "text-amber-300" : "text-white"}`}
                    >
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <Panel>
            <div>
              <SectionTitle>How would you like to apply?</SectionTitle>
              <p className="mt-1 text-sm text-slate-500">
                Either way, applying is free and a person at GDB makes every
                decision.
              </p>
            </div>
            {error && <Banner kind="error" title={error} />}
            <div className="grid gap-4 md:grid-cols-2">
              <RadioCard
                icon={<ApplicationsIcon className="h-6 w-6" />}
                title="I will apply myself"
                badge={
                  <Pill tone="green">{RAIL_STEPS.length} short steps</Pill>
                }
                body="Fill in the application in this portal. Your answers save as you go."
                selected={answers.how === "self"}
                onSelect={() => set("how")("self")}
              />
              <RadioCard
                icon={<UsersIcon className="h-6 w-6" />}
                title="I need help from a field officer"
                body="A GDB field officer contacts you and completes the application with you."
                selected={answers.how === "help"}
                onSelect={() => set("how")("help")}
              />
            </div>
            <Footer>
              <span className="text-xs text-slate-500">
                {answers.how
                  ? "Ready when you are."
                  : "Choose how you would like to apply."}
              </span>
              <QButton
                disabled={!answers.how || busy}
                onClick={() => void goNext()}
                next
              >
                {busy
                  ? "Saving…"
                  : answers.how === "help"
                    ? "Continue to request help"
                    : "Start application"}
              </QButton>
            </Footer>
          </Panel>
        </div>
      );
    }

    // ---------- The rail and its sections ----------

    const stateOf = (id: string): StepState => {
      const i = QUICK_STEPS.findIndex((s) => s.id === id);
      if (id === step) return "cur";
      if (i > furthest || id === "review") return "";
      return blockerFor(id as QuickStepId, answers, terms) ? "attn" : "done";
    };
    const issues = RAIL_STEPS.filter((s) => s.id !== "review")
      .map((s) => ({ step: s, text: blockerFor(s.id, answers, terms) }))
      .filter((x): x is { step: (typeof RAIL_STEPS)[number]; text: string } =>
        Boolean(x.text),
      );
    const overCap = Number(answers.amount) > terms.ceiling;
    const reviewErrs = confirmTried ? confirmErrors(answers) : {};
    const railIndex = RAIL_STEPS.findIndex((s) => s.id === step) + 1;
    const sections = RAIL_STEPS.filter((s) => s.id !== "review");
    const doneCount = sections.filter((s) => stateOf(s.id) === "done").length;
    const amt = Number(answers.amount);
    const termN = Number(answers.term);
    // Zero interest makes the instalment plain division; at any other rate it
    // is lending's to compute, so the estimate is not shown.
    const monthly =
      amt > 0 && termN > 0 && terms.rate_of_interest === 0
        ? gyd(Math.ceil(amt / termN))
        : null;
    const saveState = savedAt ? (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Saved · {clock(savedAt)}
      </span>
    ) : draft ? (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Draft saved
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        Saving starts at Loan details
      </span>
    );

    const summary = (
      id: QuickStepId,
      title: string,
      body: ReactNode,
      pill?: ReactNode,
    ) => (
      <div
        key={id}
        className="flex flex-col rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-xs"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-brand-dark [&>svg]:h-4 [&>svg]:w-4">
              {STEP_ICON[id]}
            </span>
            <div>
              <b className="text-sm font-extrabold text-slate-900">{title}</b>
              <div className="mt-0.5">
                {pill ??
                  (blockerFor(id, answers, terms) ? (
                    <Pill tone="amber">1 item missing</Pill>
                  ) : (
                    <Pill tone="green">✓ Complete</Pill>
                  ))}
              </div>
            </div>
          </div>
          <LinkButton onClick={() => goTo(id)}>Edit</LinkButton>
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2 text-[12.5px] leading-relaxed text-slate-600">
          {body}
        </div>
      </div>
    );

    let body: ReactNode;
    if (tab === "docs") {
      body = (
        <>
          <SecHead
            title="Your documents"
            intro="Everything you have uploaded, linked to the section it belongs to. Replace a file here or in its section."
          />
          {error && <Banner kind="error" title={error} />}
          {draft ? (
            DOC_SLOTS.map(([type, title, help, slotStep]) => (
              <Card key={type}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <b className="font-semibold">{title}</b>
                    <div className="text-[13px] text-ql-muted">{help}</div>
                  </div>
                  <LinkButton onClick={() => goTo(slotStep)}>
                    Open section
                  </LinkButton>
                </div>
                <DocumentShelf
                  application={draft.name}
                  only={type}
                  title={title}
                />
              </Card>
            ))
          ) : (
            <Banner
              kind="info"
              title="Documents open once your loan details are saved."
            />
          )}
          <div>
            <QButton kind="secondary" onClick={() => setTab("app")}>
              Back to application
            </QButton>
          </div>
        </>
      );
    } else if (step === "review") {
      body = (
        <>
          <SecHead
            index={railIndex}
            title="Review your application"
            intro={
              issues.length
                ? "Review does not submit your application."
                : "Review all details before sending them to GDB."
            }
          />
          {error && <Banner kind="error" title={error} />}
          <div className="grid gap-3 lg:grid-cols-2">
            {issues.length ? (
              <>
                <Banner
                  kind="warn"
                  title={`${issues.length} item${issues.length > 1 ? "s need" : " needs"} your attention`}
                >
                  Resolve the items below before submitting. You can return to
                  any section.
                </Banner>
                <div className="overflow-hidden rounded-xl border border-slate-200 lg:col-span-2">
                  {issues.map(({ step: s, text }, i) => (
                    <div
                      key={s.id}
                      className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${i ? "border-t border-ql-line" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <b className="text-[13px] font-semibold">{text}</b>
                        <div className="text-xs text-ql-muted">
                          {s.title} · Required field missing
                        </div>
                      </div>
                      <LinkButton onClick={() => goTo(s.id)}>
                        Go to field
                      </LinkButton>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Banner kind="success" title="No outstanding items">
                The required sections are complete.
              </Banner>
            )}
            {missing.length > 0 && (
              <Banner
                kind="info"
                title={`Not on file yet: ${missing.map(docLabel).join(", ")}`}
              >
                You can still submit. GDB may ask you for them.
              </Banner>
            )}
          </div>
          <YourDetails user={user} profile={profile} dob={answers.dob} />
          <div className="grid gap-3 md:grid-cols-2">
            {summary(
              "about",
              "About you",
              <>
                E-ID:{" "}
                {answers.hasEid === "Yes"
                  ? answers.eid.trim() || "—"
                  : answers.hasEid === "No"
                    ? "None"
                    : "—"}
                <br />
                Employed: {answers.employed || "—"}
                {answers.employed === "Yes" && (
                  <>
                    {" "}
                    · {answers.employerCategory || "—"} ·{" "}
                    {answers.employerName || "—"}
                    <br />
                    Monthly income: {answers.incomeBand || "—"}
                    {needsOfficerReview(answers) && (
                      <span className="block font-semibold text-amber-700">
                        A Loan Officer will review your application.
                      </span>
                    )}
                  </>
                )}
              </>,
            )}
            {summary(
              "business",
              "Business description",
              <>
                {answers.businessName || "No business name"} ·{" "}
                {regionShort(answers.region) || "—"}
                <br />
                Industry: {answers.sector || "—"}
                {answers.subSector
                  ? ` · ${subSectorLabel(answers.subSector)}`
                  : ""}
                <br />
                {answers.tradeActivity || "—"}
                <br />
                In business: {answers.tradingSince || "—"} · Location:{" "}
                {answers.tradeLocation || "—"}
                <span className="block">
                  Pinned:{" "}
                  {answers.lat != null
                    ? answers.place ||
                      `${answers.lat.toFixed(4)}, ${answers.lng?.toFixed(4)}`
                    : "—"}
                </span>
                {answers.contacts.map((c, i) => (
                  <span key={i} className="block">
                    Contact {i + 1}: {c.name || "—"}
                    {c.relationship ? ` (${c.relationship})` : ""}
                    {c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                  </span>
                ))}
              </>,
            )}
            {summary(
              "loan",
              "Loan details",
              <>
                Loan amount {answers.amount ? amount : "—"} · {months}
                <br />
                Moratorium: {moratoriumChoice(Number(answers.moratorium))}
                <br />
                Purpose: {answers.purpose || "—"}
                <br />
                Lives in Guyana:{" "}
                {answers.residesInGuyana ? "Yes" : "Not confirmed"}
              </>,
            )}
            {summary(
              "bank",
              "Bank information",
              answers.noBankAccount ? (
                <>No bank account — please reach out to the Help Desk.</>
              ) : (
                <>
                  {answers.bank || "—"}
                  {answers.accountType ? ` · ${answers.accountType}` : ""}
                  {branchCode ? ` · ${branchCode}` : ""}
                  {answers.accountNo
                    ? ` · •••• ${answers.accountNo.replace(/\s/g, "").slice(-4)}`
                    : ""}
                  {answers.holder && (
                    <>
                      <br />
                      Account holder: {answers.holder}
                    </>
                  )}
                </>
              ),
            )}
          </div>
          <section
            aria-label="Declarations"
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
          >
            <SectionTitle>Consent</SectionTitle>
            <Check
              checked={answers.consentGiven}
              onChange={set("consentGiven")}
            >
              {CONSENT_TEXT}
            </Check>
            {reviewErrs.consentGiven && (
              <div className="text-[12.5px] font-semibold text-rose-600">
                {reviewErrs.consentGiven}
              </div>
            )}
            <p className="text-xs text-slate-500">
              You cannot edit the application after you submit it. Submitting is
              not approval — a person at GDB decides.
            </p>
          </section>
          <Footer>
            <QButton kind="secondary" back onClick={() => goTo("bank")}>
              Back
            </QButton>
            <QButton
              disabled={issues.length > 0 || !answers.consentGiven}
              next
              onClick={() => void submit()}
            >
              Submit application
            </QButton>
          </Footer>
        </>
      );
    } else {
      body = (
        <>
          <SecHead
            index={railIndex}
            title={current.title}
            intro={current.blurb}
          />
          {notice && !error && <Banner kind="info" title={notice} />}
          {error && <Banner kind="error" title={error} />}

          {step === "about" && (
            <>
              <YourDetails
                user={user}
                profile={profile}
                dob={answers.dob}
                askDob={!dobOnFile}
                onDob={set("dob")}
              />
              <QField label="Do you have an E-ID?" required>
                <Chips
                  label="Do you have an E-ID?"
                  options={[...YES_NO]}
                  value={answers.hasEid}
                  onChange={(v) => set("hasEid")(v as QuickAnswers["hasEid"])}
                />
              </QField>
              {answers.hasEid === "Yes" && (
                <QField
                  label="E-ID"
                  required
                  help={<span className="normal-case">{EID_FORMAT_HINT}</span>}
                >
                  <input
                    value={answers.eid}
                    onChange={(e) => set("eid")(typedEid(e.target.value))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="xxx-xxxx-xxxx"
                    maxLength={13}
                    className={`${inputClass()} font-mono normal-case tracking-wider sm:max-w-xs`}
                  />
                </QField>
              )}

              <QField label="Are you employed?" required>
                <Chips
                  label="Are you employed?"
                  options={[...YES_NO]}
                  value={answers.employed}
                  onChange={(v) =>
                    set("employed")(v as QuickAnswers["employed"])
                  }
                />
              </QField>
              {answers.employed === "Yes" && (
                <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <QField label="Employer Category" required>
                    <Chips
                      label="Employer Category"
                      options={[...EMPLOYER_CATEGORIES]}
                      value={answers.employerCategory}
                      onChange={(v) =>
                        set("employerCategory")(
                          v as QuickAnswers["employerCategory"],
                        )
                      }
                    />
                  </QField>
                  <QField label="Employer Name" required>
                    <input
                      value={answers.employerName}
                      onChange={(e) => set("employerName")(e.target.value)}
                      placeholder="Who you work for"
                      className={inputClass()}
                    />
                  </QField>
                  <QField label="Monthly Income" required>
                    <Chips
                      label="Monthly Income"
                      options={INCOME_BANDS.map((b) => b.value)}
                      value={answers.incomeBand}
                      onChange={set("incomeBand")}
                    />
                  </QField>
                  <QField
                    label="Please upload your payslip."
                    tag={<Pill tone="grey">Optional</Pill>}
                    help="Optional — you can continue without it. A PDF or a clear photo."
                  >
                    <DocumentShelf only="Payslip" title="Payslip" />
                  </QField>
                </div>
              )}
            </>
          )}

          {step === "business" && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <QField label="Industry" required>
                  <QSelect
                    value={answers.sector}
                    onChange={(v) =>
                      setAnswers((a) => ({ ...a, sector: v, subSector: "" }))
                    }
                    options={industries.map((i) => i.sector)}
                    placeholder="Choose your industry"
                  />
                </QField>
                {/* Only an industry with sub-sectors asks for one. */}
                {terms && hasSubSectors(terms, answers.sector) && (
                  <QField label="Sub Sector" required>
                    <QSelect
                      value={answers.subSector}
                      onChange={set("subSector")}
                      options={(
                        industries.find((i) => i.sector === answers.sector)
                          ?.sub_sectors ?? []
                      ).map((x) => [x.name, x.label] as [string, string])}
                      placeholder={
                        answers.sector
                          ? "Choose your sub-sector"
                          : "Choose your industry first"
                      }
                    />
                  </QField>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <QField label="Business name (optional)">
                  <input
                    value={answers.businessName}
                    onChange={(e) => set("businessName")(e.target.value)}
                    placeholder="The name you trade under, if you have one"
                    className={inputClass()}
                  />
                </QField>
                <QField label="Which region do you do business in?" required>
                  <QSelect
                    value={answers.region}
                    onChange={set("region")}
                    options={REGIONS}
                    placeholder="Choose a region"
                  />
                </QField>
              </div>
              <QField
                label="What does your business sell or do?"
                required
                helpFirst
                help="For example: vegetables at the market, phone repairs, or hair braiding from home."
              >
                <QTextArea
                  value={answers.tradeActivity}
                  onChange={set("tradeActivity")}
                />
              </QField>
              <div className="grid gap-4 lg:grid-cols-2">
                <QField label="How long have you been in business?" required>
                  <Chips
                    label="How long have you been in business?"
                    options={terms.trading_since}
                    value={answers.tradingSince}
                    onChange={set("tradingSince")}
                  />
                </QField>
                <QField
                  label="Business location"
                  required
                  help="Choose Mobile if you move around to sell or work."
                >
                  <Chips
                    label="Business location"
                    options={terms.trade_locations}
                    value={answers.tradeLocation}
                    onChange={set("tradeLocation")}
                  />
                </QField>
              </div>

              <QField label="Business Location" required>
                <LocationPicker
                  lat={answers.lat}
                  lng={answers.lng}
                  place={answers.place}
                  onChange={(p) => {
                    setError(null);
                    setAnswers((a) => ({
                      ...a,
                      lat: p.lat,
                      lng: p.lng,
                      place: p.place ?? a.place,
                    }));
                  }}
                />
                <input
                  value={answers.place}
                  onChange={(e) => set("place")(e.target.value)}
                  placeholder="Directions or a landmark near it (optional)"
                  aria-label="Directions or landmark"
                  className={inputClass()}
                />
              </QField>

              <div className="flex flex-col gap-2">
                <div>
                  <span className="text-[13px] font-bold text-slate-800">
                    Two supporting contacts
                    <span className="ml-0.5 text-rose-500"> *</span>
                  </span>
                  <p className="text-xs text-slate-500">
                    People who know you and your business, and how GDB can reach
                    them.
                  </p>
                </div>
                {([0, 1] as const).map((i) => (
                  <div
                    key={i}
                    className="grid items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-[auto_1fr_1fr_1fr]"
                  >
                    <span className="hidden h-10 w-7 items-center justify-center text-sm font-black text-brand-dark md:flex">
                      {i + 1}
                    </span>
                    <QField label="Full name" required>
                      <input
                        value={answers.contacts[i].name}
                        onChange={(e) => setContact(i, "name")(e.target.value)}
                        placeholder="Their full name"
                        aria-label={`Supporting contact ${i + 1} name`}
                        className={inputClass()}
                      />
                    </QField>
                    <QField label="Relationship" required>
                      <input
                        value={answers.contacts[i].relationship}
                        onChange={(e) =>
                          setContact(i, "relationship")(e.target.value)
                        }
                        placeholder="For example: neighbour, supplier"
                        aria-label={`Supporting contact ${i + 1} relationship`}
                        className={inputClass()}
                      />
                    </QField>
                    <QField label="Phone number" required>
                      <PhoneInput
                        value={answers.contacts[i].phone}
                        onChange={setContact(i, "phone")}
                        ariaLabel={`Supporting contact ${i + 1} phone`}
                        className={inputClass()}
                      />
                    </QField>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === "loan" && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <QField
                  label="How much do you need?"
                  required
                  help={`Up to ${gyd(terms.ceiling)}. GDB decides the approved amount.`}
                  error={
                    overCap
                      ? `Exceeds the ${gyd(terms.ceiling)} limit. Enter ${gyd(terms.ceiling)} or less.`
                      : null
                  }
                >
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-black text-slate-400">
                      G$
                    </span>
                    <input
                      inputMode="numeric"
                      aria-label="Loan amount in Guyana dollars"
                      value={
                        answers.amount
                          ? Number(answers.amount).toLocaleString("en-US")
                          : ""
                      }
                      onChange={(e) =>
                        set("amount")(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="150,000"
                      className={`${inputClass(overCap)} h-12! pl-11! text-xl! font-black tracking-tight`}
                    />
                  </div>
                  <div
                    className="flex flex-wrap gap-1.5"
                    aria-label="Quick amounts"
                  >
                    {[0.25, 0.5, 0.75, 1].map((f) => {
                      const v = Math.round((terms.ceiling * f) / 1000) * 1000;
                      const on = Number(answers.amount) === v;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => set("amount")(String(v))}
                          aria-pressed={on}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                            on
                              ? "border-brand-dark bg-brand-dark text-white"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50"
                          }`}
                        >
                          {gyd(v)}
                        </button>
                      );
                    })}
                  </div>
                </QField>
                <QField
                  label="Repayment term"
                  required
                  help={`Choose ${termList(terms.term_options)} months. Equal monthly instalments, ${terms.rate_of_interest}% interest.`}
                >
                  <div
                    className="grid grid-cols-4 gap-2"
                    role="radiogroup"
                    aria-label="Repayment term in months"
                  >
                    {terms.term_options.map((m) => {
                      const on = answers.term === String(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={`${m} month${m === 1 ? "" : "s"}`}
                          onClick={() => set("term")(String(m))}
                          className={`flex h-12 flex-col items-center justify-center rounded-lg border transition-all ${
                            on
                              ? "border-brand-dark bg-brand-dark text-white shadow-sm shadow-emerald-950/20"
                              : "border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
                          }`}
                        >
                          <span
                            className={`text-base font-black leading-none ${on ? "text-amber-300" : ""}`}
                          >
                            {m}
                          </span>
                          <span
                            className={`mt-0.5 text-[10px] font-semibold ${on ? "text-emerald-100" : "text-slate-400"}`}
                          >
                            months
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </QField>
              </div>
              <QField
                label="Moratorium"
                tag={<Pill tone="grey">Optional</Pill>}
                help="How long to wait, after the funds are released, before your first instalment. Tap again to clear."
              >
                <div
                  className="grid grid-cols-3 gap-2 sm:max-w-md"
                  role="radiogroup"
                  aria-label="Moratorium in months"
                >
                  {(terms.moratorium_options ?? [1, 2, 3]).map((m) => {
                    const on = answers.moratorium === String(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${m} month${m === 1 ? "" : "s"} moratorium`}
                        onClick={() => set("moratorium")(on ? "" : String(m))}
                        className={`flex h-12 flex-col items-center justify-center rounded-lg border transition-all ${
                          on
                            ? "border-brand-dark bg-brand-dark text-white shadow-sm shadow-emerald-950/20"
                            : "border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
                        }`}
                      >
                        <span
                          className={`text-base font-black leading-none ${on ? "text-amber-300" : ""}`}
                        >
                          {m}
                        </span>
                        <span
                          className={`mt-0.5 text-[10px] font-semibold ${on ? "text-emerald-100" : "text-slate-400"}`}
                        >
                          month{m === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {Number(answers.moratorium) > 0 && (
                  <p className="mt-1.5 text-xs font-semibold text-emerald-800">
                    {firstRepaymentLine(Number(answers.moratorium))}
                  </p>
                )}
              </QField>
              <QField
                label="Purpose of the loan"
                required
                helpFirst
                help="What you will use the money for, and how it helps your business."
              >
                <QTextArea value={answers.purpose} onChange={set("purpose")} />
              </QField>
              {monthly && !overCap && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                      You would repay about
                    </p>
                    <p className="text-lg font-black tracking-tight text-slate-900">
                      {monthly}{" "}
                      <span className="text-sm font-semibold text-slate-500">
                        / month
                      </span>
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">
                    for {months} · total {gyd(amt)} · no interest
                  </p>
                </div>
              )}
              <Check
                checked={answers.residesInGuyana}
                onChange={set("residesInGuyana")}
              >
                <b className="font-bold text-slate-900">
                  I confirm I have been residing in Guyana for the last 12
                  months or more.
                </b>
              </Check>
            </>
          )}

          {step === "bank" && (
            <>
              {/* With an account on file there is nothing to say "no" to. */}
              {accountOnFile === false && (
                <Check
                  checked={answers.noBankAccount}
                  onChange={set("noBankAccount")}
                >
                  <b className="font-bold text-slate-900">
                    I don't have a bank account
                  </b>
                </Check>
              )}
              {answers.noBankAccount && !accountOnFile ? (
                <FacilitatedBanks />
              ) : (
                <>
                  <PayoutAccount
                    value={{
                      bank: answers.bank,
                      accountNo: answers.accountNo,
                      branchCode,
                      branch: answers.branch,
                      holder: answers.holder,
                      confirmNo: answers.confirmNo,
                      manual: answers.manualAccount,
                    }}
                    onChange={(next) => {
                      // Includes the saved account arriving after a too-early
                      // Save: a message about a blank account must not outlive it.
                      setError(null);
                      setAnswers((a) => ({
                        ...a,
                        bank: next.bank,
                        branch: next.branch,
                        accountNo: next.accountNo,
                        holder: next.holder,
                        confirmNo: next.confirmNo,
                        manualAccount: next.manual,
                      }));
                      setBranchCode(next.branchCode);
                    }}
                    onAccountType={(t) =>
                      set("accountType")(t as QuickAnswers["accountType"])
                    }
                  />
                  <QField label="Type of account" required>
                    <Chips
                      label="Type of account"
                      options={[...ACCOUNT_TYPES]}
                      value={answers.accountType}
                      onChange={(v) =>
                        set("accountType")(v as QuickAnswers["accountType"])
                      }
                    />
                  </QField>
                  <p className="text-[12.5px] text-ql-muted">
                    GDB checks the account before any payment is released.
                  </p>
                </>
              )}
            </>
          )}

          <Footer>
            <QButton
              kind="secondary"
              back
              onClick={() => goTo(QUICK_STEPS[Math.max(index - 1, 0)].id)}
            >
              Back
            </QButton>
            <QButton disabled={busy} onClick={() => void goNext()} next>
              {busy
                ? "Saving…"
                : step === "bank"
                  ? "Save and review"
                  : "Save and continue"}
            </QButton>
          </Footer>
        </>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs sm:px-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gdb-goldleaf">
                Quick Loan application
              </p>
              <p className="text-[13px] font-bold text-slate-800">
                {tab === "docs"
                  ? "Your documents"
                  : `Step ${railIndex} of ${RAIL_STEPS.length} · ${current.title}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {saveState}
              {draft && (
                <Tabs
                  items={[
                    ["app", "Application"],
                    ["docs", "Documents"],
                  ]}
                  value={tab}
                  onChange={(v) => {
                    setError(null);
                    setTab(v);
                  }}
                />
              )}
            </div>
          </div>
          <StepRail
            steps={RAIL_STEPS}
            current={step}
            stateOf={stateOf}
            canOpen={(id) =>
              !busy && QUICK_STEPS.findIndex((s) => s.id === id) <= furthest
            }
            onOpen={(id) => {
              setTab("app");
              void jumpTo(QUICK_STEPS.findIndex((s) => s.id === id));
            }}
          />
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
          <Panel>{body}</Panel>

          {/* What they are applying for, always in view — so no step is
              answered without the amount and its monthly cost in front of them. */}
          <aside
            className="flex flex-col gap-3 lg:sticky lg:top-20"
            aria-label="Your Quick Loan"
          >
            <div className="relative overflow-hidden rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-[#071a3d] via-brand-dark to-brand text-white shadow-lg shadow-emerald-950/20">
              <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-60" />
              <div className="relative px-4 py-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                  Your Quick Loan
                </p>
                <p
                  className={`mt-0.5 font-black tracking-tight ${amt > 0 ? "text-2xl text-amber-300" : "text-base text-white/70"}`}
                >
                  {amt > 0 ? gyd(amt) : "Amount not set yet"}
                </p>
                <p className="text-[11px] text-emerald-200">
                  Up to {gyd(terms.ceiling)} · GDB decides the approved amount
                </p>
              </div>
              <dl className="relative grid grid-cols-2 border-t border-white/10 bg-black/20">
                <div className="border-r border-white/10 px-4 py-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/90">
                    Term
                  </dt>
                  <dd className="text-sm font-bold">{termN ? months : "—"}</dd>
                </div>
                <div className="px-4 py-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/90">
                    Monthly
                    {Number(answers.moratorium)
                      ? ` · first in ${Number(answers.moratorium) + 1} months`
                      : ""}
                  </dt>
                  <dd className="text-sm font-bold">
                    {monthly && !overCap ? `≈ ${monthly}` : "—"}
                  </dd>
                </div>
              </dl>
              {answers.purpose.trim() && (
                <p className="relative line-clamp-2 border-t border-white/10 px-4 py-2.5 text-xs text-emerald-100">
                  For: {answers.purpose}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-extrabold text-slate-900">
                  Your progress
                </p>
                <span className="text-xs font-bold text-slate-500">
                  {doneCount} of {sections.length}
                </span>
              </div>
              <Bar pct={(doneCount / sections.length) * 100} />
              <p className="mt-2 text-[11px] text-slate-500">
                {draft
                  ? "Saved to GDB as you go — you can leave and come back."
                  : "Your draft is saved once you reach Loan details."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setHelping(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="group flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-left transition-colors hover:bg-amber-50"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white text-amber-700 ring-1 ring-amber-200">
                <UsersIcon className="h-4 w-4" />
              </span>
              <span>
                <b className="block text-sm font-extrabold text-slate-900">
                  Prefer some help?
                </b>
                <span className="text-xs text-slate-600">
                  A GDB field officer can call you and complete it with you.
                </span>
              </span>
            </button>
          </aside>
        </div>
      </div>
    );
  };

  return <>{blocked ?? screen()}</>;
}

/** Who is applying — already known, so shown rather than asked: their name,
 *  National ID or TIN, phone and date of birth from their account and profile.
 *  A date of birth the account lacks is the one thing asked here (`askDob`).
 *  The E-ID is typed beside it, as its own field. */
function YourDetails({
  user,
  profile,
  dob,
  askDob,
  onDob,
}: {
  user: {
    full_name?: string;
    eid?: string | null;
    tin?: string | null;
    national_id?: string | null;
  } | null;
  profile: CitizenProfile | null;
  dob: string;
  askDob?: boolean;
  onDob?: (v: string) => void;
}) {
  const phone = profile?.phone || profile?.verified_phone || "";
  const facts: [string, ReactNode][] = [
    ["Name", user?.full_name || "—"],
    [
      user?.national_id ? "National ID" : "TIN",
      <span className="font-mono">
        {user?.national_id || user?.tin || "—"}
      </span>,
    ],
    ["Phone", phone ? formatPhone(phone) : "—"],
  ];
  return (
    <section
      className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4"
      aria-label="Your details"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
          Your details
        </p>
        <span className="text-[11px] text-slate-500">
          From your account. To change them, go to{" "}
          <a href="/profile" className="font-bold text-brand hover:underline">
            My details
          </a>
          .
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {k}
            </dt>
            <dd className="text-sm font-bold text-slate-900">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Date of birth{askDob && <span className="text-rose-500"> *</span>}
          </dt>
          {askDob && onDob ? (
            <dd>
              <DateInput
                value={dob}
                onChange={(v) => onDob(v)}
                label="Date of birth"
              />
            </dd>
          ) : (
            <dd className="text-sm font-bold text-slate-900">
              {dob ? formatDate(dob) : "—"}
            </dd>
          )}
        </div>
      </dl>
    </section>
  );
}
