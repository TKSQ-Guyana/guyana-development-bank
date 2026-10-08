import { describe, expect, test } from 'vitest';
import { personalLoanProblem, personalLoanRows, personalLoanSections } from './personalLoans';

const MORTGAGE = {
  has_mortgage: 'Yes',
  mortgage_bank: 'Republic Bank',
  mortgage_amount: '12000000',
  mortgage_start_date: '2021-03-01',
  mortgage_term_months: '240',
};
const AUTO_LOAN = {
  has_auto_loan: 'Yes',
  auto_loan_institution: 'Demerara Bank',
  auto_loan_amount: '3500000',
  auto_loan_start_date: '2024-07-15',
  auto_loan_term_months: '60',
};
const reader = (s: Record<string, string>) => (k: string) => s[k] ?? '';

describe('the mortgage and auto loan questions', () => {
  test('both must be answered', () => {
    expect(personalLoanProblem(reader({}))).toBe('Tell us whether you have a mortgage.');
    expect(personalLoanProblem(reader({ has_mortgage: 'No' }))).toBe(
      'Tell us whether you have an auto loan.',
    );
  });

  test('two No answers are complete', () => {
    expect(personalLoanProblem(reader({ has_mortgage: 'No', has_auto_loan: 'No' }))).toBeNull();
  });

  test('a Yes needs every detail', () => {
    expect(personalLoanProblem(reader({ ...MORTGAGE, mortgage_bank: ' ', has_auto_loan: 'No' }))).toBe(
      'Enter the mortgage bank name.',
    );
    expect(personalLoanProblem(reader({ ...MORTGAGE, mortgage_term_months: '', has_auto_loan: 'No' }))).toBe(
      'Enter the mortgage term in months.',
    );
    expect(personalLoanProblem(reader({ has_mortgage: 'No', ...AUTO_LOAN, auto_loan_amount: '' }))).toBe(
      'Enter the auto loan amount.',
    );
    expect(personalLoanProblem(reader({ ...MORTGAGE, ...AUTO_LOAN }))).toBeNull();
  });

  test('a submitted answer reads back as labelled rows', () => {
    const fmt = { money: (n: number) => `G$${n}`, date: (d: string) => `on ${d}` };
    expect(personalLoanRows(reader({ ...MORTGAGE, has_auto_loan: 'No' }), fmt)).toEqual([
      ['Mortgage', 'Yes'],
      ['Mortgage — Bank name', 'Republic Bank'],
      ['Mortgage — Loan amount', 'G$12000000'],
      ['Mortgage — Start date', 'on 2021-03-01'],
      ['Mortgage — Term', '240 months'],
      ['Auto loan', 'No'],
    ]);
  });

  test('an application from before the questions shows nothing', () => {
    const fmt = { money: String, date: String };
    expect(personalLoanRows(reader({}), fmt)).toEqual([]);
  });

  test('a No sends no details', () => {
    const sent = personalLoanSections(reader({ ...MORTGAGE, ...AUTO_LOAN, has_mortgage: 'No' }));
    expect(sent.mortgage_bank).toBe('');
    expect(sent.mortgage_term_months).toBe('');
    expect(sent.auto_loan_institution).toBe('Demerara Bank');
    expect(sent.auto_loan_term_months).toBe('60');
  });
});
