import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { useAuth } from '../auth';
import type { LoanOffer } from '../types';
import { formatGyd, formatDate } from '../utils';

/** The frozen agreement text is a fixed-width plain-text letter (see
 *  `offers._agreement_text`): a letterhead block of "Label : value" lines,
 *  then numbered sections ("1. THE FACILITY", …) whose body lines wrap a
 *  sentence across several source lines and mark conditions as "(n) …".
 *  This turns that same frozen string — never re-derived from the live
 *  offer — into a typeset document instead of a monospace dump. */
interface AgreementSection {
  heading: string;
  paragraphs: string[][];
}

function parseAgreement(text: string): { meta: [string, string][]; sections: AgreementSection[] } {
  const meta: [string, string][] = [];
  const sections: AgreementSection[] = [];
  let current: string[] | null = null;
  let currentHeading = '';

  const pushSection = () => {
    if (!current) return;
    sections.push({ heading: currentHeading, paragraphs: toParagraphs(current) });
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\d+\.\s+\S/.test(line)) {
      pushSection();
      currentHeading = line;
      current = [];
    } else if (current) {
      current.push(line);
    } else {
      const m = line.match(/^([A-Za-z][A-Za-z ]*?)\s*:\s*(.+)$/);
      if (m) meta.push([m[1].trim(), m[2].trim()]);
    }
  }
  pushSection();
  return { meta, sections };
}

