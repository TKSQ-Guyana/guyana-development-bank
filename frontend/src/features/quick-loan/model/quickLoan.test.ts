import { describe, expect, test } from 'vitest';
import { blockerFor, EMPTY_ANSWERS, fromDraft, needsOfficerReview, termList, toSavePayload, type QuickAnswers } from './quickLoan';
import type { QuickLoanTerms } from './quickLoan';
import type { LoanApplication } from '../../../types';

/** What the server says a Quick Loan is — the ceiling and term are its own. */
const TERMS: QuickLoanTerms = {
  ceiling: 300_000,
  max_term: 24,
  term_options: [6, 12, 18, 24],
  moratorium_options: [1, 2, 3],
  rate_of_interest: 0,
  trade_locations: ['From home', 'Other Locations - Fixed', 'Mobile'],
  trading_since: ['Less than 6 months', '6 months to 1 year', '1 to 3 years', 'More than 3 years'],
  industries: [
    { sector: 'Agriculture', sub_sectors: [{ name: 'Agriculture - Crop farming', label: 'Crop farming' }] },
    { sector: 'Poultry', sub_sectors: [] },
  ],
};

/** A market vendor who has answered everything. */
const VENDOR: QuickAnswers = {
  ...EMPTY_ANSWERS,
  how: 'self',
  dob: '1988-04-09',
  phone: '600 1234',
  hasEid: 'Yes',
  eid: '592-2001-0101',
  employed: 'No',
  businessName: 'Singh Fresh Greens',
  sector: 'Agriculture',
  subSector: 'Agriculture - Crop farming',
  tradeActivity: 'Sell vegetables',
  region: 'Region 3 — Essequibo Islands-West Demerara',
  tradingSince: '1 to 3 years',
  tradeLocation: 'Other Locations - Fixed',
  lat: 6.8013,
  lng: -58.1551,
  place: 'Stabroek Market, Georgetown',
  contacts: [
    { name: 'Asha Persaud', relationship: 'Neighbour', phone: '+592 600 1111' },
    { name: 'Devon Baksh', relationship: 'Supplier', phone: '600 2222' },
  ],
  amount: '150000',
  purpose: 'Buy more stock',
  term: '6',
  moratorium: '2',
  residesInGuyana: true,
  accountType: 'Savings',
  bank: 'Citizen Bank',
  branch: 'Citizen Bank - Main branch',
  accountNo: '0009111122223333',
  manualAccount: true,
  holder: 'Ravi Singh',
  confirmNo: '0009 1111 2222 3333',
  consentGiven: true,
};

