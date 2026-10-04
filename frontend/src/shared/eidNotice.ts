/** What an officer tells an applicant who has no e-ID on their account (they
 *  signed up with their National ID): pre-filled in the approval message and
 *  in the Letter of Offer's conditions — editable, never sent on its own. */
export const EID_NOTICE = "e-ID is required within the next 90 days.";

/** True when the applicant has no e-ID on record. */
export const needsEid = (applicantEid: string | null | undefined) =>
  !(applicantEid ?? "").trim();
