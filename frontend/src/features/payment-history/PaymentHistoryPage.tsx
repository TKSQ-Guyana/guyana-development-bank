import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../../api';
import { Card } from '../../components/ui/Card';
import { ArrowRightIcon } from '../../components/ui/icons';
import { downloadCsv, toCsv } from '../../shared/csv';
import type { LoanAccount, LoanApplication } from '../../types';
import { LedgerSummary } from './components/LedgerSummary';
import { LedgerTable } from './components/LedgerTable';
import { LedgerToolbar } from './components/LedgerToolbar';
import {
  LEDGER_CSV_HEADERS,
  periods as buildPeriods,
  summarise,
  toCsvRows,
  toLedgerEntries,
  type PeriodId,
} from './model/ledger';

/** Payment history — the borrower's own loan ledger.
 *
 *  The ledger is lending's Loan Statement of Account, which is the only source
 *  that carries a RUNNING BALANCE, so it is what this screen reads. GDB's own
 *  repayment rows are joined onto it for the two facts the report does not
 *  hold: how a payment was typed, and who made it.
 *
 *  A facility exists once money has actually been released, so the list keys
 *  off the disbursed stage rather than off approval — an approved case with
 *  nothing drawn has no ledger to show.
 *
 *  This component owns the queries and the filter state. Everything below it
 *  is presentational, and every figure it renders is the server's.
 */
export function PaymentHistoryPage() {
  const [loans, setLoans] = useState<LoanApplication[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodId>('all');
  const [account, setAccount] = useState<LoanAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [asAt, setAsAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Built once per mount, not per render: a Date() inside useMemo's body with
  // no dependency would still be re-read on every recalculation, and the
  // period boundaries would drift under the user mid-session.
  const periods = useMemo(() => buildPeriods(), []);
  const activePeriod = periods.find((p) => p.id === period) ?? periods[0];

  useEffect(() => {
    call<LoanApplication[]>('gdb_bank.api.my_loans')
      .then(setLoans)
      .catch((err: Error) => setError(err.message));
  }, []);

  const facilities = useMemo(
    () => (loans ?? []).filter((l) => l.stage === 'Disbursed' || l.disbursed_amount > 0),
    [loans],
  );

  // A facility that leaves the list must not stay selected below it.
  const active = useMemo(() => {
    if (selected && facilities.some((f) => f.name === selected)) return selected;
    return facilities[0]?.name ?? null;
  }, [selected, facilities]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoadingAccount(true);
    setError(null);
    // from_date and to_date together are what make the server answer with a
    // statement at all — without both it returns the account and no ledger.
    call<LoanAccount>('gdb_bank.api.loan_account', {
      application: active,
      from_date: activePeriod.from,
      to_date: activePeriod.to,
    })
      .then((data) => {
        if (!current) return;
        setAccount(data);
        setAsAt(new Date());
      })
      .catch((err: Error) => current && setError(err.message))
      .finally(() => current && setLoadingAccount(false));
    // Ignoring a response for a facility or period the user has already moved
    // off is what keeps a slow first request from overwriting a fast second.
    return () => {
      current = false;
    };
  }, [active, activePeriod.from, activePeriod.to]);

  const entries = useMemo(
    () => toLedgerEntries(account?.statement?.transactions ?? [], account?.payments ?? []),
    [account],
  );

  const summary = useMemo(() => summarise(account, entries), [account, entries]);

  const download = useCallback(() => {
    downloadCsv(
      `gdb-payment-history-${active}-${activePeriod.from}-to-${activePeriod.to}.csv`,
      toCsv(LEDGER_CSV_HEADERS, toCsvRows(entries)),
    );
  }, [entries, active, activePeriod.from, activePeriod.to]);

  if (error && !loans) {
    return <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex items-center gap-2 text-slate-400">
          <li>
            <Link to="/payments" className="hover:text-brand hover:underline">
              Payments
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="font-medium text-slate-600" aria-current="page">
            Payment history
          </li>
        </ol>
      </nav>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Payment history</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every payment and release recorded on your loan ledger.
          {asAt && (
            <>
              {' '}
              As at{' '}
              {asAt.toLocaleString('en-GY', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          )}
        </p>
      </header>

      {!loans ? (
        <LoadingState />
      ) : facilities.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <LedgerToolbar
            facilities={facilities}
            selected={active ?? ''}
            onSelect={setSelected}
            periods={periods}
            period={period}
            onPeriod={setPeriod}
            onDownload={download}
            canDownload={entries.length > 0}
          />

          {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

          <LedgerSummary summary={summary} periodLabel={activePeriod.label} />

          {loadingAccount && !account ? (
            <LoadingState />
          ) : entries.length === 0 ? (
            <Card className="border-dashed py-12 text-center">
              <p className="text-base font-semibold text-slate-700">
                No entries in this period
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Nothing was released or received on this loan between{' '}
                {activePeriod.from} and {activePeriod.to}. Try a wider period.
              </p>
            </Card>
          ) : (
            <LedgerTable entries={entries} />
          )}
        </>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <Card className="animate-pulse">
      <div className="h-4 w-40 rounded bg-slate-100" />
      <div className="mt-4 h-2 w-full rounded bg-slate-100" />
      <div className="mt-2 h-2 w-4/5 rounded bg-slate-100" />
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed py-12 text-center">
      <p className="text-base font-semibold text-slate-700">No loan ledger yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        A ledger opens when GDB releases funds. Until then there is nothing received and nothing
        repaid to show.
      </p>
      <Link
        to="/apply"
        className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#262626]"
      >
        See my applications
        <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </Card>
  );
}
