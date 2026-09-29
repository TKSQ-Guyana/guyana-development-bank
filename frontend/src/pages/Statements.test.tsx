/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

// The API is the page's only way out, so it is the one thing stood in for: the
// page is handed what loan_account answers and judged on what it shows.
vi.mock('../api', () => ({ call: vi.fn() }));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { full_name: 'Borrower', eid: '592-0000-0000' } }),
}));

import { call } from '../api';
import { Statements } from './Statements';

const FACILITY = {
  name: 'ACC-LOAP-TEST',
  stage: 'Disbursed',
  disbursed_amount: 120000,
  facility_amount: 120000,
};

/** loan_account's answer for a loan released at G$120,000 and paid G$10,000,
 *  as lending's Loan Statement of Account reports it. */
function account(transactions: unknown[]) {
  return {
    application: 'ACC-LOAP-TEST',
    loan: {
      name: 'ACC-LOAN-TEST',
      status: 'Disbursed',
      loan_amount: 120000,
      disbursed_amount: 120000,
      total_payment: 120000,
      total_amount_paid: 10000,
      total_principal_paid: 10000,
      monthly_repayment_amount: 10000,
      rate_of_interest: 0,
      repayment_periods: 12,
    },
    schedule: [],
    dues: { principal_outstanding: 110000, overdue_total_amount: 0, oldest_due_date: null },
    statement: {
      from_date: '2025-09-29',
      to_date: '2026-09-29',
      opening_balance: 0,
      closing_balance: 110000,
      instalments_due: 0,
      rows: [],
      transactions,
    },
  };
}

function showStatement(transactions: unknown[]) {
  vi.mocked(call).mockImplementation(async (method: string) =>
    method === 'gdb_bank.api.my_loans' ? [FACILITY] : account(transactions),
  );
  render(
    <MemoryRouter>
      <Statements />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(call).mockReset();
});

test('the statement lists every line lending reports, with its running balance', async () => {
  showStatement([
    {
      posting_date: '2026-09-28',
      transaction_type: 'Disbursement',
      transaction_doctype: 'Loan Disbursement',
      transaction_name: 'LM-DIS-00047',
      debit: 120000,
      credit: 0,
      balance: 120000,
      remarks: '',
    },
    {
      posting_date: '2026-09-28',
      transaction_type: 'Advance Payment',
      transaction_doctype: 'Loan Repayment',
      transaction_name: 'LM-REP-0037',
      debit: 0,
      credit: 10000,
      balance: 110000,
      remarks: 'Advance Payment (Principal: 10000.0)',
    },
  ]);

  const table = await screen.findByRole('table', { name: 'Transactions in this period' });
  const lines = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));

  expect(lines).toEqual([
    ['28 Sept 2026', 'Disbursement', 'LM-DIS-00047', 'G$120,000', 'G$0', 'G$120,000'],
    ['28 Sept 2026', 'Advance Payment', 'LM-REP-0037', 'G$0', 'G$10,000', 'G$110,000'],
  ]);
});

test('a period with nothing released or paid says so instead of showing an empty table', async () => {
  showStatement([]);

  expect(await screen.findByText(/Nothing was released or paid between/)).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Transactions in this period' })).toBeNull();
});
