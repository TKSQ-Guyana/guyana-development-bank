/** How a moratorium reads to the borrower and to staff — one wording, used by
 *  the application forms, the Letter of Offer panel and the underwriting views.
 *
 *  A moratorium is chosen, always: 1, 2 or 3 months (utils/policy on the
 *  server). The first instalment then falls that many months after the usual
 *  one, a month after the funds are released. */

/** "2 months", for a chip or a summary; "Not chosen" before one is. */
export function moratoriumChoice(months: number): string {
  if (!months) return "None";
  return `${months} month${months === 1 ? "" : "s"}`;
}

/** When the first instalment falls, as a sentence. */
export function firstRepaymentLine(months: number): string {
  if (!months) return "Choose how long to wait before your first instalment.";
  return `A ${months}-month moratorium: your first instalment is due ${months + 1} months after the funds are released.`;
}

/** The short value for a summary row. */
export function moratoriumValue(months: number | null | undefined): string {
  const m = Number(months) || 0;
  return m ? `${m}-month moratorium` : "Not chosen";
}