describe('what stops each step', () => {
  test('a vendor who has answered everything is never stopped', () => {
    for (const step of ['eligibility', 'about', 'business', 'loan', 'bank', 'review', 'confirm'] as const) {
      expect(blockerFor(step, VENDOR, TERMS)).toBeNull();
    }
  });

  test('the applicant chooses how to apply', () => {
    expect(blockerFor('eligibility', { ...VENDOR, how: null }, TERMS)).toMatch(/how you would like to apply/i);
    expect(blockerFor('eligibility', { ...VENDOR, how: 'help' }, TERMS)).toBeNull();
  });

  test('a date of birth must be on file — About you asks only when it is missing', () => {
    expect(blockerFor('about', { ...VENDOR, dob: '' }, TERMS)).toMatch(/date of birth/i);
  });

  test('"Do you have an E-ID?" is asked; a No needs no number', () => {
    expect(blockerFor('about', { ...VENDOR, hasEid: '' }, TERMS)).toMatch(/have an E-ID/);
    expect(blockerFor('about', { ...VENDOR, hasEid: 'No', eid: '' }, TERMS)).toBeNull();
  });

  test('a Yes needs the E-ID as xxx-xxxx-xxxx', () => {
    expect(blockerFor('about', { ...VENDOR, eid: '' }, TERMS)).toBe('Enter your E-ID.');
    expect(blockerFor('about', { ...VENDOR, eid: '592-2001' }, TERMS)).toMatch(/xxx-xxxx-xxxx/);
  });

  test('employed: a Yes asks the category, the employer and the income', () => {
    expect(blockerFor('about', { ...VENDOR, employed: '' }, TERMS)).toMatch(/are employed/);
    const worker = { ...VENDOR, employed: 'Yes' as const };
    expect(blockerFor('about', worker, TERMS)).toMatch(/employer category/);
    expect(blockerFor('about', { ...worker, employerCategory: 'Private Sector' }, TERMS)).toMatch(/employer's name/);
    expect(
      blockerFor('about', { ...worker, employerCategory: 'Private Sector', employerName: 'Banks DIH' }, TERMS),
    ).toMatch(/monthly income/);
    expect(
      blockerFor(
        'about',
        { ...worker, employerCategory: 'Private Sector', employerName: 'Banks DIH', incomeBand: 'Above $500K' },
        TERMS,
      ),
    ).toBeNull();
  });

  test('a public-sector employee earning $200K or more never blocks — a Loan Officer reviews', () => {
    const servant = {
      ...VENDOR,
      employed: 'Yes' as const,
      employerCategory: 'Public Sector' as const,
      employerName: 'Ministry of Health',
      incomeBand: 'Between $200K and $500K',
    };
    expect(blockerFor('about', servant, TERMS)).toBeNull();
    expect(needsOfficerReview(servant)).toBe(true);
    expect(needsOfficerReview({ ...servant, incomeBand: 'Less than $200K' })).toBe(false);
    expect(needsOfficerReview({ ...servant, employerCategory: 'Private Sector' })).toBe(false);
    expect(needsOfficerReview(VENDOR)).toBe(false);
  });

  test('the industry and sub-sector are asked on the business step', () => {
    expect(blockerFor('business', { ...VENDOR, sector: '' }, TERMS)).toBe('Choose your industry.');
    expect(blockerFor('business', { ...VENDOR, subSector: '' }, TERMS)).toBe('Choose your sub-sector.');
    // An industry with no sub-sectors asks for none.
    expect(blockerFor('business', { ...VENDOR, sector: 'Poultry', subSector: '' }, TERMS)).toBeNull();
  });

  test('the business must be pinned on the map; no photos are asked for', () => {
    expect(blockerFor('business', { ...VENDOR, lat: null }, TERMS)).toBe('Pin your business on the map.');
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

  test('the loan needs a purpose and one of the allowed terms', () => {
    expect(blockerFor('loan', { ...VENDOR, purpose: ' ' }, TERMS)).toMatch(/what the loan is for/i);
    expect(blockerFor('loan', { ...VENDOR, term: '10' }, TERMS)).toBe('Choose a term of 6, 12, 18 or 24 months.');
    expect(blockerFor('loan', { ...VENDOR, term: '30' }, TERMS)).toMatch(/months/i);
    for (const term of ['6', '12', '18', '24']) expect(blockerFor('loan', { ...VENDOR, term }, TERMS)).toBeNull();
  });

  test('the business step needs both supporting contacts, each reachable', () => {
    const [first, second] = VENDOR.contacts;
    expect(blockerFor('business', { ...VENDOR, contacts: [{ ...first, name: '' }, second] }, TERMS)).toBe(
      'Enter the name of your first supporting contact.',
    );
    expect(blockerFor('business', { ...VENDOR, contacts: [first, { ...second, relationship: ' ' }] }, TERMS)).toBe(
      'Enter how your second supporting contact knows you.',
    );
    expect(blockerFor('business', { ...VENDOR, contacts: [first, { ...second, phone: '12' }] }, TERMS)).toMatch(
      /7-digit phone number for your second/,
    );
    expect(blockerFor('business', { ...VENDOR, contacts: [first, { ...second, phone: '9876543210' }] }, TERMS)).toMatch(
      /7-digit phone number for your second/,
    );
    expect(blockerFor('business', { ...VENDOR, contacts: [{ ...first, phone: '123 4567' }, second] }, TERMS)).toBeNull();
    expect(blockerFor('business', VENDOR, TERMS)).toBeNull();
  });

  test('the two supporting contacts have different numbers', () => {
    const [first, second] = VENDOR.contacts;
    expect(
      blockerFor('business', { ...VENDOR, contacts: [first, { ...second, phone: '600 1111' }] }, TERMS),
    ).toMatch(/different phone numbers/);
  });

  test('the moratorium is optional, but one chosen must be offered', () => {
    for (const moratorium of ['', '0']) expect(blockerFor('loan', { ...VENDOR, moratorium }, TERMS)).toBeNull();
    expect(blockerFor('loan', { ...VENDOR, moratorium: '4' }, TERMS)).toMatch(/moratorium/i);
    expect(blockerFor('loan', VENDOR, TERMS)).toBeNull();
  });

  test('the loan step needs the applicant to confirm they live in Guyana', () => {
    expect(blockerFor('loan', { ...VENDOR, residesInGuyana: false }, TERMS)).toBe('Confirm you have been residing in Guyana for the last 12 months or more.');
  });

  test('an applicant without a bank account is never stopped at the bank step', () => {
    expect(blockerFor('bank', { ...VENDOR, noBankAccount: true, bank: '', accountNo: '', accountType: '' }, TERMS)).toBeNull();
  });

  test('the bank step needs the type of account', () => {
    expect(blockerFor('bank', { ...VENDOR, accountType: '' }, TERMS)).toMatch(/Checking or Savings/);
  });

  test('a typed account needs a branch of its bank', () => {
    expect(blockerFor('bank', { ...VENDOR, branch: '' }, TERMS)).toBe('Choose your branch.');
    expect(blockerFor('bank', { ...VENDOR, manualAccount: false, branch: '' }, TERMS)).toBeNull();
  });

  test('a typed account needs its holder and the same number twice', () => {
    expect(blockerFor('bank', { ...VENDOR, accountNo: '' }, TERMS)).toMatch(/pay you/i);
    expect(blockerFor('bank', { ...VENDOR, holder: '' }, TERMS)).toMatch(/holder/i);
    expect(blockerFor('bank', { ...VENDOR, confirmNo: '0009111122223334' }, TERMS)).toMatch(/do not match/i);
    expect(blockerFor('bank', { ...VENDOR, manualAccount: false, holder: '', confirmNo: '' }, TERMS)).toBeNull();
  });

  test('the submit page needs all three confirmations', () => {
    expect(blockerFor('confirm', { ...VENDOR, consentGiven: false }, TERMS)).toMatch(/declaration/i);
  });
});

describe('the term choices', () => {
  test('are named the way a person says them', () => {
    expect(termList([6, 12, 18, 24])).toBe('6, 12, 18 or 24');
    expect(termList([12])).toBe('12');
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
        sector: 'Agriculture',
        sub_sector: 'Agriculture - Crop farming',
        trade_activity: 'Sell vegetables',
        trade_region: 'Region 3 — Essequibo Islands-West Demerara',
        trading_since: '1 to 3 years',
        trade_location: 'Other Locations - Fixed',
        support_1_name: 'Asha Persaud',
        support_1_relationship: 'Neighbour',
        support_1_phone: '+592 600 1111',
        support_2_name: 'Devon Baksh',
        support_2_relationship: 'Supplier',
        support_2_phone: '600 2222',
        resides_in_guyana: 1,
        moratorium_months: 2,
        trade_latitude: 6.8013,
        trade_longitude: -58.1551,
        trade_address: 'Stabroek Market, Georgetown',
        has_eid: 'Yes',
        applicant_eid: '592-2001-0101',
        employed: 'No',
        employer_category: '',
        employer_name: '',
        income_band: '',
        no_bank_account: 0,
      },
    });
  });

  test('the follow-ups are sent only with their Yes', () => {
    const no = toSavePayload({ ...VENDOR, hasEid: 'No', employerName: 'Ministry of Health' }).sections;
    expect(no.applicant_eid).toBe('');
    expect(no.employer_name).toBe('');
    const yes = toSavePayload({
      ...VENDOR,
      employed: 'Yes',
      employerCategory: 'Public Sector',
      employerName: ' Ministry of Health ',
      incomeBand: 'Above $500K',
    }).sections;
    expect(yes.employer_name).toBe('Ministry of Health');
    expect(yes.employer_category).toBe('Public Sector');
    expect(yes.income_band).toBe('Above $500K');
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
        support_1_name: 'Asha Persaud',
        support_1_relationship: 'Neighbour',
        support_1_phone: '+5926001111',
        moratorium_months: 2,
        resides_in_guyana: 1,
        applicant_eid: '592-2001-0101',
        employed: 'Yes',
        employer_category: 'Public Sector',
        employer_name: 'Ministry of Health',
        income_band: 'Above $500K',
        sector: 'Agriculture',
        sub_sector: 'Agriculture - Crop farming',
        no_bank_account: 1,
      },
    } as unknown as LoanApplication;
    expect(fromDraft(draft)).toMatchObject({
      how: 'self',
      businessName: 'Singh Fresh Greens',
      region: 'Region 3 — Essequibo Islands-West Demerara',
      tradeLocation: 'Mobile',
      tradingSince: '',
      amount: '150000',
      term: '6',
      moratorium: '2',
      residesInGuyana: true,
      hasEid: 'Yes',
      eid: '592-2001-0101',
      employed: 'Yes',
      employerCategory: 'Public Sector',
      employerName: 'Ministry of Health',
      incomeBand: 'Above $500K',
      sector: 'Agriculture',
      subSector: 'Agriculture - Crop farming',
      noBankAccount: true,
      contacts: [
        { name: 'Asha Persaud', relationship: 'Neighbour', phone: '+5926001111' },
        { name: '', relationship: '', phone: '' },
      ],
    });
  });
});
