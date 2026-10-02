import { useCallback, useEffect, useState } from 'react';
import { formatPhone, PhoneInput } from '../../components/PhoneInput';
import { Link, useParams } from 'react-router-dom';
import { uploadFile } from '../../api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { formatDate } from '../../utils';
import { fo } from './api';
import { StatusBadge } from './StatusBadge';
import { CALL_RESULTS, VERDICTS, type ContactAttempt, type FieldTask, type VisitCheck } from './types';
import { ErrorLine, FIELD, RailTitle, Row } from './ui';

const CHECK_RESULTS = ['Yes', 'No', 'N/A'] as const;
const EMPTY_CALL: ContactAttempt = { attempted_on: '', contact_name: '', phone: '', relationship: '', result: 'Reached', verdict: '', note: '' };

/** An OpenStreetMap link — the pin needs no map library to be checked. */
export function mapLink(lat: number, lon: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

/** FO.S08 / S09 / S10 — a field task: what the Loan Officer asked, then the
 *  visit report (checklist, photos, map pin, notes) or the reference check
 *  (calls to two contacts, the outcome of each). */
export function FieldTaskPage() {
  const { name = '' } = useParams<{ name: string }>();
  const [task, setTask] = useState<FieldTask | null>(null);
  const [checks, setChecks] = useState<VisitCheck[]>([]);
  const [calls, setCalls] = useState<ContactAttempt[]>([]);
  const [pin, setPin] = useState<{ latitude: number; longitude: number; location_accuracy: number | null } | null>(null);
  const [findings, setFindings] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const take = useCallback((t: FieldTask) => {
    setTask(t);
    setChecks(t.checks);
    setCalls(t.reference_calls.length ? t.reference_calls : [{ ...EMPTY_CALL }, { ...EMPTY_CALL }]);
    setPin(t.latitude != null && t.longitude != null ? { latitude: t.latitude, longitude: t.longitude, location_accuracy: t.location_accuracy } : null);
    setFindings(t.findings ?? '');
  }, []);

  useEffect(() => {
    fo.task(name).then(take).catch((err: Error) => setError(err.message));
  }, [name, take]);

  const act = async (fn: () => Promise<FieldTask | void>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const t = await fn();
      if (t) take(t);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !task) return <ErrorLine>{error}</ErrorLine>;
  if (!task) return <p className="text-slate-500">Loading…</p>;

  const editable = Boolean(task.mine) && task.status === 'Accepted';
  const visit = task.kind === 'Site Visit';
  const report = visit
    ? { checks, findings, ...(pin ?? {}) }
    : { reference_calls: calls.filter((c) => c.contact_name?.trim()), findings };

  const dropPin = () => {
    if (!navigator.geolocation) {
      setError('This device cannot share its location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setPin({
          latitude: Number(p.coords.latitude.toFixed(6)),
          longitude: Number(p.coords.longitude.toFixed(6)),
          location_accuracy: Math.round(p.coords.accuracy),
        }),
      () => setError('Location was not shared.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const setCall = (i: number, patch: Partial<ContactAttempt>) =>
    setCalls((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Field desk
      </Link>

      <div className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{task.kind}</h1>
            <StatusBadge status={task.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {task.mine ? (
              <Link to={`/field/cases/${task.application}`} className="text-brand hover:underline">
                {task.application}
              </Link>
            ) : (
              task.application
            )}{' '}
            · {task.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!task.mine && task.status === 'Open' && (
            <Button disabled={busy} onClick={() => void act(() => fo.acceptTask(name))}>
              Take task
            </Button>
          )}
          {editable && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void act(() => fo.saveReport(name, report)).then((ok) => ok && setSaved(true))}>
                Save
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Submit this report to the Loan Officer?')) void act(() => fo.submitReport(name, report));
                }}
              >
                Submit report
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorLine>{error}</ErrorLine></div>}
      {saved && <p className="mb-4 text-sm text-emerald-700">Saved.</p>}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-24">
          <RailTitle>What was asked</RailTitle>
          <p className="whitespace-pre-wrap text-sm font-medium text-slate-800">{task.instructions}</p>
          <div className="mt-2 border-t border-slate-100 pt-2">
            <Row label="Applicant" value={task.applicant_name ?? '—'} />
            {task.applicant_eid && <Row label="e-ID" value={<span className="font-mono text-xs">{task.applicant_eid}</span>} />}
            {task.phone && <Row label="Phone" value={<a href={`tel:${task.phone}`} className="text-brand">{formatPhone(task.phone)}</a>} />}
            <Row label="Region" value={task.region ?? '—'} />
            <Row label="Due" value={formatDate(task.due_date)} />
            <Row label="Asked by" value={task.requested_by_name ?? '—'} />
          </div>
          {task.address && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="text-sm text-slate-500">Address</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{task.address}</p>
              <a
                href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(task.address)}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-brand hover:underline"
              >
                Open map
              </a>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {!task.mine && <Card><p className="text-sm text-slate-500">Take the task to see the address and file the report.</p></Card>}

          {task.mine && visit && (
            <>
              <Card>
                <RailTitle>Checklist</RailTitle>
                <ul className="divide-y divide-slate-100">
                  {checks.map((c, i) => (
                    <li key={c.item} className="grid gap-2 py-2.5 sm:grid-cols-[1fr_8rem]">
                      <span className="text-sm font-medium text-slate-800">{c.item}</span>
                      <select
                        value={c.result ?? ''}
                        disabled={!editable}
                        onChange={(e) => setChecks((xs) => xs.map((x, j) => (j === i ? { ...x, result: e.target.value as VisitCheck['result'] } : x)))}
                        aria-label={c.item}
                        className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                      >
                        <option value="">—</option>
                        {CHECK_RESULTS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <RailTitle aside={editable && <Button variant="secondary" onClick={dropPin}>Drop pin here</Button>}>Location</RailTitle>
                {pin ? (
                  <p className="text-sm text-slate-700">
                    <span className="font-mono">{pin.latitude}, {pin.longitude}</span>
                    {pin.location_accuracy != null && <span className="text-slate-500"> · ±{pin.location_accuracy} m</span>}{' '}
                    <a href={mapLink(pin.latitude, pin.longitude)} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                      Open map
                    </a>
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">No pin yet.</p>
                )}
              </Card>

              <Card>
                <RailTitle
                  aside={
                    editable && (
                      <label className="cursor-pointer rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                        Add photo
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          capture="environment"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file)
                              void act(async () => {
                                await uploadFile(file, { doctype: 'GDB Field Task', docname: name });
                                return fo.task(name);
                              });
                          }}
                        />
                      </label>
                    )
                  }
                >
                  Photos
                </RailTitle>
                {task.photos.length ? (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {task.photos.map((p) => (
                      <li key={p.name} className="space-y-1">
                        <a href={p.file_url} target="_blank" rel="noreferrer">
                          <img src={p.file_url} alt={p.file_name} className="aspect-square w-full rounded-md border border-slate-200 object-cover" />
                        </a>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => void act(() => fo.removePhoto(name, p.name))}
                            className="text-xs font-medium text-rose-600 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No photos yet.</p>
                )}
              </Card>
            </>
          )}

          {task.mine && !visit && (
            <Card className="space-y-3">
              <RailTitle>Reference calls</RailTitle>
              {calls.map((c, i) => (
                <div key={i} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">Call {i + 1}</span>
                    {editable && calls.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCalls((xs) => xs.filter((_, j) => j !== i))}
                        className="text-xs font-medium text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid gap-x-3 sm:grid-cols-3">
                    <label className="mt-2 block text-sm font-medium text-slate-700">
                      Contact
                      <input value={c.contact_name ?? ''} disabled={!editable} onChange={(e) => setCall(i, { contact_name: e.target.value })} className={FIELD} />
                    </label>
                    <label className="mt-2 block text-sm font-medium text-slate-700">
                      Phone
                      <PhoneInput value={c.phone ?? ''} disabled={!editable} onChange={(v) => setCall(i, { phone: v })} className={FIELD} />
                    </label>
                    <label className="mt-2 block text-sm font-medium text-slate-700">
                      Relationship
                      <input value={c.relationship ?? ''} disabled={!editable} onChange={(e) => setCall(i, { relationship: e.target.value })} className={FIELD} />
                    </label>
                    <label className="mt-2 block text-sm font-medium text-slate-700">
                      Result
                      <select value={c.result} disabled={!editable} onChange={(e) => setCall(i, { result: e.target.value as ContactAttempt['result'] })} className={FIELD}>
                        {CALL_RESULTS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    {c.result === 'Reached' && (
                      <label className="mt-2 block text-sm font-medium text-slate-700">
                        Verdict
                        <select value={c.verdict ?? ''} disabled={!editable} onChange={(e) => setCall(i, { verdict: e.target.value as ContactAttempt['verdict'] })} className={FIELD}>
                          <option value="">Choose…</option>
                          {VERDICTS.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <label className="mt-2 block text-sm font-medium text-slate-700">
                    Note
                    <input value={c.note ?? ''} disabled={!editable} onChange={(e) => setCall(i, { note: e.target.value })} className={FIELD} />
                  </label>
                  {c.attempted_on && <p className="mt-1 text-xs text-slate-400">{formatDate(c.attempted_on)}</p>}
                </div>
              ))}
              {editable && (
                <button type="button" onClick={() => setCalls((xs) => [...xs, { ...EMPTY_CALL }])} className="text-sm font-medium text-brand hover:underline">
                  + Add call
                </button>
              )}
            </Card>
          )}

          {task.mine && (
            <Card>
              <label className="block text-sm font-semibold text-slate-900">
                Notes
                <textarea value={findings} disabled={!editable} onChange={(e) => setFindings(e.target.value)} rows={4} className={FIELD} />
              </label>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
