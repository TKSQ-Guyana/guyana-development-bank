import { useEffect, useMemo, useState } from "react";
import { ApplyLink } from "../components/apply/ApplyLink";
import { YourRequests } from "../features/applications/YourRequests";
import { Link, useNavigate } from "react-router-dom";
import { call } from "../api";
import { useAuth } from "../auth";
import { CardLabel } from "../components/ui/Card";
import { StageBadge } from "../components/ui/Stepper";
import {
  ApplicationsIcon,
  ArrowRightIcon,
  PlusIcon,
} from "../components/ui/icons";
import { AssistConsentCards } from "../features/field-officer/AssistConsentCards";
import { LOAN_STAGES, type LoanAccount, type LoanApplication } from "../types";
import { formatDate, formatGyd } from "../utils";

/** The citizen's home: one action (apply), the applications they have made —
 *  a paged list, newest first, as gdb_bank.api.my_loans answers — and, once
 *  money has been released, the facility. */

/** A case still moving through the journey, as opposed to one declined or drawn. */
const LIVE_STAGES = new Set(["Draft", "Review", "Approved", "Signing"]);

/** The list's filter. Each tab is a predicate over stages. */
const TABS = {
  All: () => true,
  "In review": (l: LoanApplication) => l.stage === "Review",
  Approved: (l: LoanApplication) =>
    l.stage === "Approved" || l.stage === "Signing" || l.stage === "Disbursed",
  Drafts: (l: LoanApplication) => l.stage === "Draft",
} as const;
type Tab = keyof typeof TABS;

const PAGE_SIZE = 5;

