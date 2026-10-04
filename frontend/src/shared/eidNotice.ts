/** What an officer tells an applicant who has no e-ID on their account (they
 *  signed up with their National ID): pre-filled in the approval message and
 *  in the Letter of Offer's conditions — editable, never sent on its own. */
export const EID_NOTICE = "e-ID is required within the next 90 days.";

/** True when the applicant has no e-ID on record. */
export const needsEid = (applicantEid: string | null | undefined) =>
  !(applicantEid ?? "").trim();

/** The information-request type that asks an applicant with no e-ID to get
 *  one (gdb_bank.services.evidence.EID_REQUEST). Answered with an Identity
 *  document of kind e-ID. */
export const EID_REQUEST = "e-ID";

/** What the request says when the officer has not written it themselves. */
export const EID_REQUEST_ITEM =
  "Please get your e-ID and send a copy of the card here, with its number. e-ID is required within the next 90 days.";

/** The request text after the officer picks `type`: the e-ID wording fills an
 *  empty box when "e-ID" is chosen, and comes back out when another type is —
 *  but only while it is untouched, so an officer's own words are never lost. */
export const eidItemFor = (type: string, item: string) => {
  if (type === EID_REQUEST) return item.trim() ? item : EID_REQUEST_ITEM;
  return item === EID_REQUEST_ITEM ? "" : item;
};
