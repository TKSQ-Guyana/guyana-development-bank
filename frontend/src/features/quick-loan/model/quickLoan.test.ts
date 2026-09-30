import { describe, expect, test } from 'vitest';
import { blockerFor, EMPTY_ANSWERS, fromDraft, termOptions, toSavePayload, type QuickAnswers } from './quickLoan';
import type { QuickLoanTerms } from './quickLoan';
import type { LoanApplication } from '../../../types';

/** What the server says a Quick Loan is — the ceiling and term are its own. */
const TERMS: QuickLoanTerms = {
  ceiling: 300_000,
  max_term: 12,
  rate_of_interest: 0,
  trade_locations: ['From home', 'Fixed location', 'Mobile'],
  trading_since: ['Less than 6 months', '6 months to 1 year', '1 to 3 years', 'More than 3 years'],
};

/** A market vendor who has answered everything. */
const VENDOR: QuickAnswers = {
  ...EMPTY_ANSWERS,
  how: 'self',
  dob: '1988-04-09',
  nationalId: '778850',
  phone: '600 1234',
  woman: true,
  businessName: 'Singh Fresh Greens',
  tradeActivity: 'Sell vegetables',
  region: 'Region 3 — Essequibo Islands-West Demerara',
  tradingSince: '1 to 3 years',
  tradeLocation: 'Fixed location',
  amount: '150000',
  purpose: 'Buy more stock',
  term: '6',
  bank: 'Citizens Bank Guyana',
  accountNo: '0009111122223333',
  manualAccount: true,
  holder: 'Ravi Singh',
  confirmNo: '0009 1111 2222 3333',
  accurate: true,
  noGuarantee: true,
  creditConsent: true,
};

describe('what stops each step', () => {
  test('a vendor who has answered everything is never stopped', () => {
    for (const step of ['eligibility', 'about', 'business', 'loan', 'proof', 'bank', 'review', 'confirm'] as const) {
      expect(blockerFor(step, VENDOR, TERMS)).toBeNull();
    }
  });

  test('the applicant chooses how to apply', () => {
    expect(blockerFor('eligibility', { ...VENDOR, how: null }, TERMS)).toMatch(/how you would like to apply/i);
    expect(blockerFor('eligibility', { ...VENDOR, how: 'help' }, TERMS)).toBeNull();
  });

  test('date of birth and national ID are required', () => {
    expect(blockerFor('about', { ...VENDOR, dob: '' }, TERMS)).toMatch(/date of birth/i);
    expect(blockerFor('about', { ...VENDOR, nationalId: ' ' }, TERMS)).toMatch(/national ID/i);
  });

  test('what, region, how long and where are required; the business name is not', () => {
    expect(blockerFor('business', { ...VENDOR, tradeActivity: '  ' }, TERMS)).toMatch(/sells or does/i);
    expect(blockerFor('business', { ...VENDOR, region: '' }, TERMS)).toMatch(/region/i);
    expect(blockerFor('business', { ...VENDOR, tradingSince: '' }, TERMS)).toMatch(/how long/i);
    expect(blockerFor('business', { ...VENDOR, tradeLocation: '' }, TERMS)).toMatch(/business location/i);
    expect(blockerFor('business', { ...VENDOR, businessName: '' }, TERMS)).toBeNull();
  });

  test('the amount must be a positive figure no higher than the ceiling the server states', () => {
    for (const amount of ['', '0', '-5', 'lots']) {
      expect(blockerFor('loan', { ...VENDOR, amount }, TERMS)).toMatch(/how much/i);
    }
    expect(blockerFor('loan', { ...VENDOR, amount: '300000' }, TERMS)).toBeNull();
    expect(blockerFor('loan', { ...VENDOR, amount: '300001' }, TERMS)).toBe(
      'Exceeds the GYD 300,000 limit. Enter GYD 300,000 or less.',
    );
    expect(blockerFor('loan', { ...VENDOR, amount: '150000' }, { ...TERMS, ceiling: 100_000 })).toMatch(
      /GYD 100,000/,
    );
  });

  test('the loan needs a purpose and a term within the longest allowed', () => {
    expect(blockerFor('loan', { ...VENDOR, purpose: ' ' }, TERMS)).toMatch(/what the loan is for/i);
    expect(blockerFor('loan', { ...VENDOR, term: '13' }, TERMS)).toMatch(/months/i);
  });

  test('photos never stop an application — the underwriter asks for what is missing', () => {
    expect(blockerFor('proof', EMPTY_ANSWERS, TERMS)).toBeNull();
  });

  test('a typed account needs its holder and the same number twice', () => {
    expect(blockerFor('bank', { ...VENDOR, accountNo: '' }, TERMS)).toMatch(/pay you/i);
    expect(blockerFor('bank', { ...VENDOR, holder: '' }, TERMS)).toMatch(/holder/i);
    expect(blockerFor('bank', { ...VENDOR, confirmNo: '0009111122223334' }, TERMS)).toMatch(/do not match/i);
    expect(blockerFor('bank', { ...VENDOR, manualAccount: false, holder: '', confirmNo: '' }, TERMS)).toBeNull();
  });

  test('the submit page needs all three confirmations', () => {
    expect(blockerFor('confirm', { ...VENDOR, accurate: false }, TERMS)).toMatch(/accurate/i);
    expect(blockerFor('confirm', { ...VENDOR, noGuarantee: false }, TERMS)).toMatch(/guarantee/i);
    expect(blockerFor('confirm', { ...VENDOR, creditConsent: false }, TERMS)).toMatch(/credit check/i);
  });
});

describe('the term choices', () => {
  test('one to the longest term the server allows', () => {
    expect(termOptions(12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(termOptions(3)).toEqual([1, 2, 3]);
  });
});

describe('what is sent and read back', () => {
  test('the draft is filed as a quick loan with the business answers in its sections', () => {
    expect(toSavePayload(VENDOR, 'ACC-LOAP-2026-00009')).toEqual({
      name: 'ACC-LOAP-2026-00009',
      product: 'quick',
      loan_amount: 150000,
      purpose: 'Buy more stock',
      term_months: 6,
      phone: '600 1234',
      business_name: 'Singh Fresh Greens',
      sections: {
        trade_activity: 'Sell vegetables',
        trade_region: 'Region 3 — Essequibo Islands-West Demerara',
        trading_since: '1 to 3 years',
        trade_location: 'Fixed location',
        youth_entrepreneur: 0,
        woman_entrepreneur: 1,
      },
    });
  });

  test('a first save opens a draft rather than naming one', () => {
    expect(toSavePayload(VENDOR)).not.toHaveProperty('name');
  });

  test('a resumed draft fills the answers back in', () => {
    const draft = {
      name: 'ACC-LOAP-2026-00009',
      loan_amount: 150000,
      purpose: 'Buy more stock',
      term_months: 6,
      phone: '+5926001234',
      business_name: 'Singh Fresh Greens',
      sections: {
        trade_activity: 'Sell vegetables',
        trade_region: 'Region 3 — Essequibo Islands-West Demerara',
        trade_location: 'Mobile',
        trading_since: null,
        youth_entrepreneur: 1,
        woman_entrepreneur: 0,
      },
    } as unknown as LoanApplication;
    expect(fromDraft(draft)).toMatchObject({
      how: 'self',
      businessName: 'Singh Fresh Greens',
      region: 'Region 3 — Essequibo Islands-West Demerara',
      tradeLocation: 'Mobile',
      tradingSince: '',
      youth: true,
      woman: false,
      amount: '150000',
      term: '6',
    });
  });
});
