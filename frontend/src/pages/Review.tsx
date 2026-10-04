import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import { Pager } from "../components/ui/Pager";
import { StageBadge } from "../components/ui/Stepper";
import { PAGE_LENGTH, useLoanQueue } from "../shared/useLoanQueue";
import type { LoanApplication, LoanStage } from "../types";
import { formatAge, formatGyd, formatDate } from "../utils";

/** Every stage a submitted case can be sitting in — Draft is excluded because
 *  all_loans never returns one: an application nobody has submitted is not
 *  before the Bank. The tab label is the underwriter's word for the stage. */
const TABS: { id: LoanStage | "All"; label: string }[] = [
  { id: "Review", label: "To review" },
  { id: "Approved", label: "Approved" },
  { id: "Signing", label: "Offer out" },
  { id: "Disbursed", label: "Done" },
  { id: "Rejected", label: "Declined" },
  { id: "All", label: "All" },
];

type SortKey =
  "age_desc" | "age_asc" | "amount_desc" | "amount_asc" | "evidence_first";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "age_desc", label: "Oldest in stage first" },
  { id: "age_asc", label: "Newest in stage first" },
  { id: "amount_desc", label: "Amount: highest first" },
  { id: "amount_asc", label: "Amount: lowest first" },
  { id: "evidence_first", label: "Missing evidence first" },
];

/** When this case entered the stage it is in now, for the age column. The
 *  server does not (yet) timestamp a stage transition directly, so this reads
 *  the nearest fact it does timestamp: submission for a case still in Review,
 *  the decision for everything after it. Approximate on purpose — it tells an
 *  underwriter which end of the queue is going stale, not a precise SLA
 *  clock. */
function stageSince(loan: LoanApplication): string | null {
  if (loan.stage === "Review") return loan.creation;
  return loan.reviewed_on ?? loan.creation;
}

const PAGE_SIZES = [10, 25, 50];

/** The filters the review queue accepts, as they sit in the address bar — so
 *  a filtered queue survives opening a case and coming back, and can be
 *  shared with a colleague. */
const FILTER_KEYS = [
  "search",
  "product",
  "business_stage",
  "evidence",
  "officer_review",
  "employment",
  "min_amount",
  "max_amount",
  "from_date",
  "to_date",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

const PRODUCT_LABEL: Record<string, string> = { standard: "SME Loan", quick: "Quick Loan" };
const STAGE_LABEL: Record<string, string> = { Existing: "Existing business", New: "New venture" };
const EVIDENCE_LABEL: Record<string, string> = { complete: "Evidence complete", missing: "Missing documents" };
const OFFICER_REVIEW_LABEL: Record<string, string> = { "1": "Needs Loan Officer review" };
/** The applicant's declaration of public-service employment (Yes / No). */
const EMPLOYMENT_LABEL: Record<string, string> = { public: "Public sector", private: "Private sector" };

/** What an active filter reads as in its chip. */
function chipLabel(key: FilterKey, value: string): string {
  switch (key) {
    case "search":
      return `"${value}"`;
    case "product":
      return PRODUCT_LABEL[value] ?? value;
    case "business_stage":
      return STAGE_LABEL[value] ?? value;
    case "evidence":
      return EVIDENCE_LABEL[value] ?? value;
    case "officer_review":
      return OFFICER_REVIEW_LABEL[value] ?? value;
    case "employment":
      return EMPLOYMENT_LABEL[value] ?? value;
    case "min_amount":
      return `From ${formatGyd(Number(value))}`;
    case "max_amount":
      return `Up to ${formatGyd(Number(value))}`;
    case "from_date":
      return `Submitted from ${formatDate(value)}`;
    case "to_date":
      return `Submitted to ${formatDate(value)}`;
  }
}

const FIELD =
  "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} mt-1`}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** An amount box that filters when the reader leaves it or presses Enter, not
 *  on every keystroke. */
function AmountFilter({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <input
        type="number"
        min={0}
        step={10000}
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onChange(draft)}
        onKeyDown={(e) => e.key === "Enter" && onChange(draft)}
        placeholder={placeholder}
        className={`${FIELD} mt-1`}
      />
    </label>
  );
}

