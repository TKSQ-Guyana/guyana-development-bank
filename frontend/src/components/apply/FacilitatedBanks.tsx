/** "I don't have a bank account": where to go for help.
 *
 *  The facilitated banks and their links are no longer listed to the applicant
 *  (GDB, 2026-10-05): the Help Desk helps them open an account. The desk's list
 *  (Bank > Facilitated for Applicants Without an Account) and
 *  gdb_bank.api.facilitated_bank_sites stay, for the Help Desk's own use. */
export function FacilitatedBanks() {
  return (
    <section
      aria-label="No bank account"
      className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-base font-extrabold text-amber-900">
        Please reach out to the Help Desk for assistance.
      </p>
      <p className="mt-1 text-sm text-amber-900/80">
        You can still continue with your application.
      </p>
    </section>
  );
}
