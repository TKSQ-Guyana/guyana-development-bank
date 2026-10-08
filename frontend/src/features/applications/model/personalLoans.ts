/** The SME applicant's own mortgage and auto loan, asked in Personal
 *  information (GDB, 2026-10-08). Each Yes/No question brings four details;
 *  a No carries none. The server holds the same rule
 *  (services/application._require_personal_loans) — this copy is what lets the
 *  form say so at the step instead of at submission. */

export type PersonalLoanDetail = {
  key: string;
  label: string;
  /** The label after the loan's title once submitted: "Mortgage — Bank name". */
  short: string;
  kind: "text" | "money" | "date" | "months";
};

export type PersonalLoan = {
  question: string;
  label: string;
  /** "Mortgage" — as the Review summary and the desk show it. */
  title: string;
  /** "a mortgage" — as the refusal reads. */
  noun: string;
  details: PersonalLoanDetail[];
};

export const PERSONAL_LOANS: PersonalLoan[] = [
  {
    question: "has_mortgage",
    label: "Do you have a Mortgage?",
    title: "Mortgage",
    noun: "a mortgage",
    details: [
      { key: "mortgage_bank", label: "Mortgage Bank Name", short: "Bank name", kind: "text" },
      { key: "mortgage_amount", label: "Loan Amount", short: "Loan amount", kind: "money" },
      { key: "mortgage_start_date", label: "Loan Start Date", short: "Start date", kind: "date" },
      { key: "mortgage_term_months", label: "Term (months)", short: "Term", kind: "months" },
    ],
  },
  {
    question: "has_auto_loan",
    label: "Do you have an Auto Loan?",
    title: "Auto loan",
    noun: "an auto loan",
    details: [
      { key: "auto_loan_institution", label: "Institution Name", short: "Institution name", kind: "text" },
      { key: "auto_loan_amount", label: "Loan Amount", short: "Loan amount", kind: "money" },
      { key: "auto_loan_start_date", label: "Loan Start Date", short: "Start date", kind: "date" },
      { key: "auto_loan_term_months", label: "Term (months)", short: "Term", kind: "months" },
    ],
  },
];

const MISSING: Record<string, string> = {
  mortgage_bank: "Enter the mortgage bank name.",
  mortgage_amount: "Enter the mortgage loan amount.",
  mortgage_start_date: "Enter the mortgage start date.",
  mortgage_term_months: "Enter the mortgage term in months.",
  auto_loan_institution: "Enter the auto loan institution name.",
  auto_loan_amount: "Enter the auto loan amount.",
  auto_loan_start_date: "Enter the auto loan start date.",
  auto_loan_term_months: "Enter the auto loan term in months.",
};

type Read = (key: string) => string;

const given = (raw: string, kind: PersonalLoanDetail["kind"]) =>
  kind === "money" || kind === "months" ? Number(raw) > 0 : raw.trim() !== "";

/** The first thing still unanswered, as the applicant should read it, or null. */
export function personalLoanProblem(text: Read): string | null {
  for (const loan of PERSONAL_LOANS) {
    const answer = text(loan.question);
    if (answer !== "Yes" && answer !== "No")
      return `Tell us whether you have ${loan.noun}.`;
    if (answer === "No") continue;
    const missing = loan.details.find((d) => !given(text(d.key), d.kind));
    if (missing) return MISSING[missing.key];
  }
  return null;
}

/** A submitted answer as labelled rows, for the applicant's case page and the
 *  staff Application tab. An unanswered question (an application from before
 *  2026-10-08) contributes nothing. */
export function personalLoanRows(
  text: Read,
  fmt: { money: (n: number) => string; date: (d: string) => string },
): [string, string][] {
  const rows: [string, string][] = [];
  for (const loan of PERSONAL_LOANS) {
    const answer = text(loan.question);
    if (answer !== "Yes" && answer !== "No") continue;
    rows.push([loan.title, answer]);
    if (answer !== "Yes") continue;
    for (const d of loan.details) {
      const raw = text(d.key);
      const value =
        d.kind === "money"
          ? fmt.money(Number(raw))
          : d.kind === "date"
            ? fmt.date(raw)
            : d.kind === "months"
              ? `${raw} months`
              : raw;
      rows.push([`${loan.title} — ${d.short}`, value]);
    }
  }
  return rows;
}

/** The details to save: as typed under a Yes, blank otherwise. */
export function personalLoanSections(text: Read): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loan of PERSONAL_LOANS) {
    const yes = text(loan.question) === "Yes";
    for (const d of loan.details)
      out[d.key] = yes ? text(d.key).trim() : "";
  }
  return out;
}
