/** Highest level of education — the options GDB Citizen Profile accepts
 *  (education_level). One list, for the application form and My details. */
export const EDUCATION_LEVELS = [
  "No formal education",
  "Primary",
  "Secondary (CSEC)",
  "Post-secondary / Technical (CAPE, TVET)",
  "Diploma / Associate degree",
  "Bachelor's degree",
  "Postgraduate degree",
];

/** How an existing debt stands (GDB Existing Debt Line.status). */
export const DEBT_STATUSES = [
  "Current",
  "In arrears",
  "Restructured",
  "Paid off",
];

export interface ExistingDebt {
  lender: string;
  amount: number;
  status: string;
}
