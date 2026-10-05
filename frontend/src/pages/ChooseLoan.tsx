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
        { label: "Term", value: "Up to 24 months" },
        { label: "Application", value: `${QUICK_STEP_COUNT} short steps` },
      ],
      needs: [
        "A short description of your business",
        "Bank account in your name",
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
        { label: "Term", value: "Up to 5 years" },
        { label: "Application", value: `${SME_STEP_COUNT} steps` },
      ],
      needs: ["Business plan", "Financial statements"],
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
      </header>

      {error && (
        <div className="mt-4">
          <Banner kind="error" title={error} />
        </div>
      )}

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
            recommended={false}
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
        blockedReason={
          list.every((o) => blockedOf(o.id))
            ? (blockedOf(list[0].id)?.message ?? null)
            : null
        }
        onBack={() => navigate("/")}
        onContinue={() => chosen && navigate(chosen.to)}
      />
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
            ? "cursor-pointer border-brand-dark shadow-[0_18px_44px_-20px_rgba(11,38,84,0.45)] ring-2 ring-brand-dark"
            : "cursor-pointer border-slate-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_14px_36px_-20px_rgba(11,38,84,0.35)]"
      }`}
    >
      {/* Head band: the loan's identity and its one headline figure. */}
      <div
        className={`relative px-5 py-4 ${
          gold
            ? "bg-gradient-to-br from-amber-50 via-amber-50/60 to-white"
            : "bg-gradient-to-br from-[#071a3d] via-brand-dark to-brand text-white"
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

        <dl className="grid grid-cols-2 divide-x divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60">
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
  blockedReason,
  onBack,
  onContinue,
}: {
  chosen: string | null;
  /** Why no loan can be started now (one loan at a time) — the tooltip. */
  blockedReason: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 md:left-[256px]">
      <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-2.5 shadow-[0_12px_40px_-12px_rgba(11,38,84,0.3)] backdrop-blur-xl backdrop-saturate-150">
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
              disabled={!chosen || !!blockedReason}
              title={blockedReason ?? undefined}
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
