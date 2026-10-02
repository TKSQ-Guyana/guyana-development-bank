import { useCallback, useEffect, useState } from 'react';
import { formatPhone } from '../../components/PhoneInput';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Drawer } from '../../components/ui/Drawer';
import { formatDate } from '../../utils';
import { fo } from './api';
import { StatusBadge } from './StatusBadge';
import { CALL_RESULTS, OUTCOMES, type AssistRequest } from './types';
import { ErrorLine, FIELD, RailTitle, Row, Timeline } from './ui';

const WORKING = ['Accepted', 'Visit booked'];

/** FO.S03 — one assist request: take it from the pool, log each call, record
 *  how it ended, or start the application with the applicant. */
export function AssistRequestPage() {
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [req, setReq] = useState<AssistRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<'call' | 'outcome' | null>(null);

  const load = useCallback(() => {
    fo.assistRequest(name).then(setReq).catch((err: Error) => setError(err.message));
  }, [name]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (error && !req) return <ErrorLine>{error}</ErrorLine>;
  if (!req) return <p className="text-slate-500">Loading…</p>;

  const working = req.mine && WORKING.includes(req.status);

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Field desk
      </Link>

      <div className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{req.applicant_name}</h1>
            <StatusBadge status={req.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">{req.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!req.mine && req.status === 'Waiting' && (
            <Button disabled={busy} onClick={() => void act(() => fo.acceptRequest(name).then(setReq))}>
              Take request
            </Button>
          )}
          {working && (
            <>
              <Button variant="secondary" onClick={() => setDrawer('call')}>
                Log call
              </Button>
              <Button variant="secondary" onClick={() => setDrawer('outcome')}>
                Set outcome
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const c = req.consent ?? (await fo.askConsent({ request: name }));
                    navigate(`/field/assist/${c.name}`);
                  })
                }
              >
                Start application
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorLine>{error}</ErrorLine></div>}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <Card>
          <RailTitle>Request</RailTitle>
          <Row label="Phone" value={req.phone ? <a href={`tel:${req.phone}`} className="text-brand">{formatPhone(req.phone)}</a> : '—'} />
          <Row label="Region" value={req.region} />
          <Row label="Product" value={req.product || '—'} />
          <Row label="Business" value={req.business_type} />
          <Row label="Best time" value={req.best_time || '—'} />
          <Row label="Asked" value={formatDate(req.requested_on)} />
          {req.assigned_to_name && <Row label="Officer" value={req.assigned_to_name} />}
          {req.outcome_note && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="text-sm text-slate-500">Outcome note</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{req.outcome_note}</p>
            </div>
          )}
        </Card>

        <Card>
          <RailTitle>Contact log</RailTitle>
          <Timeline
            empty="No calls yet."
            items={req.attempts.map((a, i) => ({
              key: String(i),
              title: a.result,
              meta: [formatDate(a.attempted_on), a.note].filter(Boolean).join(' · '),
            }))}
          />
        </Card>
      </div>

      <LogCallDrawer
        open={drawer === 'call'}
        onClose={() => setDrawer(null)}
        onSave={(result, note) => fo.logCall(name, result, note).then(setReq)}
      />
      <OutcomeDrawer
        open={drawer === 'outcome'}
        onClose={() => setDrawer(null)}
        onSave={(outcome, note) => fo.setOutcome(name, outcome, note).then(setReq)}
      />
    </div>
  );
}

function ChoiceDrawer({
  open,
  title,
  options,
  label,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  options: readonly string[];
  label: string;
  onClose: () => void;
  onSave: (choice: string, note: string) => Promise<unknown>;
}) {
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChoice('');
      setNote('');
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(choice, note);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !choice}>
            Save
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium text-slate-700">
        {label}
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className={FIELD}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={FIELD} />
      </label>
      {error && <ErrorLine>{error}</ErrorLine>}
    </Drawer>
  );
}

function LogCallDrawer(props: { open: boolean; onClose: () => void; onSave: (r: string, n: string) => Promise<unknown> }) {
  return <ChoiceDrawer {...props} title="Log call" label="Result" options={CALL_RESULTS} />;
}

function OutcomeDrawer(props: { open: boolean; onClose: () => void; onSave: (o: string, n: string) => Promise<unknown> }) {
  return <ChoiceDrawer {...props} title="Set outcome" label="Outcome" options={OUTCOMES} />;
}