export function Review() {
  const [params, setParams] = useSearchParams();
  const stage = (params.get("stage") as LoanStage | "All" | null) ?? "Review";
  const sort = (params.get("sort") as SortKey | null) ?? "age_asc";
  const pageLength = PAGE_SIZES.includes(Number(params.get("rows")))
    ? Number(params.get("rows"))
    : PAGE_LENGTH;
  const filters: Filters = {};
  FILTER_KEYS.forEach((k) => {
    const v = params.get(k);
    if (v) filters[k] = v;
  });
  const active = FILTER_KEYS.filter((k) => filters[k]);
  const [showMore, setShowMore] = useState(() =>
    Boolean(filters.min_amount || filters.max_amount || filters.from_date || filters.to_date),
  );

  /** Change some of the queue's settings in the address bar; an empty value
   *  removes its key. Replaces the history entry so Back leaves the page.
   *  Starts from the address as it is NOW (the ref), not as this render saw
   *  it — the search box's delayed update must not put back filters that
   *  Clear filters has just removed. */
  const latest = useRef(params);
  latest.current = params;
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(latest.current);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    latest.current = next;
    setParams(next, { replace: true });
  };
  const setStage = (s: LoanStage | "All") => update({ stage: s === "Review" ? "" : s });
  const setSort = (s: SortKey) => update({ sort: s === "age_asc" ? "" : s });

  // The search box is typed into; the queue is asked once typing pauses.
  const [text, setText] = useState(filters.search ?? "");
  useEffect(() => setText(filters.search ?? ""), [filters.search]);
  useEffect(() => {
    const wait = setTimeout(() => {
      if (text.trim() !== (latest.current.get("search") ?? "")) update({ search: text.trim() });
    }, 350);
    return () => clearTimeout(wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const clearAll = () => {
    setText("");
    update(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])));
  };

  // The server filters, counts each stage under the filters, sorts and sends
  // one page. The queue grows for as long as the Bank lends, so it is never
  // fetched whole.
  const { page, error, start, setStart } = useLoanQueue(
    { stage: stage === "All" ? undefined : stage, sort, ...filters },
    pageLength,
  );
  const counts = page?.counts ?? {};
  const rows = page?.rows;
  const amountsBackwards =
    filters.min_amount && filters.max_amount && Number(filters.min_amount) > Number(filters.max_amount);
  const datesBackwards = filters.from_date && filters.to_date && filters.from_date > filters.to_date;

  return (
    <div>
      <p className="text-sm text-slate-500">
        Cases submitted to GDB. Pick a row to open the case.
      </p>

      <section
        aria-label="Filters"
        className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]">
          <label className="block text-xs font-medium text-slate-500">
            Search
            <span className="relative mt-1 block">
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="9" cy="9" r="6" />
                <path d="m14 14 4 4" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Name, business, application ID, e-ID, National ID or TIN"
                className={`${FIELD} pl-8`}
              />
            </span>
          </label>
          <FilterSelect
            label="Product"
            value={filters.product ?? ""}
            onChange={(v) => update({ product: v })}
            options={Object.entries(PRODUCT_LABEL)}
          />
          <FilterSelect
            label="Business"
            value={filters.business_stage ?? ""}
            onChange={(v) => update({ business_stage: v })}
            options={Object.entries(STAGE_LABEL)}
          />
          <FilterSelect
            label="Evidence"
            value={filters.evidence ?? ""}
            onChange={(v) => update({ evidence: v })}
            options={Object.entries(EVIDENCE_LABEL)}
          />
          <FilterSelect
            label="Loan Officer"
            value={filters.officer_review ?? ""}
            onChange={(v) => update({ officer_review: v })}
            options={Object.entries(OFFICER_REVIEW_LABEL)}
          />
          <FilterSelect
            label="Employment"
            value={filters.employment ?? ""}
            onChange={(v) => update({ employment: v })}
            options={Object.entries(EMPLOYMENT_LABEL)}
          />
        </div>

        {showMore && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <AmountFilter
              label="Amount from (GYD)"
              value={filters.min_amount ?? ""}
              placeholder="0"
              onChange={(v) => update({ min_amount: v })}
            />
            <AmountFilter
              label="Amount up to (GYD)"
              value={filters.max_amount ?? ""}
              placeholder="Any"
              onChange={(v) => update({ max_amount: v })}
            />
            <label className="block text-xs font-medium text-slate-500">
              Submitted from
              <input
                type="date"
                value={filters.from_date ?? ""}
                max={filters.to_date || undefined}
                onChange={(e) => update({ from_date: e.target.value })}
                className={`${FIELD} mt-1`}
              />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              Submitted to
              <input
                type="date"
                value={filters.to_date ?? ""}
                min={filters.from_date || undefined}
                onChange={(e) => update({ to_date: e.target.value })}
                className={`${FIELD} mt-1`}
              />
            </label>
          </div>
        )}
        {(amountsBackwards || datesBackwards) && (
          <p className="mt-2 text-xs text-amber-700">
            {amountsBackwards ? "The lowest amount is above the highest, so nothing can match. " : ""}
            {datesBackwards ? "The start date is after the end date, so nothing can match." : ""}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="text-sm font-medium text-brand hover:underline"
          >
            {showMore ? "Hide amount and date filters" : "Amount and date filters"}
          </button>
          {active.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
              {active.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand"
                >
                  {chipLabel(k, filters[k]!)}
                  <button
                    type="button"
                    onClick={() => {
                      if (k === "search") setText("");
                      update({ [k]: "" });
                    }}
                    aria-label={`Remove filter ${chipLabel(k, filters[k]!)}`}
                    className="rounded-full px-1 leading-none hover:bg-brand/20"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={clearAll}
                className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-800"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      </section>

      <div className="mb-3 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={stage === t.id}
              onClick={() => setStage(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                stage === t.id
                  ? "bg-brand text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {t.label}
              {counts[t.id] ? (
                <span className="ml-1.5 opacity-80">{counts[t.id]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>
      )}
      {!error && !rows && <p className="text-slate-500">Loading queue…</p>}

      {rows && (
        <DataTable
          caption="Loan applications submitted to GDB"
          columns={[
            {
              key: "application",
              header: "Application",
              cell: (loan) => (
                <>
                  <Link
                    to={`/loans/${loan.name}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {loan.applicant_name}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {loan.business_name ? `${loan.business_name} · ` : ""}
                    {loan.name}
                  </span>
                  {Number(loan.sections?.requires_loan_officer_review ?? 0) ===
                    1 && (
                    <span className="mt-1 block">
                      <Badge tone="warning">Loan Officer review</Badge>
                    </span>
                  )}
                </>
              ),
            },
            {
              key: "eid",
              header: "e-ID",
              nowrap: true,
              className: "font-mono text-xs text-slate-500",
              cell: (loan) => loan.applicant_eid ?? "—",
            },
            {
              key: "product",
              header: "Product",
              nowrap: true,
              className: "text-slate-600",
              // Decided here like every loan; Quick Loans go through the same
              // offer, signing and payment as an SME loan.
              cell: (loan) =>
                loan.product === "quick" ? "Quick Loan" : "SME Loan",
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              className: "font-medium text-slate-900",
              cell: (loan) => (
                <>
                  {formatGyd(loan.loan_amount)}
                  {loan.approved_amount != null && (
                    <span className="block text-xs font-normal text-slate-500">
                      approved {formatGyd(loan.approved_amount)}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: "stage",
              header: "Stage",
              cell: (loan) => <StageBadge stage={loan.stage} />,
            },
            {
              key: "age",
              header: "Age",
              nowrap: true,
              className: "text-slate-600",
              cell: (loan) => (
                <span title={formatDate(stageSince(loan))}>
                  {formatAge(stageSince(loan))}
                </span>
              ),
            },
            {
              key: "evidence",
              header: "Evidence",
              cell: (loan) => {
                if (loan.evidence_missing === undefined)
                  return <span className="text-slate-400">—</span>;
                const n = loan.evidence_missing.length;
                return (
                  <Badge tone={n ? "warning" : "success"}>
                    {n ? `${n} missing` : "Complete"}
                  </Badge>
                );
              },
            },
          ]}
          rows={rows}
          rowKey={(loan) => loan.name}
          minWidth="58rem"
          footnote={false}
          empty={active.length ? "No cases match these filters." : "No cases here."}
        />
      )}
      {page && (
        <Pager
          start={start}
          pageLength={pageLength}
          total={page.total}
          onChange={setStart}
          pageSizes={PAGE_SIZES}
          onPageLength={(n) => update({ rows: n === PAGE_LENGTH ? "" : String(n) })}
        />
      )}
    </div>
  );
}
