import type { LoanApplication } from '../../../types';

/** Money as the Quick Loan screens state it: "GYD 300,000". */
export const gyd = (n: number) => `GYD ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/** The Quick Loan — an informal trader's loan, applied for on its own short form.
 *
 *  This module is the form's rules and nothing else: which steps there are, what
 *  stops each one, and the shape sent to `gdb_bank.api.save_application`. No
 *  React, so every rule is testable on its own. None of it is the enforcement —
 *  the server refuses the same things for its own reasons (the ceiling is the
 *  Loan Product's, the term limit is policy) — it is what lets the applicant be
 *  told before a round trip, in words about THEIR answer. */

/** What the server says a Quick Loan is (`gdb_bank.api.quick_loan_terms`). The
 *  ceiling and term are read from there, never written into the bundle. */
export interface QuickLoanTerms {
  ceiling: number;
  max_term: number;
  rate_of_interest: number;
  trade_locations: string[];
  trading_since: string[];
}

/** `confirm` is the separate submit page after Review — not a step on the rail. */
export type QuickStepId = 'eligibility' | 'about' | 'business' | 'loan' | 'proof' | 'bank' | 'review' | 'confirm';

/** Loan details come BEFORE proof: a photo is filed against the application,
 *  and the server opens a draft only once there is an amount, term and purpose. */
export const QUICK_STEPS: { id: QuickStepId; title: string; blurb: string }[] = [
  { id: 'eligibility', title: 'Before you start', blurb: 'For small businesses' },
  { id: 'about', title: 'About you', blurb: 'Enter your details as they appear on your ID, and how GDB should contact you.' },
  { id: 'business', title: 'Business description', blurb: 'Tell us what your business does and where you do it.' },
  { id: 'loan', title: 'Loan details', blurb: 'GDB decides the approved amount.' },
  { id: 'proof', title: 'Proof of business', blurb: 'Show GDB that the business is running.' },
  {
    id: 'bank',
    title: 'Bank information',
    blurb: 'If your loan is approved, payment goes through the Ministry of Finance to this account. It must be in your name.',
  },
  { id: 'review', title: 'Review', blurb: 'Review your application' },
];

/** The steps on the rail. "Before you start" is its own page ahead of them. */
export const RAIL_STEPS = QUICK_STEPS.filter((s) => s.id !== 'eligibility');

/** The field officer request form's closed choices, from the prototype. */
export const BUSINESS_TYPES = ['Market vendor', 'Small service', 'Home-based business', 'Mobile trade', 'Something else'];
export const CALL_TIMES = ['Morning', 'Afternoon', 'Evening'];

export interface QuickAnswers {
  /** "How would you like to apply?" — null until chosen. */
  how: 'self' | 'help' | null;
  dob: string;
  nationalId: string;
  phone: string;
  youth: boolean;
  woman: boolean;
  businessName: string;
  tradeActivity: string;
  region: string;
  tradingSince: string;
  tradeLocation: string;
  amount: string;
  purpose: string;
  term: string;
  bank: string;
  accountNo: string;
  /** Typed rather than picked from the accounts the switch knows about. */
  manualAccount: boolean;
  holder: string;
  confirmNo: string;
  /** The submit page's three confirmations. */
  accurate: boolean;
  noGuarantee: boolean;
  creditConsent: boolean;
}

export const EMPTY_ANSWERS: QuickAnswers = {
  how: null,
  dob: '',
  nationalId: '',
  phone: '',
  youth: false,
  woman: false,
  businessName: '',
  tradeActivity: '',
  region: '',
  tradingSince: '',
  tradeLocation: '',
  amount: '',
  purpose: '',
  term: '6',
  bank: '',
  accountNo: '',
  manualAccount: false,
  holder: '',
  confirmNo: '',
  accurate: false,
  noGuarantee: false,
  creditConsent: false,
};

const digits = (s: string) => s.replace(/[\s-]/g, '');

/** The one thing stopping this step, in words about the applicant's own
 *  answer — or null when they may go on. */
export function blockerFor(step: QuickStepId, a: QuickAnswers, terms: QuickLoanTerms): string | null {
  switch (step) {
    case 'eligibility':
      if (!a.how) return 'Choose how you would like to apply.';
      return null;
    case 'about':
      if (!a.dob) return 'Enter your date of birth.';
      if (!a.nationalId.trim()) return 'Enter your national ID number.';
      return null;
    case 'business':
      if (!a.tradeActivity.trim()) return 'Tell us what your business sells or does.';
      if (!a.region) return 'Choose the region you do business in.';
      if (!a.tradingSince) return 'Tell us how long you have been in business.';
      if (!a.tradeLocation) return 'Choose your business location.';
      return null;
    case 'loan': {
      const amount = Number(a.amount);
      if (!a.amount.trim() || !Number.isFinite(amount) || amount <= 0)
        return 'Enter how much you need — an amount greater than zero.';
      if (amount > terms.ceiling)
        return `Exceeds the ${gyd(terms.ceiling)} limit. Enter ${gyd(terms.ceiling)} or less.`;
      if (!a.purpose.trim()) return 'Tell us what the loan is for.';
      const term = Number(a.term);
      if (!Number.isInteger(term) || term < 1 || term > terms.max_term) return `Choose 1–${terms.max_term} months.`;
      return null;
    }
    case 'bank':
      if (!a.bank || !a.accountNo.trim()) return 'Tell us the bank account GDB should pay you into.';
      if (a.manualAccount) {
        if (!a.holder.trim()) return 'Enter the account holder name.';
        if (digits(a.confirmNo) !== digits(a.accountNo)) return 'The account numbers do not match.';
      }
      return null;
    case 'confirm':
      return Object.values(confirmErrors(a))[0] ?? null;
    default:
      // Proof is advisory — a missing photo is the Bank's to ask for — and
      // Review only leads on to the submit page.
      return null;
  }
}

/** The submit page's three confirmations, each with its own message so each
 *  box can say what it is missing. */
export function confirmErrors(a: QuickAnswers): Partial<Record<'accurate' | 'noGuarantee' | 'creditConsent', string>> {
  return {
    ...(a.accurate ? {} : { accurate: 'Confirm that the information is accurate.' }),
    ...(a.noGuarantee ? {} : { noGuarantee: 'Confirm that you understand submission does not guarantee a loan.' }),
    ...(a.creditConsent ? {} : { creditConsent: 'Give your consent for the credit check to submit.' }),
  };
}

export function termOptions(maxTerm: number): number[] {
  return Array.from({ length: Math.max(0, maxTerm) }, (_, i) => i + 1);
}

/** The body for `gdb_bank.api.save_application`. `name` only once a draft exists. */
export function toSavePayload(a: QuickAnswers, name?: string) {
  return {
    ...(name ? { name } : {}),
    product: 'quick' as const,
    loan_amount: Number(a.amount),
    purpose: a.purpose.trim(),
    term_months: Number(a.term),
    phone: a.phone,
    business_name: a.businessName.trim(),
    sections: {
      trade_activity: a.tradeActivity.trim(),
      trade_region: a.region,
      trading_since: a.tradingSince,
      trade_location: a.tradeLocation,
      youth_entrepreneur: a.youth ? 1 : 0,
      woman_entrepreneur: a.woman ? 1 : 0,
    },
  };
}

/** A saved draft's answers, for resuming it. A draft exists only for someone
 *  who chose to apply themselves. */
export function fromDraft(loan: LoanApplication): Partial<QuickAnswers> {
  const text = (key: string) => {
    const value = loan.sections?.[key];
    return value == null ? '' : String(value);
  };
  return {
    how: 'self',
    phone: loan.phone ?? '',
    businessName: loan.business_name ?? '',
    tradeActivity: text('trade_activity'),
    region: text('trade_region'),
    tradingSince: text('trading_since'),
    tradeLocation: text('trade_location'),
    youth: Number(loan.sections?.youth_entrepreneur) === 1,
    woman: Number(loan.sections?.woman_entrepreneur) === 1,
    amount: loan.loan_amount ? String(loan.loan_amount) : '',
    purpose: loan.purpose ?? '',
    term: loan.term_months ? String(loan.term_months) : EMPTY_ANSWERS.term,
  };
}
