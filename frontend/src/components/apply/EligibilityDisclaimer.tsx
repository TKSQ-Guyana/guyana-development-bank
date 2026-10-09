/** The loan eligibility disclaimer — one wording, shown where a citizen picks
 *  a loan (ChooseLoan) and again just before they submit (both loan forms).
 *  Presentation only: it states policy, it gates nothing. */
export const ELIGIBILITY_DISCLAIMER =
  "Meeting the eligibility criteria, or submitting an application, does not guarantee a loan. " +
  "GDB assesses every application on the information and documents provided and on its lending policy, " +
  "and decides whether to lend, how much and for how long. The information you give must be true and " +
  "complete; GDB may verify it and ask you for more.";

export function EligibilityDisclaimer({ className = "" }: { className?: string }) {
  return (
    <aside
      aria-label="Loan eligibility disclaimer"
      className={`rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 ${className}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Loan eligibility disclaimer
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        {ELIGIBILITY_DISCLAIMER}
      </p>
    </aside>
  );
}
