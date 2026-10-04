import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { call } from "../api";
import { Banner } from "../components/portal/ui";
import {
  ArrowRightIcon,
  BankIcon,
  CheckIcon,
  PulseIcon,
} from "../components/ui/icons";
import {
  gyd,
  RAIL_STEPS,
  type QuickLoanTerms,
} from "../features/quick-loan/model/quickLoan";
import {
  openCaseLink,
  type ProductKey,
  useEligibility,
} from "../shared/eligibility";

/** "Choose your loan" — the first screen of every application. The SME Direct
 *  Loan goes on to its own form (/apply/new/sme), the Quick Loan to
 *  /apply/quick. Nothing is saved here.
 *
 *  Sized to fit one laptop screen: the two cards are the page, everything
 *  else is a single line above or below them.
 *
 *  Both loans' figures are the server's (sme_loan_terms, quick_loan_terms) —
 *  each product's own ceiling and rate, which lending refuses past. */

type Pick = "sme" | "quick";

const PRODUCT_OF: Record<Pick, ProductKey> = {
  sme: "standard",
  quick: "quick",
};

/** Why a card cannot be picked, and the way to the case standing in the way. */
interface Blocked {
  message: string;
  link: { to: string; label: string };
}

/** Steps the applicant will walk on each form — the forms' own step lists, so
 *  the count here cannot drift from what they then see. SME: Apply.STEPS. */
const SME_STEP_COUNT = 6;
// The steps on the Quick Loan's rail; "Before you start" is a page ahead of them.
const QUICK_STEP_COUNT = RAIL_STEPS.length;

/** The SME Direct Loan's terms, as gdb_bank.api.sme_loan_terms answers. */
interface SmeLoanTerms {
  ceiling: number;
  max_term: number;
  term_options?: number[];
  rate_of_interest: number;
}

interface LoanOption {
  id: Pick;
  name: string;
  tagline: string;
  icon: ReactNode;
  /** Short terms shown as pills in the card head. */
  terms: string[];
  headline: { label: string; value: string; note: string };
  facts: { label: string; value: string }[];
  needs: string[];
  to: string;
}

function options(
  sme: SmeLoanTerms | null,
  terms: QuickLoanTerms | null,
): LoanOption[] {
  return [
    {
      id: "quick",
      name: "Quick Loan",
      tagline: "For market vendors, small services and other small businesses.",
      icon: <PulseIcon className="h-5 w-5" />,
      terms: [
        terms ? `${terms.rate_of_interest}% interest` : "Interest —",
        "No collateral",
      ],
      headline: {
        label: "Borrow up to",
        value: terms ? gyd(terms.ceiling) : "—",
        note: "GDB decides the approved amount",
      },
      facts: [
        { label: "Registration", value: "Not needed" },
        { label: "Term", value: "Up to 24 months" },
        { label: "Application", value: `${QUICK_STEP_COUNT} short steps` },
      ],
      needs: [
        "A short description of your business",
        "Bank account in your name, if you have one",
      ],
      to: "/apply/quick",
    },
    {
      id: "sme",
      name: "SME Direct Loan",
      tagline:
        "For a registered business or a new venture, with a full business plan.",
      icon: <BankIcon className="h-5 w-5" />,
      terms: [
        sme ? `${sme.rate_of_interest}% interest` : "Interest —",
        "No collateral",
      ],
      headline: {
        label: "Borrow up to",
        value: sme ? gyd(sme.ceiling) : "—",
        note: "GDB decides the approved amount",
      },
      facts: [
        { label: "Registration", value: "Business registration required" },
        { label: "Term", value: "Up to 5 years" },
        { label: "Application", value: `${SME_STEP_COUNT} steps` },
      ],
      needs: [
        "Business plan",
        "Financial statements",
        "Bank statements",
        "Supplier quotations",
      ],
      to: "/apply/new/sme",
    },
  ];
}

