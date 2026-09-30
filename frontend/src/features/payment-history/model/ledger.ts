/** The read model behind Payment history.
 *
 *  One screen, two server-side sources, joined here and nowhere else:
 *
 *    * `statement.transactions` — lending's own Loan Statement of Account,
 *      every release and every payment with lending's RUNNING BALANCE. This is
 *      the ledger, and it is the only thing that knows the balance after a
 *      line.
 *    * `payments` — GDB's repayment rows, which carry two facts lending's
 *      report does not: how the payment was typed, and WHO paid it. On a
 *      cluster facility several members pay into one loan, so the payer is
 *      part of the record, not a detail.
 *
 *  The join is on the ledger document's own name, which both sides carry.
 *
 *  NOTHING HERE COMPUTES MONEY. Every amount and every balance is lending's
 *  figure relayed unchanged; this module decides wording and order, and that
 *  is all. The totals on the summary tiles come from lending too — see
 *  `summarise`, which reads them rather than adding anything up.
 */

import type { LoanAccount, LoanPayment, StatementLine } from '../../../types';

/** A release pays money out; a payment brings it back. They read differently
 *  and they settle differently, so they are different kinds, not one row with
 *  a sign. */
export type LedgerKind = 'release' | 'payment';

export interface LedgerEntry {
  /** The ledger document's own name — `LM-REP-0024`, `LM-DIS-0007`. This is
   *  the reference GDB can actually be asked about, so it is what is shown. */
  id: string;
  date: string;
  kind: LedgerKind;
  /** What happened, in the borrower's words. */
  description: string;
  /** Who paid, when GDB knows. Null on a release and on a bank receipt that
   *  never came through the portal. */
  payer: string | null;
  payerEid: string | null;
  /** How it reached GDB, never invented: see `channelOf`. */
  channel: string;
  amount: number;
  /** Lending's running balance AFTER this line. */
  balance: number;
  status: 'Released' | 'Settled';
}

/** GDB made no loans before this. Used as the floor for the "All" period,
 *  because the statement endpoint is cut by a date range and "everything"
 *  still has to be expressed as one. */
export const LEDGER_EPOCH = '2020-01-01';

export type PeriodId = 'all' | 'last3' | 'year';

export interface Period {
  id: PeriodId;
  label: string;
  from: string;
  to: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The periods the toolbar offers. `today` is injected so this is pure and
 *  the tests do not drift with the calendar. */
export function periods(today: Date = new Date()): Period[] {
  const to = iso(today);

  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const year = today.getFullYear();

  return [
    { id: 'all', label: 'All', from: LEDGER_EPOCH, to },
    { id: 'last3', label: 'Last 3 months', from: iso(threeMonthsAgo), to },
    { id: 'year', label: String(year), from: `${year}-01-01`, to },
  ];
}

/** A release is a disbursement; everything else on a loan ledger is money
 *  coming back. Read off lending's own doctype rather than off wording, which
 *  is a label and can change. */
function kindOf(line: StatementLine): LedgerKind {
  return line.transaction_doctype === 'Loan Disbursement' ? 'release' : 'payment';
}

/** How the money reached GDB.
 *
 *  Deliberately NOT a mode of payment — GDB does not record one. What it does
 *  know is which door the entry came through: a citizen pressing pay in the
 *  portal stamps a payer, and a receipt the Bank applied from a bank statement
 *  does not. Saying "Bank receipt" is true; inventing "cheque" would not be.
 */
function channelOf(kind: LedgerKind, payment: LoanPayment | undefined): string {
  if (kind === 'release') return 'Disbursement';
  return payment?.paid_by_name ? 'Portal payment' : 'Bank receipt';
}

/** lending's repayment types, in words a borrower reading their own ledger
 *  would use. An unmapped type falls through to lending's own wording rather
 *  than to a guess. */
const DESCRIPTIONS: Record<string, string> = {
  'Normal Repayment': 'Instalment payment',
  'Advance Payment': 'Advance payment',
  'Pre Payment': 'Early payment',
  'Loan Closure': 'Final settlement',
  'Partial Settlement': 'Partial settlement',
  'Full Settlement': 'Full settlement',
};

function describe(kind: LedgerKind, payment: LoanPayment | undefined): string {
  if (kind === 'release') return 'Funds released';
  if (!payment) return 'Payment received';
  return DESCRIPTIONS[payment.repayment_type] ?? payment.repayment_type;
}

/** Build the ledger rows for the screen, newest first.
 *
 *  `debit` and `credit` are lending's: a release debits the loan account and a
 *  payment credits it, so exactly one of the two carries the amount on any
 *  line. Taking whichever is non-zero relays lending's figure without deciding
 *  anything about it.
 */
export function toLedgerEntries(
  transactions: StatementLine[],
  payments: LoanPayment[] = [],
): LedgerEntry[] {
  const byName = new Map(payments.map((p) => [p.name, p]));

  return transactions
    .map((line): LedgerEntry => {
      const kind = kindOf(line);
      const payment = byName.get(line.transaction_name);
      return {
        id: line.transaction_name,
        date: line.posting_date,
        kind,
        description: describe(kind, payment),
        payer: payment?.paid_by_name ?? null,
        payerEid: payment?.paid_by_eid ?? null,
        channel: channelOf(kind, payment),
        amount: line.debit || line.credit,
        balance: line.balance,
        status: kind === 'release' ? 'Released' : 'Settled',
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface LedgerSummary {
  /** lending's `total_amount_paid` on the Loan — the life-to-date figure, not
   *  the period's, and never a sum of the rows above it. */
  totalRepaid: number | null;
  /** How many payment lines the chosen period holds. A count, not money. */
  paymentsRecorded: number;
  /** lending's `principal_outstanding` from the dues call. */
  outstanding: number | null;
  /** The next scheduled instalment date on or after today. A lookup in the
   *  schedule lending already returned — no date arithmetic. */
  nextDue: string | null;
}

export function summarise(
  account: LoanAccount | null,
  entries: LedgerEntry[],
  today: Date = new Date(),
): LedgerSummary {
  const todayIso = iso(today);
  const next = (account?.schedule ?? []).find((row) => row.payment_date >= todayIso);

  return {
    totalRepaid: account?.loan?.total_amount_paid ?? null,
    paymentsRecorded: entries.filter((e) => e.kind === 'payment').length,
    outstanding: account?.dues?.principal_outstanding ?? null,
    nextDue: next?.payment_date ?? null,
  };
}

export const LEDGER_CSV_HEADERS = [
  'Date',
  'Description',
  'Reference',
  'Channel',
  'Paid by',
  'Amount (GYD)',
  'Balance (GYD)',
  'Status',
];

export function toCsvRows(entries: LedgerEntry[]): unknown[][] {
  return entries.map((e) => [
    e.date,
    e.description,
    e.id,
    e.channel,
    e.payer ?? '',
    e.amount,
    e.balance,
    e.status,
  ]);
}
