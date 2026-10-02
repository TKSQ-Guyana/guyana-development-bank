/** The two statements an applicant ticks on Review, word for word — the only
 *  consent either form asks. ONE copy, because the SME form and the Quick Loan
 *  both show them and must never show different wording. Ticking the first is
 *  what gdb_bank.profiles.record_consent records; when its text changes,
 *  profiles.CONSENT_VERSION on the server should change with it, so the record
 *  says which wording was agreed. */
export const CONSENT_TEXT =
  'I/We consent to the collection, use, sharing, and disclosure of my/our information, including the submission to and retrieval from credit bureaus, for credit assessment, account management, and other lawful business purposes.';

export const FALSE_INFORMATION_WARNING =
  'Any person who knowingly submits false, inaccurate, or misleading information, or attempts to create duplicate registrations, or provides any fraudulent documents, may be subject to investigation and prosecution in accordance with the Laws of Guyana.';

/** The heading over the two statements, on both forms. */
export const CONSENT_HEADING = 'Consent';
