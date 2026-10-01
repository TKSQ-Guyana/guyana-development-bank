/** The applicant's consent, word for word. ONE copy, because the SME form and
 *  the Quick Loan start page both record the same consent
 *  (gdb_bank.profiles.record_consent) and must never show different wording
 *  for it. When this text changes, profiles.CONSENT_VERSION on the server
 *  should change with it, so the record says which wording was agreed. */
export const CONSENT_TEXT =
  'I/We consent to the collection, use, sharing, and disclosure of my/our information, including the submission to and retrieval from credit bureaus, for credit assessment, account management, and other lawful business purposes.';
