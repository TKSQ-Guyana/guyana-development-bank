import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChoiceCard, SelectField, TextAreaField, TextField } from '../../components/apply/fields';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { Drawer } from '../../components/ui/Drawer';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { formatDate } from '../../utils';
import { fo } from './api';
import { productLabel, visitNote } from './model/desk';
import { StatusBadge } from './StatusBadge';
import { CALL_RESULTS, OUTCOMES, type AssistRequest, type CallResult } from './types';
import { ErrorLine, RailTitle, Row, Timeline } from './ui';

const WORKING = ['Accepted', 'Visit booked'];

type Outcome = (typeof OUTCOMES)[number];

const OUTCOME_CARDS: { id: Outcome; confirm: string }[] = [
  { id: 'Helped remotely', confirm: 'Resolve' },
  { id: 'Visit booked', confirm: 'Book visit' },
  { id: 'Application started', confirm: 'Start application' },
  { id: "Couldn't reach", confirm: 'Resolve' },
  { id: 'Closed', confirm: 'Close request' },
];

const REASONS: Partial<Record<Outcome, string[]>> = {
  "Couldn't reach": ['No answer after several tries', 'Number not in service', 'Wrong number'],
  Closed: ['Applicant withdrew', 'No longer needs help', 'Duplicate request', 'Not eligible for this service'],
};

const BRING = ['e-ID card', 'Receipts or records', 'Photos of the business', 'Bank or wallet details'];

/** FO.S03 — one assist request: review and take it from the regional pool,
 *  log each attempt to reach the applicant, and resolve it — helped, visit
 *  booked, an application started, couldn't reach, or closed. */
