/** The one statement an applicant ticks on Review, word for word — the only
 *  consent either form asks (GDB, 2026-10-05: it replaces the two earlier
 *  statements). ONE copy, because the SME form and the Quick Loan both show it
 *  and must never show different wording. Ticking it is what
 *  gdb_bank.profiles.record_consent records; when its text changes,
 *  profiles.CONSENT_VERSION on the server should change with it, so the record
 *  says which wording was agreed. */
export const CONSENT_TEXT =
  "I hereby confirm and declare that all information and statements provided herein are true, complete, and accurate to the best of my knowledge and belief, and that I have provided such information knowing that it will be relied upon in considering and assessing this application for financing. I understand and acknowledge that any false, inaccurate, incomplete, or misleading information or statement may result in my application being deemed ineligible for financing.";

/** The heading over the statement, on both forms. */
export const CONSENT_HEADING = "Consent";
