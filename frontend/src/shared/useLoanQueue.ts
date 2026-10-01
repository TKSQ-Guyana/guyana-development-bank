import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import type { LoanPage, LoanQueue, LoanStage } from '../types';

export interface LoanQueueFilter {
  stage?: LoanStage;
  queue?: LoanQueue;
  sort?: string;
}

export const PAGE_LENGTH = 25;

/** One page of the Bank's queue, and the controls to move through it.
 *
 *  The server filters, sorts and counts; this holds only which page is on
 *  screen. The previous page stays visible while the next one loads, so a
 *  click on Next never blanks the table.
 */
export function useLoanQueue(filter: LoanQueueFilter) {
  const key = JSON.stringify(filter);
  // The page position belongs to the filter it was reached under: change the
  // filter and it is the first page again, with no stale request in between.
  const [position, setPosition] = useState({ key, start: 0 });
  const start = position.key === key ? position.start : 0;
  const [page, setPage] = useState<LoanPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setError(null);
    call<LoanPage>('gdb_bank.api.all_loans', { ...JSON.parse(key), start, page_length: PAGE_LENGTH })
      .then((result) => live && setPage(result))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [key, start]);

  useEffect(load, [load]);

  return {
    page,
    error,
    start,
    setStart: (next: number) => setPosition({ key, start: next }),
  };
}
