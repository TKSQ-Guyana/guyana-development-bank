import { useState } from "react";
import { moratoriumValue } from "../../shared/moratorium";
import { formatPhone } from "../../components/PhoneInput";
import { Link, useSearchParams } from "react-router-dom";
import { call } from "../../api";
import { useAuth } from "../../auth";
import { ApplicationSections } from "../../components/ApplicationSections";
import { DocumentShelf, docLabel } from "../../components/DocumentShelf";
import { InformationRequests } from "../../components/InformationRequests";
import { LoanAccount } from "../../components/LoanAccount";
import { OfferPanel } from "../../components/OfferPanel";
import { Notice } from "../../components/apply/fields";
import { Button } from "../../components/ui/Button";
import { Card, CardLabel } from "../../components/ui/Card";
import { Fold } from "../../components/ui/Fold";
import { StageBadge, Stepper } from "../../components/ui/Stepper";
import type { LoanApplication } from "../../types";
import { formatDate, formatGyd } from "../../utils";
import { YourPartCard } from "../personal-financials/YourPartCard";
import { CompleteApplication } from "./CompleteApplication";

/** The applicant's own case — or a group member's view of the head's — laid
 *  out by stage: what to act on now comes first, and once the application is
 *  sent it folds away underneath as reference. */
export function ApplicantCaseView({
  loan,
  backTo,
  onChange,
}: {
  loan: LoanApplication;
  backTo: string;
  /** Re-read the case after anything that can move its stage. */
  onChange: () => void;
}) {
  const { user } = useAuth();
  const [accountKey, setAccountKey] = useState(0);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opened from the list's Edit button: start in the edit panel.
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");

  const mine = loan.applicant === user?.user;
  const groupMember = Boolean(loan.cluster) && !mine;
  const { stage } = loan;
  const decided = stage === "Approved" || stage === "Rejected";
  // Submitted, with GDB and not yet decided: what was left out may be added.
  const canComplete = mine && !loan.cluster && stage === "Review";

  const refresh = () => {
    setAccountKey((k) => k + 1);
    onChange();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("gdb_bank.api.submit_application", { name: loan.name });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  const shelf = (
    <DocumentShelf
      key={`docs-${accountKey}`}
      application={loan.name}
      onChange={setMissing}
      title="Documents on this application"
      listOnly={stage !== "Draft"}
    />
  );
  const offer = (
    <OfferPanel
      key={`offer-${accountKey}`}
      application={loan.name}
      onExecuted={refresh}
    />
  );

  const product = loan.product === "quick" ? "Quick Loan" : "SME Direct Loan";
  const submittedOn =
    loan.submitted_on ?? (stage !== "Draft" ? loan.modified : null);

  return (
    <div className="space-y-5">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
      >
        ← Back to my applications
      </Link>

      {/* Which case this is and what it is for, at a glance. */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-[#071a3d] via-brand-dark to-brand text-white shadow-lg shadow-emerald-950/20">
        <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 px-6 pt-5 pb-4 sm:px-8">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-black/25 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
              {product}
            </span>
            <h1 className="mt-2 font-mono text-2xl font-black tracking-tight sm:text-3xl">
              {loan.name}
            </h1>
            <p className="mt-1 text-sm text-emerald-100">
              {loan.applicant_name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canComplete && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full border border-white/40 bg-white/10 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/20"
              >
                Edit
              </button>
            )}
            <span className="rounded-full bg-white/95 px-1 py-0.5 shadow-sm">
              <StageBadge stage={stage} />
            </span>
          </div>
        </div>
        <dl className="relative grid grid-cols-2 border-t border-white/10 bg-black/20 sm:grid-cols-4 sm:divide-x sm:divide-white/10">
          {[
            ["Amount requested", formatGyd(loan.loan_amount)],
            ["Term", `${loan.term_months} months`],
            [
              loan.monthly_repayment != null && stage !== "Draft"
                ? "Monthly repayment"
                : "Started",
              loan.monthly_repayment != null && stage !== "Draft"
                ? formatGyd(loan.monthly_repayment)
                : formatDate(loan.creation),
            ],
            ["Submitted", submittedOn ? formatDate(submittedOn) : "Not yet"],
          ].map(([k, v]) => (
            <div key={k} className="px-6 py-2.5 sm:px-8">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/90">
                {k}
              </dt>
              <dd className="text-base font-black tracking-tight">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Where it stands, and what happens next. */}
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-xs sm:px-8">
        <Stepper stage={stage} label={loan.stage_label} />
        <p className="mx-auto mt-3 max-w-2xl rounded-lg bg-slate-50 px-4 py-2 text-center text-xs text-slate-600">
          <b className="font-bold text-slate-800">What happens next:</b>{" "}
          {NEXT[stage]}
        </p>
      </section>

      {/* A Field Officer filled or submitted this with the applicant's consent:
          the applicant is always told which. */}
      {loan.submitted_by && loan.submitted_by !== loan.applicant ? (
        <Notice tone="info">
          Submitted for you by {loan.submitted_by_name ?? "a GDB Field Officer"}{" "}
          on {formatDate(loan.submitted_on ?? null)}.
        </Notice>
      ) : (
        loan.assisted_by_name && (
          <Notice tone="info">
            Prepared with {loan.assisted_by_name}, GDB Field Officer.
          </Notice>
        )
      )}

      {error && (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {groupMember && <YourPartCard application={loan.name} />}

          {canComplete && editing ? (
            <>
              <CompleteApplication
                application={loan.name}
                onSaved={refresh}
                onClose={() => setEditing(false)}
              />
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  As submitted — read only
                </p>
                <ApplicationDetails loan={loan} />
                {shelf}
              </div>
            </>
          ) : stage === "Draft" ? (
            <>
              {mine && (
                <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-5 py-4">
                  <div>
                    <p className="text-sm font-extrabold text-slate-900">
                      Not yet submitted
                    </p>
                    <p className="text-xs text-slate-600">
                      {missing && missing.length > 0
                        ? `You can submit now. GDB will ask for your ${missing.map(docLabel).join(", ")} during review.`
                        : "Everything GDB expects is attached. Submit when you are ready."}
                    </p>
                  </div>
                  <Button disabled={busy} onClick={() => void submit()}>
                    {busy ? "Submitting…" : "Submit application"}
                  </Button>
                </section>
              )}
              {mine && shelf}
              <ApplicationDetails loan={loan} />
            </>
          ) : (
            <>
              <InformationRequests
                key={`req-${accountKey}`}
                application={loan.name}
                onChange={refresh}
              />
              {stage === "Review" && mine && shelf}
              {decided && <Decision loan={loan} />}
              {/* A declined or lapsed offer stays readable beside the decision. */}
              {stage === "Approved" && loan.offer_status && offer}
              {stage === "Signing" && offer}
              {stage === "Disbursed" && (
                <>
                  <LoanAccount key={accountKey} application={loan.name} />
                  <Fold title="Letter of Offer">{offer}</Fold>
                </>
              )}

              <Fold title="Application details">
                <ApplicationDetails loan={loan} />
                {mine && stage !== "Review" && shelf}
                {!decided && loan.reviewed_on && <Decision loan={loan} />}
              </Fold>
            </>
          )}
        </div>

        <aside
          className="space-y-4 lg:sticky lg:top-24"
          aria-label="At a glance"
        >
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              At a glance
            </p>
            <dl className="space-y-2 text-sm">
              {[
                ["Product", product],
                ["Applicant", loan.applicant_name],
                loan.cluster ? ["Group", loan.cluster] : null,
                [
                  "Requested",
                  `${formatGyd(loan.loan_amount)} · ${loan.term_months} mo`,
                ],
                loan.approved_amount != null
                  ? [
                      "Approved",
                      `${formatGyd(loan.approved_amount)} · ${loan.approved_term} mo`,
                    ]
                  : null,
                loan.disbursed_amount > 0
                  ? ["Disbursed", formatGyd(loan.disbursed_amount)]
                  : null,
                ["Started", formatDate(loan.creation)],
              ]
                .filter((r): r is [string, string] => Boolean(r))
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-right font-bold text-slate-900">{v}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {mine && missing && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Documents
              </p>
              {missing.length === 0 ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-[11px]">
                    ✓
                  </span>
                  Everything GDB expects is on file
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {missing.map((m) => (
                    <li
                      key={m}
                      className="flex items-center gap-2 text-amber-800"
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-100 text-[11px] font-black">
                        !
                      </span>
                      {docLabel(m)} not on file yet
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <p className="px-1 text-xs text-slate-500">
            Questions about this application? Quote{" "}
            <span className="font-mono font-bold text-slate-700">
              {loan.name}
            </span>{" "}
            when you contact GDB.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** What happens next, in the applicant's words, for each stage. */
const NEXT: Record<LoanApplication["stage"], string> = {
  Draft:
    "Finish your application and submit it. Nothing is sent to GDB until you do.",
  Review:
    "A person at GDB is reviewing your application. If anything more is needed, a request will appear on this page.",
  Approved:
    "GDB has approved your loan. Read and accept your Letter of Offer to continue.",
  Signing:
    "Your Letter of Offer is with you to sign. Once it is signed, GDB books your loan.",
  Disbursed:
    "Your funds have been released. Your repayments and balance are shown here.",
  Rejected:
    "GDB did not approve this application. The reason, where given, is shown below.",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-slate-100 py-2.5">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold break-words text-slate-900">
        {value}
      </dd>
    </div>
  );
}

/** What was applied for. A group member is sent neither the head's phone nor
 *  income, and a group case has no single applicant income to show. */
function ApplicationDetails({ loan }: { loan: LoanApplication }) {
  return (
    <>
      <Card className="rounded-2xl! p-5!">
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <Row
            label="Applicant"
            value={
              <>
                {loan.applicant_name}
                <span className="ml-2 font-mono text-xs text-slate-500">
                  {loan.applicant_eid ?? "no e-ID on file"}
                </span>
              </>
            }
          />
          {loan.cluster && <Row label="Group" value={loan.cluster} />}
          <Row label="Amount requested" value={formatGyd(loan.loan_amount)} />
          <Row label="Term requested" value={`${loan.term_months} months`} />
          <Row
            label="Moratorium"
            value={moratoriumValue(
              Number(loan.sections?.moratorium_months ?? 0),
            )}
          />
          {loan.approved_amount != null && (
            <Row
              label="Approved by GDB"
              value={`${formatGyd(loan.approved_amount)} over ${loan.approved_term} months`}
            />
          )}
          {loan.disbursed_amount > 0 && (
            <Row label="Disbursed" value={formatGyd(loan.disbursed_amount)} />
          )}
          {loan.monthly_repayment != null && loan.stage !== "Draft" && (
            <Row
              label="Monthly repayment"
              value={formatGyd(loan.monthly_repayment)}
            />
          )}
          {loan.phone && <Row label="Phone" value={formatPhone(loan.phone)} />}
          <Row label="Started on" value={formatDate(loan.creation)} />
        </dl>
        <div className="pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Purpose
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">
            {loan.purpose}
          </p>
        </div>
      </Card>
      {loan.stage !== "Draft" && (
        <ApplicationSections
          sections={loan.sections}
          businessStage={loan.business_stage}
          useOfFunds={loan.use_of_funds ?? []}
          useOfFundsTotal={loan.use_of_funds_total}
        />
      )}
    </>
  );
}

/** GDB's credit decision, as the applicant is told it: no officer named. */
function Decision({ loan }: { loan: LoanApplication }) {
  return (
    <Card>
      <CardLabel>GDB decision</CardLabel>
      <p className="mt-1 font-semibold text-slate-900">
        {loan.status === "Rejected" ? "Not approved" : "Approved"}
        {loan.reviewed_on ? ` · ${formatDate(loan.reviewed_on)}` : ""}
      </p>
      {loan.underwriter_remarks && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
          {loan.underwriter_remarks}
        </p>
      )}
    </Card>
  );
}