export function ChooseLoan() {
  const navigate = useNavigate();
  const [pick, setPick] = useState<Pick | null>(null);
  const [terms, setTerms] = useState<QuickLoanTerms | null>(null);
  const [sme, setSme] = useState<SmeLoanTerms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<"yes" | "no" | null>(null);
  const [needsMore, setNeedsMore] = useState<"yes" | "no" | null>(null);
  // One SME Loan and one Quick Loan at a time (services/eligibility): a kind
  // the citizen already has open is shown, but cannot be picked.
  const eligibility = useEligibility();
  const blockedOf = (id: Pick): Blocked | null => {
    const e = eligibility?.[PRODUCT_OF[id]];
    if (!e || e.can_apply || !e.open_case) return null;
    return {
      message: e.message ?? "",
      link: openCaseLink(PRODUCT_OF[id], e.open_case),
    };
  };
  const cardRefs = useRef<Record<Pick, HTMLDivElement | null>>({
    sme: null,
    quick: null,
  });

  useEffect(() => {
    call<QuickLoanTerms>("gdb_bank.api.quick_loan_terms")
      .then(setTerms)
      .catch((err: Error) => setError(err.message));
    call<SmeLoanTerms>("gdb_bank.api.sme_loan_terms")
      .then(setSme)
      .catch((err: Error) => setError(err.message));
  }, []);

  const list = options(sme, terms);
  // A registered business, or one needing more than the Quick Loan's ceiling,
  // is the SME loan's; a small unregistered trader is the Quick Loan's.
  const suggested: Pick | null =
    needsMore === "yes" || registered === "yes"
      ? "sme"
      : registered === "no" && needsMore === "no"
        ? "quick"
        : null;
  const recommended = suggested && !blockedOf(suggested) ? suggested : null;

  const chosen = list.find((o) => o.id === pick && !blockedOf(o.id)) ?? null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>, id: Pick) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (blockedOf(id)) return;
      if (e.key === "Enter" && pick === id)
        navigate(list.find((o) => o.id === id)!.to);
      else setPick(id);
    }
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const next: Pick = id === "sme" ? "quick" : "sme";
      setPick(next);
      cardRefs.current[next]?.focus();
    }
  };

  return (
    <div className="pb-24">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            Which loan fits your business?
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Compare the two, pick one, and save your application as you go. A
            person at GDB makes every decision.
          </p>
        </div>
        <Journey />
      </header>

      {error && (
        <div className="mt-4">
          <Banner kind="error" title={error} />
        </div>
      )}

      <Helper
        registered={registered}
        setRegistered={setRegistered}
        needsMore={needsMore}
        setNeedsMore={setNeedsMore}
        ceiling={terms ? gyd(terms.ceiling) : "the Quick Loan limit"}
        recommended={
          recommended ? list.find((o) => o.id === recommended)!.name : null
        }
        recommendedPicked={!!recommended && pick === recommended}
        onUse={() => recommended && setPick(recommended)}
      />

      <div
        role="radiogroup"
        aria-label="Loan type"
        className="mt-4 grid gap-4 lg:grid-cols-2"
      >
        {list.map((o) => (
          <OptionCard
            key={o.id}
            option={o}
            selected={pick === o.id && !blockedOf(o.id)}
            recommended={recommended === o.id}
            blocked={blockedOf(o.id)}
            tabIndex={
              pick ? (pick === o.id ? 0 : -1) : o.id === "quick" ? 0 : -1
            }
            refCb={(el) => (cardRefs.current[o.id] = el)}
            onSelect={() => !blockedOf(o.id) && setPick(o.id)}
            onKeyDown={(e) => onKey(e, o.id)}
          />
        ))}
      </div>

      <ActionBar
        chosen={chosen?.name ?? null}
        onBack={() => navigate("/")}
        onContinue={() => chosen && navigate(chosen.to)}
      />
    </div>
  );
}

