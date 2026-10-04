import { useCallback, useEffect, useState } from "react";
import { moratoriumValue } from "../shared/moratorium";
import { formatPhone } from "../components/PhoneInput";
import { Link, useParams } from "react-router-dom";
import { call } from "../api";
import { useAuth } from "../auth";
import { ApplicantProfile } from "../components/ApplicantProfile";
import { ClusterMembers } from "../components/ClusterMembers";
import { Conditions } from "../components/Conditions";
import { Disbursement } from "../components/Disbursement";
import { DocumentShelf } from "../components/DocumentShelf";
import { InformationRequests } from "../components/InformationRequests";
import { IssueOffer } from "../components/IssueOffer";
import { type Checklist, LoanChecklist } from "../components/LoanChecklist";
import { needsEid } from "../shared/eidNotice";
import { LoanAccount } from "../components/LoanAccount";
import { OfferPanel } from "../components/OfferPanel";
import { ApplicantCaseView } from "../features/applications/ApplicantCaseView";
import { ApplicationTab } from "../features/underwriting/ApplicationTab";
import { SectorClassification } from "../features/underwriting/SectorClassification";
import {
  DecisionDrawer,
  FieldTaskDrawer,
  RequestInfoDrawer,
} from "../features/underwriting/CaseDrawers";
import { fo } from "../features/field-officer/api";
import { FieldReports } from "../features/field-officer/FieldReports";
import type { FieldTask } from "../features/field-officer/types";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { StageBadge } from "../components/ui/Stepper";
import type { LoanApplication } from "../types";
import { formatGyd, formatDate } from "../utils";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** A left-rail card heading, with an optional badge on the right. */
function RailTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
      {aside}
    </div>
  );
}

/** A side-rail card: a titled white panel. */
function RailCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-black tracking-wider text-slate-400 uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STAFF_TABS = [
  { id: "application", label: "Application" },
  { id: "checks", label: "Credit risk" },
  { id: "offer", label: "Offer" },
  { id: "facility", label: "Facility" },
] as const;
type StaffTab = (typeof STAFF_TABS)[number]["id"];

/** A tab panel that stays mounted once its data is fetched, hidden with CSS
 *  rather than unmounted, so switching tabs never re-fetches and the left
 *  rail (which reads state a panel owns, like evidence completeness) stays
 *  accurate no matter which tab is on screen. */
function Panel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return <div className={active ? "space-y-4" : "hidden"}>{children}</div>;
}

