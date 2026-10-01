import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { call, uploadFile } from '../../api';
import { Notice } from '../../components/apply/fields';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { StageBadge } from '../../components/ui/Stepper';
import type { LoanApplication } from '../../types';
import { formatDate, formatGyd } from '../../utils';
import { fo } from './api';
import { StatusBadge } from './StatusBadge';
import type { AssistConsent } from './types';
import { ErrorLine, RailTitle, Row, Timeline } from './ui';

const POLL_MS = 10_000;

/** FO.S05 / FO.S07 / W5 — one applicant the officer is helping.
 *
 *  Pending: waiting for the applicant to allow access in their own portal.
 *  Granted: their drafts (start, continue, hand back) and the open information
 *  requests the officer may put a file against for them to send.
 *  Ended after a handback: "Sent to applicant" and where the case is now. */
export function AssistConsentPage() {
  const { consent = '' } = useParams<{ consent: string }>();
  const [c, setC] = useState<AssistConsent | null>(null);
  const [handedOff, setHandedOff] = useState<LoanApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fo.consent(consent)
      .then((next) => {
        setC(next);
        if (next.application) {
          fo.caseView(next.application)
            .then((v) => setHandedOff(v.case))
            .catch(() => setHandedOff(null));
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [consent]);
  useEffect(load, [load]);

  // Waiting on the applicant's answer in their own portal.
  useEffect(() => {
    if (c?.status !== 'Pending') return;
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [c?.status, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  /** W5: the file goes on the applicant's case against the request; only the
   *  applicant sends it (documents.confirm_document refuses the officer). */
  const stage = (request: AssistConsent['open_requests'][number], file: File) =>
    act(async () => {
      const row = await call<{ name: string }>('gdb_bank.documents.new_document', {
        document_type: request.document_type || 'Other',
        application: request.application,
        request: request.name,
        acting: consent,
      });
      await uploadFile(file, { doctype: 'GDB Applicant Document', docname: row.name });
      setStaged((s) => ({ ...s, [request.name]: file.name }));
    });

  if (error && !c) return <ErrorLine>{error}</ErrorLine>;
  if (!c) return <p className="text-slate-500">Loading…</p>;

  const live = c.status === 'Granted';

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Field desk
      </Link>

      <div className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{c.applicant_name ?? c.masked_name}</h1>
            <StatusBadge
              status={handedOff ? (handedOff.status === 'Draft' ? 'Waiting for applicant' : 'Submitted') : c.status}
            />
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">{c.applicant_eid}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <Link
              to={`/field/assist/${consent}/apply/new`}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 hover:bg-brand-dark"
            >
              New application
            </Link>
          )}
          {(live || c.status === 'Pending') && (
            <Button variant="secondary" disabled={busy} onClick={() => void act(() => fo.endConsent(consent))}>
              End access
            </Button>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorLine>{error}</ErrorLine></div>}

      {c.status === 'Pending' && (
        <Notice tone="info">Waiting for the applicant to allow access in their portal.</Notice>
      )}

      {c.application && (
        <Card className="space-y-2">
          <RailTitle aside={handedOff && <StageBadge stage={handedOff.stage} />}>
            {handedOff && handedOff.status !== 'Draft' && handedOff.submitted_by !== handedOff.applicant
              ? 'Submitted for the applicant'
              : 'Sent to applicant to submit'}
          </RailTitle>
          <Row label="Application" value={c.application} />
          <Row label="Status" value={handedOff?.status === 'Draft' ? 'Waiting for applicant' : (handedOff?.status ?? '—')} />
          <Row label={handedOff && handedOff.status !== 'Draft' ? 'Submitted' : 'Handed back'} value={formatDate(handedOff?.submitted_on ?? c.ended_on)} />
          <Link to={`/field/cases/${c.application}`} className="text-sm font-medium text-brand hover:underline">
            View case
          </Link>
        </Card>
      )}

      {!live && !c.application && c.status !== 'Pending' && (
        <Card>
          <p className="text-sm text-slate-500">{c.end_reason || c.status}</p>
        </Card>
      )}

      {live && (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <Card>
            <RailTitle>Access</RailTitle>
            <Row label="Allowed" value={formatDate(c.responded_on)} />
            <Row label="Expires" value={formatDate(c.expires_on)} />
          </Card>

          <div className="min-w-0 space-y-4">
            <Card>
              <RailTitle>Drafts</RailTitle>
              <Timeline
                empty="No drafts yet."
                items={c.drafts.map((d) => ({
                  key: d.name,
                  title: (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <Link to={`/field/assist/${consent}/apply/${d.name}`} className="text-brand hover:underline">
                        {d.purpose || d.name}
                      </Link>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('Send this application to the applicant to check and submit?')) {
                            void act(() => fo.handOff(consent, d.name));
                          }
                        }}
                      >
                        Send to applicant
                      </Button>
                    </span>
                  ),
                  meta: `${d.name} · ${formatGyd(d.loan_amount)} · saved ${formatDate(d.modified)}`,
                }))}
              />
            </Card>

            <Card>
              <RailTitle>Open information requests</RailTitle>
              <Timeline
                empty="Nothing asked."
                items={c.open_requests.map((r) => ({
                  key: r.name,
                  title: r.item,
                  meta: staged[r.name] ? (
                    `${r.application} · ${staged[r.name]} added · the applicant sends it`
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      {r.application} · {formatDate(r.requested_on)}
                      <label className="cursor-pointer font-semibold text-brand hover:underline">
                        Add file
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          capture="environment"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) void stage(r, file);
                          }}
                        />
                      </label>
                    </span>
                  ),
                }))}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