/** Where this page sits in the whole journey: three plain stages, one line. */
function Journey() {
  const stages = ["Choose a loan", "Apply", "Credit risk"];
  return (
    <ol
      className="flex items-center gap-2 text-xs font-semibold"
      aria-label="Application journey"
    >
      {stages.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 ${i === 0 ? "text-brand-dark" : "text-slate-400"}`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                i === 0
                  ? "bg-brand-dark text-amber-300 ring-4 ring-emerald-100"
                  : "border border-slate-300 bg-white"
              }`}
              aria-current={i === 0 ? "step" : undefined}
            >
              {i + 1}
            </span>
            <span className="whitespace-nowrap">{s}</span>
          </span>
          {i < stages.length - 1 && (
            <span className="h-px w-5 bg-slate-300 sm:w-8" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}

/** Two yes/no questions and the suggestion they lead to, all on one row. */
function Helper({
  registered,
  setRegistered,
  needsMore,
  setNeedsMore,
  ceiling,
  recommended,
  recommendedPicked,
  onUse,
}: {
  registered: "yes" | "no" | null;
  setRegistered: (v: "yes" | "no") => void;
  needsMore: "yes" | "no" | null;
  setNeedsMore: (v: "yes" | "no") => void;
  ceiling: string;
  recommended: string | null;
  recommendedPicked: boolean;
  onUse: () => void;
}) {
  return (
    <section
      aria-label="Help me choose"
      className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 xl:flex-row xl:items-center xl:justify-between"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-dark text-xs font-black text-amber-300">
          ?
        </span>
        <p className="whitespace-nowrap text-sm font-bold text-slate-900">
          Not sure? Two questions.
        </p>
      </div>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 xl:flex-nowrap">
        <YesNo
          label="Is your business registered?"
          value={registered}
          onChange={setRegistered}
        />
        <YesNo
          label={`Need more than ${ceiling}?`}
          value={needsMore}
          onChange={setNeedsMore}
        />
        {recommended && (
          <span
            className="flex items-center gap-2 whitespace-nowrap text-sm text-amber-900"
            aria-live="polite"
          >
            <span>
              → <span className="font-bold">{recommended}</span> fits better
            </span>
            {!recommendedPicked && (
              <button
                type="button"
                onClick={onUse}
                className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-brand-dark ring-1 ring-amber-300 hover:bg-amber-200"
              >
                Select it
              </button>
            )}
          </span>
        )}
      </div>
    </section>
  );
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "yes" | "no" | null;
  onChange: (v: "yes" | "no") => void;
}) {
  return (
    <div className="flex items-center gap-2.5" role="group" aria-label={label}>
      <span className="whitespace-nowrap text-xs font-semibold text-slate-700">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {(["yes", "no"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`rounded-md px-2.5 py-0.5 text-xs font-bold capitalize transition-colors ${
              value === v
                ? "bg-brand-dark text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionCard({
  option: o,
  selected,
  recommended,
  blocked,
  tabIndex,
  refCb,
  onSelect,
  onKeyDown,
}: {
  option: LoanOption;
  selected: boolean;
  recommended: boolean;
  blocked: Blocked | null;
  tabIndex: number;
  refCb: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const gold = o.id === "quick";
  return (
    <div
      ref={refCb}
      role="radio"
      aria-checked={selected}
      aria-disabled={blocked ? true : undefined}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-xs outline-none transition-all duration-200 focus-visible:ring-4 focus-visible:ring-emerald-200 ${
        blocked
          ? "cursor-default border-amber-200"
          : selected
            ? "cursor-pointer border-brand-dark shadow-[0_18px_44px_-20px_rgba(2,44,25,0.45)] ring-2 ring-brand-dark"
            : "cursor-pointer border-slate-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_14px_36px_-20px_rgba(2,44,25,0.35)]"
      }`}
    >
      {/* Head band: the loan's identity and its one headline figure. */}
      <div
        className={`relative px-5 py-4 ${
          gold
            ? "bg-gradient-to-br from-amber-50 via-amber-50/60 to-white"
            : "bg-gradient-to-br from-[#022c19] via-brand-dark to-brand text-white"
        }`}
      >
        {!gold && (
          <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-60" />
        )}
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl border ${
                gold
                  ? "border-amber-200 bg-white text-amber-700"
                  : "border-amber-400/40 bg-black/25 text-amber-300"
              }`}
            >
              {o.icon}
            </span>
            <div className="min-w-0">
              <p
                className={`text-base font-black tracking-tight ${gold ? "text-slate-900" : "text-white"}`}
              >
                {o.name}
              </p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {o.terms.map((t) => (
                  <span
                    key={t}
                    className={`rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide ${
                      gold
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-white/15 text-emerald-100"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <SelectDot selected={selected} onDark={!gold} />
        </div>

        <div className="relative mt-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p
              className={`text-[10px] font-bold uppercase tracking-wider ${gold ? "text-amber-700" : "text-amber-300/90"}`}
            >
              {o.headline.label}
            </p>
            <p
              className={`text-2xl font-black leading-tight tracking-tight ${gold ? "text-slate-900" : "text-amber-300"}`}
            >
              {o.headline.value}
            </p>
            <p
              className={`text-[11px] ${gold ? "text-slate-500" : "text-emerald-200"}`}
            >
              {o.headline.note}
            </p>
          </div>
          {recommended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-extrabold text-emerald-950 shadow-sm">
              ★ Recommended for you
            </span>
          )}
        </div>
      </div>

      {/* Body: who it is for, the facts to compare, and what to have ready. */}
      <div
        className={`flex flex-1 flex-col gap-3 px-5 py-4 ${blocked ? "opacity-50" : ""}`}
      >
        <p className="text-sm text-slate-600">{o.tagline}</p>

        <dl className="grid grid-cols-3 divide-x divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60">
          {o.facts.map((f) => (
            <div key={f.label} className="px-3 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {f.label}
              </dt>
              <dd className="mt-0.5 text-sm font-bold leading-snug text-slate-900">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            You will need
          </span>
          {o.needs.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700"
            >
              <CheckIcon className="h-3 w-3 text-emerald-600" />
              {n}
            </span>
          ))}
        </div>
      </div>

      {blocked && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-5 py-3">
          <p className="min-w-0 flex-1 text-sm text-amber-900">
            <span className="font-bold">Not available right now.</span>{" "}
            {blocked.message}
          </p>
          <Link
            to={blocked.link.to}
            onClick={(e) => e.stopPropagation()}
            className="whitespace-nowrap rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-bold text-white hover:bg-brand"
          >
            {blocked.link.label}
          </Link>
        </div>
      )}
    </div>
  );
}

function SelectDot({
  selected,
  onDark,
}: {
  selected: boolean;
  onDark: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 transition-all ${
        selected
          ? "scale-110 border-amber-400 bg-amber-400 text-emerald-950"
          : onDark
            ? "border-white/50 bg-white/10"
            : "border-slate-300 bg-white"
      }`}
    >
      {selected && <CheckIcon className="h-3.5 w-3.5" />}
    </span>
  );
}

/** Sticky, glassy, always in reach: names the choice and owns the one action. */
function ActionBar({
  chosen,
  onBack,
  onContinue,
}: {
  chosen: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 md:left-[256px]">
      <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-2.5 shadow-[0_12px_40px_-12px_rgba(2,44,25,0.3)] backdrop-blur-xl backdrop-saturate-150">
          <p
            className="hidden text-sm text-slate-600 sm:block"
            aria-live="polite"
          >
            {chosen ? (
              <>
                Selected:{" "}
                <span className="font-bold text-slate-900">{chosen}</span>
                <span className="ml-2 hidden text-xs text-slate-400 lg:inline">
                  · Nothing is saved on this page
                </span>
              </>
            ) : (
              <>
                Choose a loan to continue
                <span className="ml-2 hidden text-xs text-slate-400 lg:inline">
                  · Applying is free
                </span>
              </>
            )}
          </p>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={onBack}
              className="whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="sm:hidden">Back</span>
              <span className="hidden sm:inline">Back to dashboard</span>
            </button>
            <button
              type="button"
              disabled={!chosen}
              onClick={onContinue}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-2 text-sm font-extrabold text-emerald-950 shadow-md shadow-amber-900/10 transition-all hover:-translate-y-0.5 hover:from-amber-300 hover:to-amber-400 disabled:translate-y-0 disabled:cursor-not-allowed disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none sm:flex-none"
            >
              <span className="sm:hidden">Continue</span>
              <span className="hidden sm:inline">
                {chosen ? `Continue with ${chosen}` : "Continue"}
              </span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
