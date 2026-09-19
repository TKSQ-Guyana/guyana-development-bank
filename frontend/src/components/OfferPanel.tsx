import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { useAuth } from '../auth';
import type { LoanOffer } from '../types';
import { formatGyd, formatDate } from '../utils';

/** The Letter of Offer, and the act of executing it.
 *
 *  An approval is a credit decision; it binds nobody. This panel is where the
 *  borrower reads the terms and either accepts — which executes the agreement
 *  and is what lets the loan be booked — or declines with a reason.
 *
 *  The agreement wording is frozen server-side when the offer is issued, so
 *  what is shown here is the retained text, not a re-render of it.
 */

const TONE: Record<string, string> = {
  Issued: 'bg-gdb-gold/20 text-brand-dark',
  Accepted: 'bg-green-50 text-green-800',
  Declined: 'bg-red-50 text-red-700',
  Expired: 'bg-slate-100 text-slate-600',
  Withdrawn: 'bg-slate-100 text-slate-600',
};

export function OfferPanel({
  application,
  onExecuted,
}: {
  application: string;
  onExecuted?: () => void;
}) {
  const { user } = useAuth();
  const [offer, setOffer] = useState<LoanOffer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAgreement, setShowAgreement] = useState(false);

  const load = useCallback(() => {
    call<LoanOffer | null>('gdb_bank.offers.my_offer', { application })
      .then((o) => {
        setOffer(o);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [application]);

  useEffect(load, [load]);

  if (!loaded || !offer) return null;

  const mine = offer.applicant_name === user?.full_name;

  const respond = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const updated = accept
        ? await call<LoanOffer>('gdb_bank.offers.accept_offer', {
            name: offer.name,
            accepted_name: typedName,
          })
        : await call<LoanOffer>('gdb_bank.offers.decline_offer', {
            name: offer.name,
            reason,
          });
      setOffer(updated);
      setDeclining(false);
      onExecuted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your response');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-gdb-gold bg-white p-6 shadow">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Letter of Offer</h2>
          <p className="font-mono text-xs text-slate-400">{offer.name}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE[offer.status] ?? 'bg-slate-100 text-slate-600'}`}
        >
          {offer.status}
        </span>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Amount offered</dt>
          <dd className="font-semibold text-slate-800">{formatGyd(offer.offered_amount)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Term</dt>
          <dd className="font-semibold text-slate-800">{offer.term_months} months</dd>
        </div>
        <div>
          <dt className="text-slate-500">Instalment</dt>
          <dd className="font-semibold text-slate-800">{formatGyd(offer.monthly_instalment)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Interest</dt>
          <dd className="font-semibold text-slate-800">{offer.rate_of_interest}%</dd>
        </div>
      </dl>

      {offer.conditions.length > 0 && (
        <div className="mb-4 rounded-lg bg-slate-50 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            Conditions precedent — all must be met before funds are released
          </p>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600">
            {offer.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAgreement((v) => !v)}
        className="mb-4 text-sm font-medium text-brand hover:underline"
      >
        {showAgreement ? 'Hide the full offer' : 'Read the full offer'}
      </button>
      {showAgreement && (
        <pre className="mb-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-mono text-xs text-slate-700">
          {offer.agreement_text}
        </pre>
      )}

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {offer.status === 'Issued' && (
        <p className="mb-4 text-sm text-slate-600">
          This offer lapses on <strong>{formatDate(offer.valid_until)}</strong> unless you accept
          it before then.
        </p>
      )}

      {offer.status === 'Issued' && mine && !declining && (
        <div className="border-t border-slate-200 pt-4">
          <p className="mb-2 text-sm text-slate-600">
            To accept, type your name exactly as it appears above:{' '}
            <strong>{offer.applicant_name}</strong>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Your full name"
              className="w-64 rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="button"
              disabled={busy || !typedName.trim()}
              onClick={() => void respond(true)}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? 'Recording…' : 'Accept offer'}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {offer.status === 'Issued' && mine && declining && (
        <div className="border-t border-slate-200 pt-4">
          <label className="mb-2 block text-sm text-slate-600">
            Why are you declining? This helps GDB improve the programme.
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond(false)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Recording…' : 'Confirm decline'}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {offer.status === 'Accepted' && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Accepted by <strong>{offer.accepted_name}</strong> on{' '}
          {formatDate(offer.responded_on)}. This is your executed agreement with GDB.
        </p>
      )}
      {offer.status === 'Declined' && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Declined on {formatDate(offer.responded_on)}
          {offer.decline_reason ? ` — “${offer.decline_reason}”` : ''}.
        </p>
      )}
      {offer.status === 'Expired' && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          This offer lapsed on {formatDate(offer.valid_until)}. Contact GDB if you still want the
          facility.
        </p>
      )}
    </div>
  );
}
