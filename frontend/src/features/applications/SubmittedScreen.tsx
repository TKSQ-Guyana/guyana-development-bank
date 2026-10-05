import { Panel, QButton, SectionTitle } from "../../components/portal/ui";
import { CheckIcon } from "../../components/ui/icons";

/** "Application submitted" — one screen for both loans (GDB, 2026-10-05: the
 *  SME Direct Loan follows the Quick Loan's). The reference, what was asked
 *  for, and what happens next. */
export function SubmittedScreen({
  reference,
  product,
  detail,
  submittedAt,
  onView,
  onApplications,
}: {
  reference: string;
  /** "Quick Loan" or "SME Direct Loan" — the label over `detail`. */
  product: string;
  /** "GYD 150,000 · 6 months". */
  detail: string;
  submittedAt: Date | null;
  onView: () => void;
  onApplications: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-[#022c19] via-brand-dark to-brand p-7 text-white shadow-xl shadow-emerald-950/20 sm:p-9">
        <div className="gdb-arrowhead pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-amber-400 text-emerald-950 shadow-lg ring-8 ring-amber-400/20">
            <CheckIcon className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
            Application submitted
          </h1>
          <p className="mt-2 max-w-xl text-emerald-100">
            Your application has been submitted for GDB review.
          </p>
          <dl className="mt-6 grid gap-4 rounded-2xl bg-black/20 p-4 backdrop-blur-xs sm:grid-cols-3">
            {[
              ["Reference", reference],
              [product, detail],
              ["Submitted", submittedAt ? stamp(submittedAt) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="border-l-2 border-amber-400/80 pl-3">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                  {k}
                </dt>
                <dd className="mt-0.5 font-mono text-sm font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-emerald-200">
            Keep your reference when contacting GDB.
          </p>
        </div>
      </section>
      <Panel>
        <SectionTitle>What happens next</SectionTitle>
        <ol className="relative ml-3 flex flex-col gap-5 border-l-2 border-slate-200 pl-6">
          {[
            ["Submitted", "Your application and documents are with GDB.", true],
            [
              "In review",
              "A member of the GDB team reviews your application. If more information is required, you will receive a request explaining what to provide.",
              false,
            ],
            [
              "Loan agreement and disbursement",
              "If approved, you accept and sign your Letter of Offer in the portal, and the loan is paid into your bank account.",
              false,
            ],
            [
              "Active",
              "Your loan is running. Repay each instalment on time — you can see your schedule and payments in the portal.",
              false,
            ],
          ].map(([t, d, done]) => (
            <li key={String(t)} className="relative">
              <span
                className={`absolute -left-[35px] grid h-6 w-6 place-items-center rounded-full border-2 ${
                  done
                    ? "border-brand bg-brand text-white"
                    : "border-slate-300 bg-white"
                }`}
              >
                {done && <CheckIcon className="h-3.5 w-3.5" />}
              </span>
              <b className="text-sm font-extrabold text-slate-900">{t}</b>
              <p className="text-[13px] text-slate-500">{d}</p>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
          <QButton onClick={onView} next>
            View submitted application
          </QButton>
          <QButton kind="secondary" onClick={onApplications}>
            My applications
          </QButton>
        </div>
      </Panel>
    </div>
  );
}

/** "5 Oct 2026, 10:42" — when it went in. */
function stamp(d: Date): string {
  const day = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}