export function LoanDetail() {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const [loan, setLoan] = useState<LoanApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server's list of expected documents not yet on file, handed up by the
  // shelf. Only ever displayed — it gates nothing, on either side of the desk.
  // null (not []) until the shelf answers, so the evidence card never claims
  // "complete" before it actually knows that.
  const [missing, setMissing] = useState<string[] | null>(null);
  // Bumped when the bank books, disburses or asks for something, so the
  // panels below remount and refetch instead of showing stale state.
  const [accountKey, setAccountKey] = useState(0);
  const [tab, setTab] = useState<StaffTab>("application");
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [asking, setAsking] = useState(false);
  const [fieldAsking, setFieldAsking] = useState(false);
  // Officer-observed evidence: site visits and reference checks on this case.
  const [fieldTasks, setFieldTasks] = useState<FieldTask[]>([]);

  const load = useCallback(() => {
    if (!name) return;
    call<LoanApplication>("gdb_bank.api.loan_detail", { name })
      .then(setLoan)
      .catch((err: Error) => setError(err.message));
  }, [name]);

  useEffect(load, [load]);

  const staffReader = Boolean(
    user?.is_underwriter || user?.is_finance || user?.is_disbursement,
  );
  useEffect(() => {
    if (!name || !staffReader) return;
    fo.tasksFor(name)
      .then(setFieldTasks)
      .catch(() => setFieldTasks([]));
  }, [name, staffReader, accountKey]);

  if (error && !loan)
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>
    );
  // The loan officer's checklist gates Approve — the server refuses an
  // approval before it is ready (services/checklist); the button says so first.
  // Above the loading return: a hook must run on every render.
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  useEffect(() => {
    if (!user?.is_underwriter || !name) return;
    call<Checklist>("gdb_bank.api.loan_checklist", { application: name })
      .then(setChecklist)
      .catch(() => setChecklist(null));
  }, [user?.is_underwriter, name, accountKey]);

  if (!loan) return <p className="text-slate-500">Loading…</p>;

  const reviewable = loan.status === "Submitted";
  // Every loan, Quick Loans included (2026-10-02): the underwriter decides, a
  // Letter of Offer is signed, and a different officer books and pays.
  const quick = loan.product === "quick";
  const underwriterDecides = Boolean(user?.is_underwriter) && reviewable;
  const trade = (key: string) => (loan.sections?.[key] as string | null) || "—";
  const mine = loan.applicant === user?.user;
  // NOT shared/personas.isStaff, and the difference is deliberate: that one
  // answers "is this a staff account?" for barring the citizen pages, and it
  // counts the Platform Admin. This asks who gets the CASE WORKSPACE, and the
  // Platform Admin is in none of the authority sets (utils/constants.py) —
  // every credit and money gate refuses it server-side, so handing it the
  // underwriter's workspace would draw controls that only answer with a
  // permission error.
  const staff = Boolean(
    user?.is_underwriter || user?.is_finance || user?.is_disbursement,
  );
  // A staff account applying for their own loan reads this the way any
  // citizen does — the dense case workspace below is for deciding SOMEBODY
  // ELSE's case, never a mirror held up to your own.
  const workspace = staff && !mine;
  const backTo = user?.is_underwriter
    ? "/review"
    : user?.is_disbursement
      ? "/disbursements"
      : "/apply";
  const backLabel = user?.is_underwriter
    ? "Queue"
    : user?.is_disbursement
      ? "Disbursements"
      : "Back";

  const bump = () => setAccountKey((k) => k + 1);

  const approveBlocked =
    underwriterDecides && checklist !== null && !checklist.ready;

  // The applicant's own case — or a group member reading the head's.
  if (!workspace) {
    return <ApplicantCaseView loan={loan} backTo={backTo} onChange={load} />;
  }

  // ------------------------------------------------------------------------
  // Staff case workspace — deciding somebody else's case. Header with the
  // decision actions, a sticky left rail (case facts, evidence, prior
  // decision) and a tabbed right column.
  // ------------------------------------------------------------------------
  const evidenceComplete = missing !== null && missing.length === 0;
  const canSeeFacility = Boolean(user?.is_finance || user?.is_disbursement);

  // Where the case stands, step by step — read from what the server says
  // happened, never from what the screen last did.
  const offer = loan.offer_status ?? null;
  const steps: { label: string; done: boolean; failed?: boolean }[] = [
    { label: "Submitted", done: loan.status !== "Draft" },
    {
      label: loan.status === "Rejected" ? "Declined" : "Credit risk",
      done: loan.status === "Approved" || loan.status === "Rejected",
      failed: loan.status === "Rejected",
    },
    { label: "Offer issued", done: Boolean(offer) },
    { label: "Signed", done: offer === "Accepted" },
    { label: "Booked", done: loan.sanctioned_amount != null },
    { label: "Released", done: loan.disbursed_amount > 0 },
  ];
  // A step a later one has already passed is skipped (a loan paid before
  // offers existed for its product) — not where the case stands.
  const skipped = (i: number) =>
    !steps[i].done && steps.slice(i + 1).some((st) => st.done);
  const at = steps.findIndex((st, i) => !st.done && !skipped(i));
  const moratorium = Number(loan.sections?.moratorium_months ?? 0);

  // The one thing to do next, and whose it is.
  const next: {
    text: string;
    go?: StaffTab;
    cta?: string;
    tone: "act" | "wait" | "done" | "stop";
  } =
    loan.status === "Draft"
      ? { text: "The applicant has not submitted yet.", tone: "wait" }
      : loan.status === "Rejected"
        ? {
            text: `Declined${loan.reviewed_on ? ` on ${formatDate(loan.reviewed_on)}` : ""}.`,
            tone: "stop",
          }
        : loan.status === "Submitted"
          ? user?.is_underwriter
            ? {
                text: "Review the application, the documents and any field reports — then approve or decline.",
                go: "checks",
                cta: "Check documents",
                tone: "act",
              }
            : { text: "Waiting for a loan officer's decision.", tone: "wait" }
          : // Approved: what happened last decides what comes next.
            loan.disbursed_amount > 0
            ? {
                text: `Funds released — ${formatGyd(loan.disbursed_amount)}.`,
                go: "facility",
                cta: "View facility",
                tone: "done",
              }
            : loan.sanctioned_amount != null
              ? user?.is_disbursement
                ? {
                    text: "Booked — release the funds.",
                    go: "facility",
                    cta: "Release funds",
                    tone: "act",
                  }
                : {
                    text: "Booked — waiting for the funds to be released.",
                    tone: "wait",
                  }
              : offer === "Accepted"
                ? user?.is_disbursement
                  ? {
                      text: "Signed — mark the conditions met, then book the loan.",
                      go: "facility",
                      cta: "Book the loan",
                      tone: "act",
                    }
                  : {
                      text: "Signed — with the disbursement officer to book.",
                      tone: "wait",
                    }
                : offer === "Issued"
                  ? {
                      text: "Waiting for the applicant to sign the Letter of Offer.",
                      go: "offer",
                      cta: "View offer",
                      tone: "wait",
                    }
                  : user?.is_underwriter
                    ? {
                        text: "Approved — issue the Letter of Offer.",
                        go: "offer",
                        cta: "Issue offer",
                        tone: "act",
                      }
                    : {
                        text: "Approved — waiting for the Letter of Offer.",
                        tone: "wait",
                      };

  const NEXT_TONE = {
    act: "border-amber-300 bg-gradient-to-r from-amber-50 to-white",
    wait: "border-slate-200 bg-white",
    done: "border-emerald-200 bg-emerald-50/60",
    stop: "border-rose-200 bg-rose-50/60",
  } as const;

  const tabCount = (id: StaffTab): React.ReactNode =>
    id === "checks" && missing && missing.length > 0 ? (
      <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-black text-amber-700">
        {missing.length}
      </span>
    ) : id === "offer" && offer ? (
      <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">
        {offer}
      </span>
    ) : null;

  return (
    <div className="space-y-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
      >
        ← {backLabel}
      </Link>

      {/* ------------------------------------------------------------ the case */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#022c19] via-brand-dark to-brand text-white shadow-lg shadow-emerald-950/20">
        <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-400/40 bg-black/25 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-amber-300 uppercase">
                {quick ? "Quick Loan" : "SME Direct Loan"}
              </span>
              {loan.cluster && (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold">
                  Group {loan.cluster}
                </span>
              )}
              <span className="rounded-full bg-white/95 px-1 py-0.5">
                <StageBadge stage={loan.stage} />
              </span>
            </div>
            <h1 className="mt-2 truncate text-2xl font-black tracking-tight">
              {loan.applicant_name}
            </h1>
            <p className="mt-0.5 text-sm text-emerald-100">
              {[loan.business_name, loan.name].filter(Boolean).join(" · ")}
              <span className="ml-2 font-mono text-xs text-emerald-200">
                {loan.applicant_eid ?? ""}
              </span>
            </p>
          </div>
          {user?.is_underwriter && (
            <div className="flex flex-wrap gap-2">
              {loan.status !== "Draft" && (
                <button
                  type="button"
                  onClick={() => setAsking(true)}
                  className="rounded-xl border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-bold text-white backdrop-blur hover:bg-white/20"
                >
                  Request info
                </button>
              )}
              {reviewable && (
                <button
                  type="button"
                  onClick={() => setFieldAsking(true)}
                  className="rounded-xl border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-bold text-white backdrop-blur hover:bg-white/20"
                >
                  Request field visit
                </button>
              )}
              {underwriterDecides && (
                <>
                  <button
                    type="button"
                    onClick={() => setDeciding("reject")}
                    className="rounded-xl border border-rose-300/60 bg-rose-500/20 px-3.5 py-2 text-sm font-bold text-white hover:bg-rose-500/35"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeciding("approve")}
                    disabled={approveBlocked}
                    title={
                      approveBlocked
                        ? `Complete the checklist first — waiting on ${checklist!.outstanding.join(", ")} (Credit risk tab).`
                        : undefined
                    }
                    className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-emerald-950 shadow-sm hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200/50 disabled:text-emerald-950/50"
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <dl className="relative grid grid-cols-2 border-t border-white/10 bg-black/20 sm:grid-cols-5 sm:divide-x sm:divide-white/10">
          {(
            [
              ["Requested", formatGyd(loan.loan_amount)],
              ["Term", `${loan.term_months} months`],
              ["Moratorium", moratorium ? `${moratorium} mo` : "—"],
              [
                loan.approved_amount != null ? "Approved" : "Monthly",
                loan.approved_amount != null
                  ? formatGyd(loan.approved_amount)
                  : loan.monthly_repayment != null
                    ? formatGyd(loan.monthly_repayment)
                    : "—",
              ],
              ["Submitted", formatDate(loan.submitted_on ?? loan.creation)],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="px-6 py-2.5">
              <dt className="text-[10px] font-bold tracking-wider text-emerald-200/90 uppercase">
                {k}
              </dt>
              <dd className="text-base font-black tracking-tight">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------- where it stands */}
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
        <ol className="flex items-center" aria-label="Case progress">
          {steps.map((st, i) => (
            <li
              key={st.label}
              className="flex flex-1 items-center last:flex-none"
            >
              <div className="flex flex-col items-center gap-1">
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-black ${
                    st.failed
                      ? "bg-rose-600 text-white"
                      : st.done
                        ? "bg-brand text-white"
                        : i === at
                          ? "bg-brand-dark text-amber-300 ring-4 ring-emerald-100"
                          : "border-2 border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  {st.failed ? "✕" : st.done ? "✓" : skipped(i) ? "–" : i + 1}
                </span>
                <span
                  className={`text-center text-[11px] leading-tight font-semibold ${
                    i === at
                      ? "text-brand-dark"
                      : st.done
                        ? "text-slate-600"
                        : "text-slate-400"
                  }`}
                >
                  {st.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span
                  className={`mx-1 mb-5 h-[3px] flex-1 rounded-full ${st.done ? "bg-brand" : "bg-slate-200"}`}
                />
              )}
            </li>
          ))}
        </ol>
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 ${NEXT_TONE[next.tone]}`}
        >
          <p className="text-sm text-slate-800">
            <b className="font-extrabold">Next: </b>
            {next.text}
          </p>
          {next.go && next.cta && (
            <button
              type="button"
              onClick={() => setTab(next.go!)}
              className="rounded-lg bg-brand-dark px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#022c19]"
            >
              {next.cta} →
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        {/* ---------------------------------------------------- LEFT: case at a glance */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <RailCard title="Loan facts">
            <dl className="divide-y divide-slate-100">
              <Row
                label="Requested"
                value={`${formatGyd(loan.loan_amount)} · ${loan.term_months} mo`}
              />
              {loan.approved_amount != null && (
                <Row
                  label="Offered"
                  value={`${formatGyd(loan.approved_amount)} · ${loan.approved_term} mo`}
                />
              )}
              {loan.sanctioned_amount != null && (
                <Row
                  label="Booked"
                  value={
                    loan.booked_on_offer === false ? (
                      <span className="text-rose-700">
                        {formatGyd(loan.sanctioned_amount)} — not the offer
                      </span>
                    ) : (
                      formatGyd(loan.sanctioned_amount)
                    )
                  }
                />
              )}
              {loan.disbursed_amount > 0 && (
                <Row
                  label="Disbursed"
                  value={formatGyd(loan.disbursed_amount)}
                />
              )}
              {loan.monthly_repayment != null && (
                <Row
                  label="Monthly"
                  value={formatGyd(loan.monthly_repayment)}
                />
              )}
              <Row label="Moratorium" value={moratoriumValue(moratorium)} />
              {quick ? (
                <>
                  <Row label="Location" value={trade("trade_location")} />
                  <Row label="In business" value={trade("trading_since")} />
                  <Row
                    label="Terms accepted"
                    value={
                      loan.terms_accepted_on
                        ? formatDate(loan.terms_accepted_on)
                        : "—"
                    }
                  />
                </>
              ) : (
                <>
                  <Row label="Business" value={loan.business_stage || "—"} />
                  <Row label="DCRA #" value={loan.dcra_number || "—"} />
                </>
              )}
              <Row
                label="Phone"
                value={loan.phone ? formatPhone(loan.phone) : "—"}
              />
              {loan.assisted_by_name && (
                <Row label="Assisted by" value={loan.assisted_by_name} />
              )}
              {loan.submitted_by && loan.submitted_by !== loan.applicant && (
                <Row
                  label="Submitted by"
                  value={loan.submitted_by_name ?? loan.submitted_by}
                />
              )}
            </dl>
            {loan.purpose && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Purpose
                </p>
                <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-800">
                  {loan.purpose}
                </p>
              </div>
            )}
          </RailCard>

          <RailCard
            title="Evidence"
            aside={
              missing === null ? (
                <span className="text-xs text-slate-400">Checking…</span>
              ) : (
                <Badge tone={evidenceComplete ? "success" : "warning"}>
                  {evidenceComplete
                    ? "Complete"
                    : `${missing.length} outstanding`}
                </Badge>
              )
            }
          >
            {missing && missing.length > 0 ? (
              <ul className="space-y-1.5">
                {missing.map((m) => (
                  <li
                    key={m}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-amber-100 text-[10px] font-black text-amber-700">
                      !
                    </span>
                    {m}
                  </li>
                ))}
              </ul>
            ) : evidenceComplete ? (
              <p className="flex items-center gap-2 text-sm text-emerald-800">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-[11px]">
                  ✓
                </span>
                Everything expected is on file
              </p>
            ) : null}
          </RailCard>

          {fieldTasks.length > 0 && (
            <RailCard
              title="Field verification"
              aside={
                <Badge
                  tone={
                    fieldTasks.every(
                      (t) =>
                        t.status === "Submitted" || t.status === "Cancelled",
                    )
                      ? "success"
                      : "warning"
                  }
                >
                  {fieldTasks.filter((t) => t.status === "Submitted").length} of{" "}
                  {fieldTasks.filter((t) => t.status !== "Cancelled").length}{" "}
                  reported
                </Badge>
              }
            >
              <dl className="divide-y divide-slate-100">
                {fieldTasks.map((t) => (
                  <Row key={t.name} label={t.kind} value={t.status} />
                ))}
              </dl>
            </RailCard>
          )}

          {(loan.underwriter_remarks || loan.reviewed_by) && (
            <RailCard title="Decision">
              {loan.underwriter_remarks && (
                <p className="text-sm whitespace-pre-wrap text-slate-700">
                  {loan.underwriter_remarks}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                <span className="normal-case">{loan.reviewed_by}</span> ·{" "}
                {formatDate(loan.reviewed_on)}
              </p>
            </RailCard>
          )}
        </div>

        {/* ---------------------------------------------------------- RIGHT: tabs */}
        <div className="min-w-0 space-y-4">
          <div
            className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
            role="tablist"
          >
            {STAFF_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-bold transition-all ${
                  tab === t.id
                    ? "bg-white text-brand-dark shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
                {tabCount(t.id)}
              </button>
            ))}
          </div>

          <Panel active={tab === "application"}>
            {quick ? (
              <Card>
                <RailTitle>Business</RailTitle>
                <Row label="Business name" value={loan.business_name || "—"} />
                <Row label="Region" value={trade("trade_region")} />
                <Row
                  label="Moratorium"
                  value={moratoriumValue(
                    Number(loan.sections?.moratorium_months ?? 0),
                  )}
                />
                <Row
                  label="What the business sells or does"
                  value={trade("trade_activity")}
                />
                <Row
                  label="Business location"
                  value={trade("trade_location")}
                />
                <Row label="In business" value={trade("trading_since")} />
                <Row
                  label="Lives in Guyana"
                  value={
                    Number(loan.sections?.resides_in_guyana ?? 0) === 1
                      ? "Yes (declared)"
                      : "Not declared"
                  }
                />
                {[1, 2].map((n) => (
                  <Row
                    key={n}
                    label={`Supporting contact ${n}`}
                    value={
                      loan.sections?.[`support_${n}_name`]
                        ? `${trade(`support_${n}_name`)} · ${trade(`support_${n}_relationship`)} · ${formatPhone(trade(`support_${n}_phone`))}`
                        : "—"
                    }
                  />
                ))}
                <RailTitle>Applicant</RailTitle>
                {Number(loan.sections?.requires_loan_officer_review ?? 0) ===
                  1 && (
                  <div className="my-2">
                    <Badge tone="warning">
                      Loan Officer review — public servant earning $250,000 or
                      more a month
                    </Badge>
                  </div>
                )}
                <Row label="E-ID" value={trade("applicant_eid")} />
                <Row
                  label="Employed in public service"
                  value={trade("public_service_employed")}
                />
                {loan.sections?.public_service_employed === "Yes" && (
                  <>
                    <Row
                      label="Ministry or agency"
                      value={trade("public_service_ministry")}
                    />
                    <Row
                      label="Making less than $250,000 a month"
                      value={trade("public_service_under_250k")}
                    />
                  </>
                )}
                <Row
                  label="Related to a GDB employee"
                  value={trade("related_to_gdb_employee")}
                />
                <Row
                  label="Bank account"
                  value={
                    Number(loan.sections?.no_bank_account ?? 0) === 1
                      ? "None — referred to the Help Desk"
                      : "Nominated (see Disbursement)"
                  }
                />
              </Card>
            ) : (
              <ApplicationTab loan={loan} />
            )}
          </Panel>

          <Panel active={tab === "checks"}>
            {/* What must be in place before the disbursement officer can
                book — from submission, so it can be asked for during review. */}
            {loan.status !== "Draft" && name && (
              <LoanChecklist
                key={`checklist-${accountKey}`}
                application={name}
                canRequest={Boolean(user?.is_underwriter)}
                onChange={bump}
              />
            )}
            {loan.status !== "Draft" && (
              <SectorClassification loan={loan} onSaved={() => void load()} />
            )}
            <ApplicantProfile user={loan.applicant} />
            {loan.cluster && name && (
              <ClusterMembers cluster={loan.cluster} application={name} />
            )}
            {name && (
              <DocumentShelf
                key={`docs-${accountKey}`}
                application={name}
                onChange={setMissing}
                title="Documents"
              />
            )}
            {name && loan.status !== "Draft" && (
              <InformationRequests
                key={`req-${accountKey}`}
                application={name}
                applicantEid={loan.applicant_eid}
                onChange={bump}
              />
            )}
            {loan.status !== "Draft" && (
              <FieldReports
                tasks={fieldTasks}
                onCancel={
                  user?.is_underwriter
                    ? (t) => {
                        const reason = window.prompt(
                          `Cancel the ${t.kind.toLowerCase()}? Reason:`,
                        );
                        if (reason?.trim())
                          void fo
                            .cancelTask(t.name, reason)
                            .then(bump)
                            .catch((err: Error) => setError(err.message));
                      }
                    : undefined
                }
              />
            )}
          </Panel>

          <Panel active={tab === "offer"}>
            {loan.status === "Approved" && name ? (
              <>
                {user?.is_underwriter && (
                  <IssueOffer
                    application={name}
                    onIssued={bump}
                    defaultAmount={loan.loan_amount}
                    defaultTerm={loan.term_months}
                    needsEid={needsEid(loan.applicant_eid)}
                  />
                )}
                <OfferPanel
                  key={`offer-${accountKey}`}
                  application={name}
                  onExecuted={bump}
                />
                <Conditions
                  key={`cp-${accountKey}`}
                  application={name}
                  onChange={bump}
                />
              </>
            ) : (
              <Card>
                <p className="text-sm text-slate-500">
                  Available once the case is approved.
                </p>
              </Card>
            )}
          </Panel>

          <Panel active={tab === "facility"}>
            {loan.status === "Approved" && name ? (
              <>
                <LoanChecklist
                  key={`checklist-f-${accountKey}`}
                  application={name}
                  canRequest={false}
                />
                <Disbursement application={name} onChange={bump} />
                {canSeeFacility && (
                  <LoanAccount
                    key={accountKey}
                    application={name}
                    canPay={false}
                  />
                )}
              </>
            ) : (
              <Card>
                <p className="text-sm text-slate-500">
                  Booking and release open once the case is approved.
                </p>
              </Card>
            )}
          </Panel>
        </div>
      </div>

      <DecisionDrawer
        loan={loan}
        action={deciding}
        onClose={() => setDeciding(null)}
        onDecided={(updated) => {
          setLoan(updated);
          setDeciding(null);
          // An approval is followed by the Letter of Offer — take them there.
          if (updated.status === "Approved") setTab("offer");
        }}
      />
      {name && (
        <FieldTaskDrawer
          application={name}
          open={fieldAsking}
          onClose={() => setFieldAsking(false)}
          onSent={bump}
        />
      )}
      {name && (
        <RequestInfoDrawer
          application={name}
          applicantEid={loan?.applicant_eid}
          open={asking}
          onClose={() => setAsking(false)}
          onSent={bump}
        />
      )}
    </div>
  );
}