function toParagraphs(lines: string[]): string[][] {
  const paragraphs: string[][] = [];
  let sentence: string[] = [];
  let list: string[] = [];
  const flushSentence = () => {
    if (sentence.length) paragraphs.push([sentence.join(' ')]);
    sentence = [];
  };
  const flushList = () => {
    if (list.length) paragraphs.push(list);
    list = [];
  };
  for (const line of lines) {
    if (!line) {
      flushSentence();
      flushList();
    } else if (/^\(\d+\)/.test(line)) {
      flushSentence();
      list.push(line.replace(/^\(\d+\)\s*/, ''));
    } else {
      flushList();
      sentence.push(line);
    }
  }
  flushSentence();
  flushList();
  return paragraphs;
}

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

  const joint = offer.execution?.joint ?? false;
  // On a group's offer the right to act is the viewer's own signature line,
  // which the server has already worked out. On an individual offer it is the
  // question it always was.
  const mine = joint ? offer.can_sign : offer.applicant_name === user?.full_name;
  // THIS viewer's own line, matched on who they are. Finding "the first line
  // still pending" instead told whoever opened the offer to type the name of
  // whichever member happened to be first on the roster — so the second
  // member was asked for the head's name, typed it, and was refused by the
  // server for signing as somebody else. Which is exactly what the server
  // check is for, but the screen should never have asked.
  const myLine = offer.signatures?.find((sig) => sig.member === user?.user) ?? null;
  const nameToType = joint ? (myLine?.member_name ?? user?.full_name ?? '') : offer.applicant_name;

  const respond = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const updated = accept
        ? joint
          ? await call<LoanOffer>('gdb_bank.offers.sign_offer', {
              name: offer.name,
              signed_name: typedName,
            })
          : await call<LoanOffer>('gdb_bank.offers.accept_offer', {
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
          <p className="mb-2 text-sm font-semibold text-slate-700">As stated in this offer</p>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600">
            {offer.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
          {/* Only staff have the checklist below to be pointed at; for the
              applicant these lines are the offer's own wording, nothing more. */}
          {(user?.is_underwriter || user?.is_finance || user?.is_disbursement) && (
            <p className="mt-2 text-xs text-slate-400">Live status of each is tracked below.</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAgreement(true)}
        className="mb-4 text-sm font-medium text-brand hover:underline"
      >
        Read the full Letter of Offer
      </button>
      {showAgreement && offer.agreement_text && (
        <LetterOfOfferDocument text={offer.agreement_text} onClose={() => setShowAgreement(false)} />
      )}

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {offer.status === 'Issued' && (
        <p className="mb-4 text-sm text-slate-600">
          This offer lapses on <strong>{formatDate(offer.valid_until)}</strong> unless{' '}
          {joint ? 'the group signs' : 'you accept'} it before then.
        </p>
      )}

      {/* A group's Letter of Offer is one agreement with several parties to
          it. Everyone can see where it stands, because a member waiting on
          somebody else deserves to know who. */}
      {joint && (
        <div className="mb-4 rounded-xl bg-slate-50 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">Signatures</p>
            <p className="text-xs font-medium text-slate-500">
              {offer.execution.signed} of {offer.execution.total} signed
            </p>
          </div>
          <ul className="divide-y divide-slate-200">
            {offer.signatures.map((sig) => (
              <li key={sig.name} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-800">
                  {sig.member_name}
                  {sig.is_head && (
                    <span className="ml-2 rounded bg-gdb-gold/40 px-1.5 py-0.5 text-xs font-semibold text-brand-dark">
                      Head
                    </span>
                  )}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    sig.signature_status === 'Signed'
                      ? 'text-emerald-700'
                      : sig.signature_status === 'Declined'
                        ? 'text-rose-600'
                        : 'text-slate-400'
                  }`}
                >
                  {sig.signature_status === 'Signed'
                    ? `Signed ${formatDate(sig.signed_on)}`
                    : sig.signature_status === 'Declined'
                      ? 'Declined'
                      : 'Waiting'}
                </span>
              </li>
            ))}
          </ul>
          {offer.status === 'Issued' && !offer.execution.complete && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              The agreement is executed when the last member signs. GDB books nothing and releases
              nothing until then.
            </p>
          )}
        </div>
      )}

      {joint && offer.status === 'Issued' && !offer.can_sign && (
        <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          {myLine?.signature_status === 'Signed'
            ? 'You have signed. The agreement is executed once every member has.'
            : myLine
              ? 'You have already answered this offer.'
              : 'This is your group’s offer. Only the members named on it can sign.'}
        </p>
      )}

      {offer.status === 'Issued' && mine && !declining && (
        <div className="border-t border-slate-200 pt-4">
          <p className="mb-2 text-sm text-slate-600">
            To {joint ? 'sign' : 'accept'}, type your name exactly as it appears above:{' '}
            <strong>{nameToType}</strong>
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
              {busy ? 'Recording…' : joint ? 'Sign the agreement' : 'Accept offer'}
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
          {joint ? (
            <>
              Signed by all {offer.execution.total} members, the last on{' '}
              {formatDate(offer.responded_on)}. This is the group&rsquo;s executed agreement with
              GDB.
            </>
          ) : (
            <>
              Accepted by <strong>{offer.accepted_name}</strong> on{' '}
              {formatDate(offer.responded_on)}. This is your executed agreement with GDB.
            </>
          )}
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

/** The frozen Letter of Offer, full-screen — a formal document to read
 *  closely, not a panel among other panels on the case page. */
function LetterOfOfferDocument({ text, onClose }: { text: string; onClose: () => void }) {
  const { meta, sections } = parseAgreement(text);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3 sm:px-12">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Letter of Offer
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-10 sm:px-16 sm:py-14">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              Guyana Development Bank
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Letter of Offer</h1>
          </div>

          <dl className="mb-10 grid grid-cols-1 gap-x-8 gap-y-2 border-y border-slate-200 py-5 text-sm sm:grid-cols-2">
            {meta.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 sm:justify-start">
                <dt className="text-slate-400">{label}</dt>
                <dd className="font-medium text-slate-800 sm:ml-2">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-8">
            {sections.map((s) => (
              <section key={s.heading}>
                <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-900">{s.heading}</h2>
                {s.paragraphs.map((p, i) =>
                  p.length > 1 ? (
                    <ol key={i} className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
                      {p.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ol>
                  ) : (
                    <p key={i} className="mb-2 text-sm leading-relaxed text-slate-700 last:mb-0">
                      {p[0]}
                    </p>
                  ),
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
