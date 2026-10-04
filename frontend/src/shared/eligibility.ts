import { useEffect, useState } from 'react';
import { call } from '../api';

/** One SME Loan and one Quick Loan at a time — gdb_bank.api.my_loan_eligibility.
 *  The server enforces it at save and submit; this lets the screens say so
 *  before anyone fills a form. */
export type ProductKey = 'standard' | 'quick';

export interface OpenCase {
  name: string;
  kind: 'draft' | 'review' | 'approved' | 'loan';
  loan?: string;
  loan_status?: string;
  loan_amount?: number;
}

export interface ProductEligibility {
  can_apply: boolean;
  open_case: OpenCase | null;
  message: string | null;
}

export type Eligibility = Record<ProductKey, ProductEligibility>;

/** Where the case standing in the way is opened: a draft to continue it,
 *  anything else to its page. */
export function openCaseLink(product: ProductKey, c: OpenCase): { to: string; label: string } {
  if (c.kind === 'draft') {
    return { to: product === 'quick' ? `/apply/quick/${c.name}` : `/apply/${c.name}`, label: 'Continue your draft' };
  }
  return { to: `/loans/${c.name}`, label: c.kind === 'loan' ? 'View your loan' : 'View your application' };
}

/** null while loading; on a failed check, everything is allowed here — the
 *  server still refuses what it must. */
export function useEligibility(): Eligibility | null {
  const [value, setValue] = useState<Eligibility | null>(null);
  useEffect(() => {
    let live = true;
    call<Eligibility>('gdb_bank.api.my_loan_eligibility')
      .then((v) => live && setValue(v))
      .catch(() =>
        live &&
        setValue({
          standard: { can_apply: true, open_case: null, message: null },
          quick: { can_apply: true, open_case: null, message: null },
        }),
      );
    return () => {
      live = false;
    };
  }, []);
  return value;
}
