import { useCallback, useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { formatDate } from '../../utils';
import { fo } from './api';
import type { MyAssistConsent } from './types';

/** FO.S05, the applicant's side: a Field Officer asking to help, answered here
 *  on the applicant's own signed-in portal — the same treatment as a group
 *  invitation (pages/Applications InvitationCard). */
export function AssistConsentCards() {
  const [rows, setRows] = useState<MyAssistConsent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fo.myConsents()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your answer');
    } finally {
      setBusy(false);
    }
  };

  if (!rows.length) return null;

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Card key={r.name} className="border border-gdb-gold/60">
          <p className="text-base font-semibold text-slate-800">
            {r.status === 'Pending'
              ? `${r.officer_name ?? 'A GDB Field Officer'} asks to help with your application`
              : `${r.officer_name ?? 'A GDB Field Officer'} is helping with your application`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {r.status === 'Pending' ? `Asked ${formatDate(r.requested_on)}` : `Until ${formatDate(r.expires_on)}`}
            {' · '}They can fill in and submit it for you.
          </p>
          {error && (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {r.status === 'Pending' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => fo.respond(r.name, true))}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                Allow
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => (r.status === 'Pending' ? fo.respond(r.name, false) : fo.endConsent(r.name)))}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {r.status === 'Pending' ? 'Decline' : 'End access'}
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}