export function AssistRequestPage() {
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [req, setReq] = useState<AssistRequest | null>(null);
  const [tab, setTab] = useState<'overview' | 'activity'>('overview');
  const [result, setResult] = useState<CallResult | null>(null);
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fo.assistRequest(name).then(setReq).catch((err: Error) => setError(err.message));
  }, [name]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Resolve the request as "Application started" and open the application.
   *  The applicant's consent is the way into it. Always asked of the server,
   *  which hands back the live one (Pending or Granted) or opens a new one —
   *  `r.consent` may be declined or expired. Asked FIRST: if that is refused,
   *  the request stays open. */
  const startApplication = (r: AssistRequest, note = '') =>
    act(async () => {
      const c = await fo.askConsent({ request: r.name });
      await fo.setOutcome(r.name, 'Application started', note);
      navigate(`/field/assist/${c.name}`);
    });

  if (error && !req) return <ErrorLine>{error}</ErrorLine>;
  if (!req) return <p className="text-slate-500">Loading…</p>;

  const isNew = !req.mine && req.status === 'Waiting';
  const working = req.mine && WORKING.includes(req.status);
  const resolved = !isNew && !WORKING.includes(req.status);

  const activity = [
    { key: 'asked', title: 'Request received', meta: formatDate(req.requested_on) },
    ...(req.accepted_on
      ? [{ key: 'taken', title: `Accepted by ${req.assigned_to_name ?? 'a Field Officer'}`, meta: formatDate(req.accepted_on) }]
      : []),
    ...[...req.attempts].reverse().map((a, i) => ({
      key: `a${i}`,
      title: `Contact attempt ${i + 1} · ${a.result}`,
      meta: [formatDate(a.attempted_on), a.note].filter(Boolean).join(' · '),
    })),
    ...(req.status === 'Visit booked' ? [{ key: 'visit', title: 'Visit booked', meta: req.outcome_note ?? '' }] : []),
    ...(req.closed_on ? [{ key: 'closed', title: `Resolved · ${req.status}`, meta: [formatDate(req.closed_on), req.outcome_note].filter(Boolean).join(' · ') }] : []),
  ];

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Work queue
      </Link>

      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{req.applicant_name}</h1>
            <StatusBadge status={req.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[productLabel(req.product), req.name].filter(Boolean).join(' · ')}
            <span className="ml-2">
              {req.region} · Received {formatDate(req.requested_on)} · {req.mine ? 'Assigned to you' : 'In regional pool'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isNew && (
            <Button disabled={busy} onClick={() => void act(() => fo.acceptRequest(name).then(setReq))}>
              Accept request
            </Button>
          )}
          {working && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setResolving(true)}>
                Resolve request…
              </Button>
              <Button disabled={busy} onClick={() => void startApplication(req)}>
                Start application
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorLine>{error}</ErrorLine></div>}

      <div className="mb-4">
        <SegmentedControl
          options={[
            { id: 'overview', label: 'Overview' },
            { id: 'activity', label: `Activity ${activity.length}` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'activity' ? (
        <Card>
          <RailTitle>Activity</RailTitle>
          <Timeline empty="Nothing yet." items={activity} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <div className="space-y-4 lg:sticky lg:top-24">
            <Card className="space-y-3">
              <RailTitle>Contact</RailTitle>
              <div>
                <CardLabel>Phone</CardLabel>
                <p className="text-lg font-bold text-slate-900">{req.phone ?? 'Hidden until accepted'}</p>
              </div>
              <div>
                <CardLabel>Preferred contact time</CardLabel>
                <p className="text-sm font-semibold text-slate-800">{req.best_time || '—'}</p>
              </div>
              {working && req.phone && (
                <Button variant="secondary" className="w-full" onClick={() => (window.location.href = `tel:${req.phone!.replace(/\s/g, '')}`)}>
                  Call applicant
                </Button>
              )}
            </Card>
            <Card>
              <RailTitle>Request</RailTitle>
              <Row label="Service" value={productLabel(req.product)} />
              <Row label="Business" value={req.business_type || '—'} />
              <Row label="Region" value={req.region} />
              <Row label="Received" value={formatDate(req.requested_on)} />
              {req.assigned_to_name && <Row label="Officer" value={req.assigned_to_name} />}
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            {req.status === 'Visit booked' && req.mine && (
              <Card className="space-y-3">
                <RailTitle>Visit</RailTitle>
                <p className="whitespace-pre-wrap text-sm font-medium text-slate-800">{req.outcome_note}</p>
              </Card>
            )}

            {working && (
              <Card className="space-y-4">
                <RailTitle>Log a call</RailTitle>
                <div>
                  <SegmentedControl
                    options={CALL_RESULTS.map((r) => ({ id: r, label: r }))}
                    value={result ?? ('' as CallResult)}
                    onChange={setResult}
                  />
                </div>
                <TextAreaField label="Note" value={note} onChange={setNote} rows={2} />
                <Button
                  variant="secondary"
                  disabled={busy || !result}
                  onClick={() =>
                    void act(async () => {
                      setReq(await fo.logCall(name, result!, note));
                      setResult(null);
                      setNote('');
                    })
                  }
                >
                  Log call
                </Button>
                {req.attempts.length > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <CardLabel>History · {req.attempts.length}</CardLabel>
                    <Timeline
                      empty=""
                      items={req.attempts.map((a, i) => ({
                        key: String(i),
                        title: `${req.attempts.length - i}. ${a.result}`,
                        meta: [formatDate(a.attempted_on), a.note].filter(Boolean).join(' · '),
                      }))}
                    />
                  </div>
                )}
              </Card>
            )}

            {resolved && (
              <Card className="space-y-3">
                <RailTitle aside={<StatusBadge status={req.status} />}>Resolved</RailTitle>
                {req.closed_on && <Row label="Closed" value={formatDate(req.closed_on)} />}
                {req.outcome_note && <p className="whitespace-pre-wrap text-sm text-slate-700">{req.outcome_note}</p>}
                {req.consent && (
                  <Link to={`/field/assist/${req.consent.name}`} className="text-sm font-medium text-brand hover:underline">
                    Open application →
                  </Link>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      <ResolveDrawer
        open={resolving}
        req={req}
        busy={busy}
        onClose={() => setResolving(false)}
        onResolve={async (outcome, outcomeNote) => {
          const ok =
            outcome === 'Application started'
              ? await startApplication(req, outcomeNote)
              : await act(async () => setReq(await fo.setOutcome(name, outcome, outcomeNote)));
          if (ok) setResolving(false);
        }}
      />
    </div>
  );
}

function ResolveDrawer({
  open,
  req,
  busy,
  onClose,
  onResolve,
}: {
  open: boolean;
  req: AssistRequest;
  busy: boolean;
  onClose: () => void;
  onResolve: (outcome: Outcome, note: string) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [visit, setVisit] = useState({ date: '', time: '', place: '', bring: ['e-ID card'] });
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!open) return;
    setOutcome(null);
    setVisit({ date: '', time: '', place: '', bring: ['e-ID card'] });
    setReason('');
    setSummary('');
  }, [open]);

  const reasons = outcome ? REASONS[outcome] : undefined;
  const ready =
    !!outcome &&
    (outcome !== 'Visit booked' || (visit.date && visit.place.trim())) &&
    (!reasons || reason);
  const note =
    outcome === 'Visit booked' ? visitNote(visit) : reasons ? [reason, summary.trim()].filter(Boolean).join(' — ') : summary.trim();
  const card = OUTCOME_CARDS.find((o) => o.id === outcome);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Resolve request"
      subtitle={`${req.attempts.length} contact ${req.attempts.length === 1 ? 'attempt' : 'attempts'} logged on this request`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !ready} onClick={() => outcome && void onResolve(outcome, note)}>
            {card?.confirm ?? 'Choose an outcome'}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {OUTCOME_CARDS.map((o) => {
          // The server refuses "couldn't reach" with no attempt on record.
          const blocked = o.id === "Couldn't reach" && !req.attempts.length;
          return (
            <ChoiceCard
              key={o.id}
              title={o.id}
              note={blocked ? 'Log a call first' : undefined}
              disabled={blocked}
              selected={outcome === o.id}
              onSelect={() => {
                setOutcome(o.id);
                setReason('');
              }}
            />
          );
        })}
      </div>

      {outcome === 'Visit booked' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Date" type="date" required value={visit.date} onChange={(date) => setVisit((v) => ({ ...v, date }))} />
            <TextField label="Time" type="time" value={visit.time} onChange={(time) => setVisit((v) => ({ ...v, time }))} />
          </div>
          <TextField label="Where" required value={visit.place} onChange={(place) => setVisit((v) => ({ ...v, place }))} />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Bring</legend>
            <div className="space-y-1.5">
              {BRING.map((b) => (
                <label key={b} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={visit.bring.includes(b)}
                    onChange={() =>
                      setVisit((v) => ({ ...v, bring: v.bring.includes(b) ? v.bring.filter((x) => x !== b) : [...v.bring, b] }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
                  />
                  {b}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {reasons && <SelectField label="Reason" required value={reason} onChange={setReason} options={reasons} placeholder="Choose…" />}

      {(outcome === 'Helped remotely' || reasons) && (
        <TextAreaField
          label={outcome === 'Helped remotely' ? 'What you helped with' : 'Note'}
          value={summary}
          onChange={setSummary}
          rows={3}
        />
      )}
    </Drawer>
  );
}
