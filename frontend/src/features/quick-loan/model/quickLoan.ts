import { isGuyanaPhone } from '../../../components/PhoneInput';
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
  /** The only terms, in months, a Quick Loan may be repaid over — ascending. */
  term_options: number[];
  /** The moratoria, in months, a borrower may choose from. */
  moratorium_options?: number[];
  rate_of_interest: number;
  trade_locations: string[];
  trading_since: string[];
}

/** `confirm` is the separate submit page after Review — not a step on the rail.
 *  There is no "About you" step: who is applying is already known (their
 *  account and profile) and shown as a card, and their identity document is
 *  the one on file. Business photos replace a separate proof step. */
export type QuickStepId = 'eligibility' | 'business' | 'loan' | 'bank' | 'review' | 'confirm';

/** The server opens a draft only once there is an amount, term and purpose, so
 *  business photos picked before Loan details wait in the page until it saves. */
export const QUICK_STEPS: { id: QuickStepId; title: string; blurb: string }[] = [
  { id: 'eligibility', title: 'Before you start', blurb: 'For small businesses' },
  { id: 'business', title: 'Business description', blurb: 'What your business does, where it is, and two people who know it.' },
  { id: 'loan', title: 'Loan details', blurb: 'GDB decides the approved amount.' },
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

/** Someone who knows the applicant and their trade, and how to reach them. */
export interface SupportContact {
  name: string;
  relationship: string;
  phone: string;
}

/** The payout account types (install.BANK_ACCOUNT_TYPES). */
export const ACCOUNT_TYPES = ['Checking', 'Savings'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const EMPTY_CONTACT: SupportContact = { name: '', relationship: '', phone: '' };

export interface QuickAnswers {
  /** "How would you like to apply?" — null until chosen. */
  how: 'self' | 'help' | null;
  /** From the profile; asked on the business step only when it is missing. */
  dob: string;
  phone: string;
  businessName: string;
  tradeActivity: string;
  region: string;
  tradingSince: string;
  tradeLocation: string;
  /** Where the business is, pinned on the map. */
  lat: number | null;
  lng: number | null;
  /** What the map search named, or the applicant's own description. */
  place: string;
  /** Business photos held — waiting to upload, or already on file. */
  photos: number;
  /** Exactly two, asked on the business step. */
  contacts: [SupportContact, SupportContact];
  amount: string;
  purpose: string;
  term: string;
  /** Months after release before the first instalment; '' until chosen. */
  moratorium: string;
  /** The applicant's own declaration, on the loan step. */
  residesInGuyana: boolean;
  bank: string;
  /** A GDB Bank Branch of `bank` (gdb_bank.api.bank_branches). */
  branch: string;
  accountType: AccountType | '';
  accountNo: string;
  /** Typed rather than picked from the accounts the switch knows about. */
  manualAccount: boolean;
  holder: string;
  confirmNo: string;
  /** Review's two statements (shared/consent.ts): the consent to collect and
   *  share information, credit bureaus included, and the false-information
   *  warning. Both are ticked before anything is submitted. */
  consentGiven: boolean;
  warningAcknowledged: boolean;
}

export const EMPTY_ANSWERS: QuickAnswers = {
  how: null,
  dob: '',
  phone: '',
  businessName: '',
  tradeActivity: '',
  region: '',
  tradingSince: '',
  tradeLocation: '',
  lat: null,
  lng: null,
  place: '',
  photos: 0,
  contacts: [EMPTY_CONTACT, EMPTY_CONTACT],
  amount: '',
  purpose: '',
  term: '6',
  moratorium: '',
  residesInGuyana: false,
  bank: '',
  branch: '',
  accountType: '',
  accountNo: '',
  manualAccount: false,
  holder: '',
  confirmNo: '',
  consentGiven: false,
  warningAcknowledged: false,
};

const digits = (s: string) => s.replace(/[\s-]/g, '');

/** The one thing stopping this step, in words about the applicant's own
 *  answer — or null when they may go on. */
export function blockerFor(step: QuickStepId, a: QuickAnswers, terms: QuickLoanTerms): string | null {
  switch (step) {
    case 'eligibility':
      if (!a.how) return 'Choose how you would like to apply.';
      return null;
    case 'business':
      if (!a.dob) return 'Enter your date of birth.';
      if (!a.tradeActivity.trim()) return 'Tell us what your business sells or does.';
      if (!a.region) return 'Choose the region you do business in.';
      if (!a.tradingSince) return 'Tell us how long you have been in business.';
      if (!a.tradeLocation) return 'Choose your business location.';
      if (a.lat == null || a.lng == null) return 'Pin your business on the map.';
      if (a.photos < 1) return 'Add at least one photo of your business.';
      for (const [i, c] of a.contacts.entries()) {
        const which = i === 0 ? 'first' : 'second';
        if (!c.name.trim()) return `Enter the name of your ${which} supporting contact.`;
        if (!c.relationship.trim()) return `Enter how your ${which} supporting contact knows you.`;
        // Seven digits after +592 — the server's rule too (services/application.py).
        if (!isGuyanaPhone(c.phone)) return `Enter a 7-digit phone number for your ${which} supporting contact.`;
      }
      return null;
    case 'loan': {
      const amount = Number(a.amount);
      if (!a.amount.trim() || !Number.isFinite(amount) || amount <= 0)
        return 'Enter how much you need — an amount greater than zero.';
      if (amount > terms.ceiling)
        return `Exceeds the ${gyd(terms.ceiling)} limit. Enter ${gyd(terms.ceiling)} or less.`;
      if (!a.purpose.trim()) return 'Tell us what the loan is for.';
      if (!terms.term_options.includes(Number(a.term))) return `Choose a term of ${termList(terms.term_options)} months.`;
      if (!(terms.moratorium_options ?? [1, 2, 3]).includes(Number(a.moratorium)))
        return 'Choose your moratorium — how long to wait before your first instalment.';
      if (!a.residesInGuyana) return 'Confirm you have been residing in Guyana for the last 12 months or more.';
      return null;
    }
    case 'bank':
      if (!a.bank || !a.accountNo.trim()) return 'Tell us the bank account GDB should pay you into.';
      if (!a.accountType) return 'Choose the type of account — Checking or Savings.';
      if (a.manualAccount) {
        if (!a.branch) return 'Choose your branch.';
        if (!a.holder.trim()) return 'Enter the account holder name.';
        if (digits(a.confirmNo) !== digits(a.accountNo)) return 'The account numbers do not match.';
      }
      return null;
    case 'confirm':
      return Object.values(confirmErrors(a))[0] ?? null;
    default:
      // Review only leads on to the submit page.
      return null;
  }
}

/** Review's two statements, each with its own message so each box can say
 *  what it is missing. */
export function confirmErrors(a: QuickAnswers): Partial<Record<'consentGiven' | 'warningAcknowledged', string>> {
  return {
    ...(a.consentGiven ? {} : { consentGiven: 'Give your consent to submit.' }),
    ...(a.warningAcknowledged ? {} : { warningAcknowledged: 'Confirm that you have read this statement.' }),
  };
}

/** "6, 12, 18 or 24" — the allowed terms as a sentence fragment. */
export function termList(options: number[]): string {
  return options.length > 1 ? `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}` : String(options[0] ?? '');
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
      trade_latitude: a.lat,
      trade_longitude: a.lng,
      trade_address: a.place.trim(),
      support_1_name: a.contacts[0].name.trim(),
      support_1_relationship: a.contacts[0].relationship.trim(),
      support_1_phone: a.contacts[0].phone.trim(),
      support_2_name: a.contacts[1].name.trim(),
      support_2_relationship: a.contacts[1].relationship.trim(),
      support_2_phone: a.contacts[1].phone.trim(),
      resides_in_guyana: a.residesInGuyana ? 1 : 0,
      moratorium_months: Number(a.moratorium) || 0,
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
    lat: loan.sections?.trade_latitude ? Number(loan.sections.trade_latitude) : null,
    lng: loan.sections?.trade_longitude ? Number(loan.sections.trade_longitude) : null,
    place: text('trade_address'),
    contacts: [1, 2].map((n) => ({
      name: text(`support_${n}_name`),
      relationship: text(`support_${n}_relationship`),
      phone: text(`support_${n}_phone`),
    })) as [SupportContact, SupportContact],
    residesInGuyana: Number(loan.sections?.resides_in_guyana ?? 0) === 1,
    amount: loan.loan_amount ? String(loan.loan_amount) : '',
    purpose: loan.purpose ?? '',
    term: loan.term_months ? String(loan.term_months) : EMPTY_ANSWERS.term,
    moratorium: Number(loan.sections?.moratorium_months) ? String(loan.sections?.moratorium_months) : '',
  };
}