function nextInstalment(
  account: LoanAccount | null,
): { date: string; amount: number } | null {
  if (!account?.schedule?.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const row = account.schedule.find((r) => r.payment_date >= today) ?? null;
  return row ? { date: row.payment_date, amount: row.total_payment } : null;
}

export function Dashboard() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [account, setAccount] = useState<LoanAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("All");
  const [page, setPage] = useState(1);

  useEffect(() => {
    call<LoanApplication[]>("gdb_bank.api.my_loans")
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  const disbursed = useMemo(
    () => loans?.find((l) => l.stage === "Disbursed") ?? null,
    [loans],
  );

  // The facility panel needs lending's own figures, so it is a second call and
  // only for a case that has actually been drawn.
  useEffect(() => {
    if (!disbursed) {
      setAccount(null);
      return;
    }
    call<LoanAccount>("gdb_bank.api.loan_account", {
      application: disbursed.name,
    })
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [disbursed]);

  if (error) {
    return (
      <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </p>
    );
  }

  const firstName = (user?.full_name ?? "").split(" ")[0];
  const inProgress = loans?.filter((l) => LIVE_STAGES.has(l.stage)).length ?? 0;
  const filtered = (loans ?? []).filter(TABS[tab]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <AssistConsentCards />

      {/* The one thing a citizen arrives here to do, and where they stand. */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-[#071a3d] via-brand-dark to-brand text-white shadow-lg shadow-emerald-950/20">
        <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              {firstName ? `Good day, ${firstName}.` : "Welcome."}
            </h2>
            <p className="mt-0.5 text-sm text-emerald-100">
              Zero-interest financing for Guyanese businesses — no collateral,
              and a person decides.
            </p>
          </div>
          <ApplyLink className="group inline-flex flex-none items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3 text-sm font-extrabold text-emerald-950 shadow-lg shadow-black/20 transition-all hover:-translate-y-0.5 hover:from-amber-300 hover:to-amber-400">
            <PlusIcon className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
            Apply for a loan
          </ApplyLink>
        </div>
        <dl className="relative grid grid-cols-2 divide-white/10 border-t border-white/10 bg-black/20 sm:grid-cols-4 sm:divide-x">
          {[
            { label: "Interest", value: "0%" },
            { label: "Collateral", value: "None" },
            { label: "In progress", value: String(inProgress) },
            {
              label: "Active facility",
              value: disbursed
                ? formatGyd(
                    account?.loan?.loan_amount ?? disbursed.facility_amount,
                  )
                : "None yet",
              gold: true,
            },
          ].map((s) => (
            <div key={s.label} className="px-6 py-2.5 sm:px-8">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/90">
                {s.label}
              </dt>
              <dd
                className={`text-base font-black tracking-tight ${s.gold ? "text-amber-300" : ""}`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {disbursed && account?.loan && (
        <Facility account={account} disbursed={disbursed} />
      )}

      {/* A field officer they asked for, and anything GDB has asked them for. */}
      <YourRequests />

      {/* Every application, newest first, a page at a time. */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-extrabold tracking-tight text-slate-900">
              Your applications
            </h3>
            {loans && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                {loans.length}
              </span>
            )}
          </div>
          <div
            className="flex gap-1 self-start rounded-xl border border-slate-200 bg-slate-100 p-1 text-xs font-semibold sm:self-auto"
            role="tablist"
            aria-label="Filter applications"
          >
            {(Object.keys(TABS) as Tab[]).map((t) => {
              const count = loans?.filter(TABS[t]).length ?? 0;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => {
                    setTab(t);
                    setPage(1);
                  }}
                  className={`rounded-lg px-3 py-1 ${tab === t ? "bg-white font-bold text-brand-dark shadow-xs" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {t}
                  <span
                    className={`ml-1 ${tab === t ? "text-slate-400" : "text-slate-400"}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {!loans ? (
          <div className="space-y-3 p-5" aria-busy>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : !filtered.length ? (
          <EmptyList filtered={tab !== "All"} />
        ) : (
          <>
            <ApplicationTable loans={shown} />
            {filtered.length > PAGE_SIZE && (
              <Pager
                page={current}
                pages={pages}
                total={filtered.length}
                onPage={setPage}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** The applications as rows — a table on a wide screen, stacked on a phone. */
function ApplicationTable({ loans }: { loans: LoanApplication[] }) {
  const navigate = useNavigate();
  const open = (l: LoanApplication) => navigate(`/loans/${l.name}`);
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-5 py-2.5 font-bold">Application</th>
            <th className="px-3 py-2.5 font-bold">Amount</th>
            <th className="px-3 py-2.5 font-bold">Progress</th>
            <th className="px-3 py-2.5 font-bold">Updated</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 border-t border-slate-100">
          {loans.map((l) => (
            <tr
              key={l.name}
              onClick={() => open(l)}
              className="cursor-pointer transition-colors hover:bg-emerald-50/50"
            >
              <td className="px-5 py-3">
                <p className="font-mono text-xs font-semibold text-slate-500">
                  {l.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 font-bold text-slate-900">
                  {l.product === "quick" ? "Quick Loan" : "SME Direct Loan"}
                  {(l.business_name || l.cluster) && (
                    <span className="truncate font-normal text-slate-500">
                      · {l.cluster || l.business_name}
                    </span>
                  )}
                </p>
              </td>
              <td className="px-3 py-3">
                <p className="font-bold text-slate-900">
                  {formatGyd(l.facility_amount)}
                </p>
                <p className="text-xs text-slate-500">
                  {l.facility_term} months
                </p>
              </td>
              <td className="px-3 py-3">
                <Progress loan={l} />
              </td>
              <td className="px-3 py-3 text-xs text-slate-500">
                {formatDate(l.modified)}
              </td>
              <td className="px-5 py-3 text-right">
                <RowAction loan={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-slate-100 md:hidden">
        {loans.map((l) => (
          <li key={l.name}>
            <button
              type="button"
              onClick={() => open(l)}
              className="flex w-full flex-col gap-2 px-5 py-3.5 text-left hover:bg-emerald-50/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">
                    {l.product === "quick" ? "Quick Loan" : "SME Direct Loan"}
                  </p>
                  <p className="font-mono text-xs text-slate-500">{l.name}</p>
                </div>
                <p className="flex-none text-right font-bold text-slate-900">
                  {formatGyd(l.facility_amount)}
                  <span className="block text-xs font-normal text-slate-500">
                    {l.facility_term} months
                  </span>
                </p>
              </div>
              <Progress loan={l} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Where the case stands: the five-rung ladder as a slim bar, and its badge. */
function Progress({ loan }: { loan: LoanApplication }) {
  const at = LOAN_STAGES.indexOf(loan.stage);
  return (
    <div className="flex items-center gap-2.5">
      {loan.stage !== "Rejected" && (
        <div
          className="flex w-20 flex-none gap-0.5"
          aria-label={`Step ${at + 1} of ${LOAN_STAGES.length}`}
        >
          {LOAN_STAGES.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= at ? "bg-brand" : "bg-slate-200"}`}
            />
          ))}
        </div>
      )}
      <StageBadge stage={loan.stage} />
    </div>
  );
}

function RowAction({ loan }: { loan: LoanApplication }) {
  const draft = loan.stage === "Draft";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold ${
        draft ? "bg-brand-dark text-white" : "text-brand hover:bg-emerald-50"
      }`}
    >
      {draft ? "Continue" : "View"}
      <ArrowRightIcon className="h-3.5 w-3.5" />
    </span>
  );
}

function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const btn =
    "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3"
      aria-label="Pages"
    >
      <p className="text-xs text-slate-500">
        Showing{" "}
        <b className="font-bold text-slate-700">
          {from}–{to}
        </b>{" "}
        of <b className="font-bold text-slate-700">{total}</b>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`${btn} text-slate-600 hover:bg-slate-100`}
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className={`${btn} ${p === page ? "bg-brand-dark text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className={`${btn} text-slate-600 hover:bg-slate-100`}
          disabled={page === pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </nav>
  );
}

function EmptyList({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center px-5 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-brand">
        <ApplicationsIcon className="h-6 w-6" />
      </span>
      <p className="mt-3 font-bold text-slate-900">
        {filtered ? "Nothing here" : "No applications yet"}
      </p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        {filtered
          ? "No application matches this filter."
          : "Start one when you are ready. You can save and come back — nothing is sent until you submit."}
      </p>
      {!filtered && (
        <ApplyLink className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand-dark px-4 py-2 text-sm font-bold text-white hover:bg-[#071a3d]">
          <PlusIcon className="h-4 w-4 text-amber-300" />
          Start an application
        </ApplyLink>
      )}
    </div>
  );
}

/** The released loan — shown only once there is one. */
function Facility({
  account,
  disbursed,
}: {
  account: LoanAccount;
  disbursed: LoanApplication;
}) {
  const due = nextInstalment(account);
  const loan = account.loan!;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <CardLabel>My loan · {loan.name}</CardLabel>
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
            {formatGyd(account.dues?.principal_outstanding ?? 0)}
            <span className="ml-2 text-sm font-semibold text-slate-500">
              outstanding
            </span>
          </p>
        </div>
        <StageBadge stage={disbursed.stage} />
      </div>
      <dl className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Next instalment
          </dt>
          <dd className="mt-0.5 font-bold text-slate-800">
            {due ? formatGyd(due.amount) : "—"}
          </dd>
          <dd className="text-xs text-slate-500">
            {due ? formatDate(due.date) : "No instalment scheduled"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Disbursed
          </dt>
          <dd className="mt-0.5 font-bold text-slate-800">
            {formatGyd(loan.disbursed_amount)}
          </dd>
          <dd className="text-xs text-slate-500">
            of {formatGyd(loan.loan_amount)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Repaid
          </dt>
          <dd className="mt-0.5 font-bold text-slate-800">
            {formatGyd(loan.total_amount_paid)}
          </dd>
          <dd className="text-xs text-slate-500">
            {account.dues?.overdue_total_amount ? (
              <span className="font-semibold text-rose-600">
                {formatGyd(account.dues.overdue_total_amount)} overdue
              </span>
            ) : (
              "Nothing overdue"
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/statements"
          className="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Request a statement
        </Link>
      </div>
    </section>
  );
}
