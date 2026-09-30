import { describe, expect, test } from 'vitest';
import type { LoanAccount, LoanPayment, StatementLine } from '../../../types';
import { periods, summarise, toCsvRows, toLedgerEntries } from './ledger';

/** One line of lending's Loan Statement of Account. A release debits the loan
 *  account and a payment credits it, so exactly one of the two carries the
 *  amount — which is the property the mapper relies on. */
function line(over: Partial<StatementLine>): StatementLine {
  return {
    posting_date: '2026-10-07',
    transaction_type: 'Disbursement',
    transaction_doctype: 'Loan Disbursement',
    transaction_name: 'LM-DIS-0001',
    debit: 1_200_000,
    credit: 0,
    balance: 1_200_000,
    remarks: null,
    ...over,
  };
}

function payment(over: Partial<LoanPayment>): LoanPayment {
  return {
    name: 'LM-REP-0001',
    posting_date: '2026-11-07',
    amount_paid: 100_000,
    principal_amount_paid: 100_000,
    repayment_type: 'Normal Repayment',
    paid_by_name: null,
    paid_by_eid: null,
    ...over,
  };
}

describe('toLedgerEntries', () => {
  test('relays lending amounts and balances unchanged', () => {
    const [entry] = toLedgerEntries([line({ balance: 1_200_000 })]);

    expect(entry.amount).toBe(1_200_000);
    expect(entry.balance).toBe(1_200_000);
    expect(entry.kind).toBe('release');
    expect(entry.status).toBe('Released');
    expect(entry.description).toBe('Funds released');
  });

  test('takes the credit on a repayment, not the debit', () => {
    const [entry] = toLedgerEntries([
      line({
        transaction_doctype: 'Loan Repayment',
        transaction_name: 'LM-REP-0001',
        debit: 0,
        credit: 100_000,
        balance: 1_100_000,
      }),
    ]);

    expect(entry.amount).toBe(100_000);
    expect(entry.kind).toBe('payment');
    expect(entry.status).toBe('Settled');
  });

  test('joins the payer onto the ledger line by document name', () => {
    const [entry] = toLedgerEntries(
      [line({ transaction_doctype: 'Loan Repayment', transaction_name: 'LM-REP-0042', credit: 50_000, debit: 0 })],
      [payment({ name: 'LM-REP-0042', paid_by_name: 'Anisa Persaud', paid_by_eid: '592-1111-0001' })],
    );

    expect(entry.payer).toBe('Anisa Persaud');
    expect(entry.payerEid).toBe('592-1111-0001');
    expect(entry.channel).toBe('Portal payment');
    expect(entry.description).toBe('Instalment payment');
  });

  test('a receipt with no portal payer reads as a bank receipt, never a guess', () => {
    const [entry] = toLedgerEntries([
      line({ transaction_doctype: 'Loan Repayment', transaction_name: 'LM-REP-0099', credit: 50_000, debit: 0 }),
    ]);

    expect(entry.payer).toBeNull();
    expect(entry.channel).toBe('Bank receipt');
  });

  test('an unmapped repayment type falls through to lending wording', () => {
    const [entry] = toLedgerEntries(
      [line({ transaction_doctype: 'Loan Repayment', transaction_name: 'LM-REP-0007', credit: 1, debit: 0 })],
      [payment({ name: 'LM-REP-0007', repayment_type: 'Interest Carry Forward' })],
    );

    expect(entry.description).toBe('Interest Carry Forward');
  });

  test('orders newest first', () => {
    const entries = toLedgerEntries([
      line({ posting_date: '2026-10-07', transaction_name: 'a' }),
      line({ posting_date: '2026-12-07', transaction_name: 'b' }),
      line({ posting_date: '2026-11-07', transaction_name: 'c' }),
    ]);

    expect(entries.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('summarise', () => {
  const account = {
    application: 'ACC-LOAP-TEST',
    loan: { total_amount_paid: 200_000 },
    dues: { principal_outstanding: 1_000_000 },
    schedule: [
      { payment_date: '2026-12-07' },
      { payment_date: '2027-01-07' },
      { payment_date: '2027-02-07' },
    ],
  } as unknown as LoanAccount;

  test('reads the totals off lending rather than adding up the rows', () => {
    const entries = toLedgerEntries([
      line({ transaction_doctype: 'Loan Repayment', transaction_name: 'r1', credit: 100_000, debit: 0 }),
      line({ transaction_doctype: 'Loan Repayment', transaction_name: 'r2', credit: 100_000, debit: 0 }),
      line({ transaction_name: 'd1' }),
    ]);

    const summary = summarise(account, entries, new Date('2026-12-10'));

    expect(summary.totalRepaid).toBe(200_000);
    expect(summary.outstanding).toBe(1_000_000);
    // Releases are not payments: three ledger lines, two of them payments.
    expect(summary.paymentsRecorded).toBe(2);
  });

  test('next due is the first instalment on or after today', () => {
    expect(summarise(account, [], new Date('2026-12-10')).nextDue).toBe('2027-01-07');
  });

  test('next due is null once the schedule is behind us', () => {
    expect(summarise(account, [], new Date('2027-06-01')).nextDue).toBeNull();
  });

  test('an unbooked application summarises to nothing rather than to zero', () => {
    const summary = summarise(null, [], new Date('2026-12-10'));

    expect(summary.totalRepaid).toBeNull();
    expect(summary.outstanding).toBeNull();
    expect(summary.nextDue).toBeNull();
  });
});

describe('periods', () => {
  test('offers all, the last three months and the current year', () => {
    const [all, last3, year] = periods(new Date('2026-12-10'));

    expect(all.from).toBe('2020-01-01');
    expect(last3.from).toBe('2026-09-10');
    expect(year.from).toBe('2026-01-01');
    expect(year.label).toBe('2026');
    expect(all.to).toBe('2026-12-10');
  });
});

describe('toCsvRows', () => {
  test('exports raw numbers so a spreadsheet reads them as numbers', () => {
    const entries = toLedgerEntries([line({ balance: 1_200_000 })]);
    const [row] = toCsvRows(entries);

    expect(row[5]).toBe(1_200_000);
    expect(row[6]).toBe(1_200_000);
    expect(typeof row[5]).toBe('number');
  });
});
