import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call } from '../api';
import { useAuth } from '../auth';
import { formatDate } from '../utils';

/** Conditions precedent — what stands between an accepted offer and money.
 *
 *  Deliberately visible to the borrower, not just to staff: the SOW requires
 *  the applicant to see actionable outstanding items, and "why has my money
 *  not arrived" is the single most common question a lender gets.
 *
 *  Staff can mark a condition Met or Waived. A waiver reads as loudly as a
 *  pass — same attribution, different word — because a condition that can
 *  disappear quietly is not a control.
 *
 *  An underwriter can also add one. The standard conditions come from the
 *  Letter of Offer, which is right for what the offer said and not enough for
 *  what a case turns out to need — a valuation to re-do, a lease nobody knew
 *  about. Without that, learning something after issue left two options:
 *  release anyway, or reissue the whole offer.
 */

interface Condition {
  name: string;
  description: string;
  status: 'Outstanding' | 'Met' | 'Waived';
  is_required: number;
  verified_by: string | null;
  verified_on: string | null;
  note: string | null;
}

interface Checklist {
  conditions: Condition[];
  outstanding: number;
  total: number;
}

const MARK: Record<string, { icon: string; tone: string }> = {
  Met: { icon: '✓', tone: 'text-green-700' },
  Waived: { icon: '−', tone: 'text-amber-700' },
  Outstanding: { icon: '○', tone: 'text-slate-400' },
};

export function Conditions({
  application,
  onChange,
}: {
  application: string;
  onChange?: () => void;
}) {
  const { user } = useAuth();
  const [list, setList] = useState<Checklist | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    call<Checklist>('gdb_bank.conditions.list_conditions', { application })
      .then(setList)
      .catch(() => setList(null));
  }, [application]);

  useEffect(load, [load]);

  // An empty checklist is still a panel for an underwriter — it is where the
  // first case-specific condition gets added. For the applicant, nothing to
  // show is nothing to show.
  if (!list) return null;
  if (list.total === 0 && !user?.is_underwriter) return null;

  const mark = async (name: string, status: string) => {
    setBusy(name);
    setError(null);
    try {
      await call('gdb_bank.conditions.verify_condition', { name, status });
      load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the condition');
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy('add');
    setError(null);
    try {
      await call('gdb_bank.conditions.add_condition', { application, description: draft });
      setDraft('');
      load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the condition');
    } finally {
      setBusy(null);
    }
  };

  const clear = list.outstanding === 0;

  return (
    <div className="mb-6 rounded-xl bg-white p-6 shadow">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Conditions precedent</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            clear ? 'bg-green-50 text-green-800' : 'bg-gdb-gold/20 text-brand-dark'
          }`}
        >
          {clear ? 'All cleared' : `${list.outstanding} outstanding`}
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        {clear
          ? 'Everything required before release has been verified.'
          : 'No funds are released until every item below is verified by GDB.'}
      </p>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="space-y-3">
        {list.conditions.map((c) => (
          <li key={c.name} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0">
            <span className={`mt-0.5 text-lg leading-none ${MARK[c.status].tone}`}>
              {MARK[c.status].icon}
            </span>
            <div className="flex-1">
              <p
                className={`text-sm ${c.status === 'Outstanding' ? 'text-slate-700' : 'text-slate-500 line-through decoration-slate-300'}`}
              >
                {c.description}
              </p>
              {c.verified_by && (
                <p className="mt-1 text-xs text-slate-400">
                  {c.status} by {c.verified_by} · {formatDate(c.verified_on)}
                </p>
              )}
              {user?.is_underwriter && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.status !== 'Met' && (
                    <button
                      type="button"
                      disabled={busy === c.name}
                      onClick={() => void mark(c.name, 'Met')}
                      className="rounded-md border border-brand px-3 py-1 text-xs font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
                    >
                      Mark met
                    </button>
                  )}
                  {c.status !== 'Waived' && (
                    <button
                      type="button"
                      disabled={busy === c.name}
                      onClick={() => void mark(c.name, 'Waived')}
                      className="rounded-md border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Waive
                    </button>
                  )}
                  {c.status !== 'Outstanding' && (
                    <button
                      type="button"
                      disabled={busy === c.name}
                      onClick={() => void mark(c.name, 'Outstanding')}
                      className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {user?.is_underwriter && (
        <form onSubmit={(e) => void add(e)} className="mt-4 border-t border-slate-200 pt-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Add a condition
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Independent valuation of the pledged equipment"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <p className="mb-2 text-xs text-slate-500">
            Blocks release exactly like a condition from the Letter of Offer, and the applicant
            sees it in this same list.
          </p>
          <button
            type="submit"
            disabled={busy === 'add' || !draft.trim()}
            className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy === 'add' ? 'Adding…' : 'Add condition'}
          </button>
        </form>
      )}
    </div>
  );
}
