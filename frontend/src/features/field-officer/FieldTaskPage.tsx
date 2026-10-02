import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { uploadFile } from '../../api';
import { Notice, TextAreaField, TextField } from '../../components/apply/fields';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { formatDate } from '../../utils';
import { fo } from './api';
import { FieldReports } from './FieldReports';
import { hasPin, mapLink, referenceGaps, visitGaps, type Gap } from './model/desk';
import { StatusBadge } from './StatusBadge';
import { CALL_RESULTS, VERDICTS, type CallResult, type ContactAttempt, type FieldTask, type Verdict, type VisitCheck } from './types';
import { ErrorLine, RailTitle, Row, Timeline } from './ui';

const CHECK_RESULTS = ['Yes', 'No', 'N/A'] as const;
const EMPTY_CALL: ContactAttempt = { attempted_on: '', contact_name: '', phone: '', relationship: '', result: 'Reached', verdict: '', note: '' };

type Pin = { latitude: number; longitude: number; location_accuracy: number | null };

/** FO.S08 / S09 / S10 — a field task: what the Loan Officer asked, then the
 *  work (visit checklist, photos, location, summary — or the reference calls),
 *  a review of what is still missing, and the report filed on the case. */
export function FieldTaskPage() {
  const { name = '' } = useParams<{ name: string }>();
  const [task, setTask] = useState<FieldTask | null>(null);
  const [checks, setChecks] = useState<VisitCheck[]>([]);
  const [calls, setCalls] = useState<ContactAttempt[]>([]);
  const [pin, setPin] = useState<Pin | null>(null);
  const [findings, setFindings] = useState('');
  const [tab, setTab] = useState<'task' | 'activity'>('task');
  const [step, setStep] = useState<'work' | 'review'>('work');
  const [noteOpen, setNoteOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const take = useCallback((t: FieldTask) => {
    setTask(t);
    setChecks(t.checks);
    setCalls(t.reference_calls.length ? t.reference_calls : [{ ...EMPTY_CALL }, { ...EMPTY_CALL }]);
    setPin(hasPin(t.latitude, t.longitude) ? { latitude: t.latitude!, longitude: t.longitude!, location_accuracy: t.location_accuracy } : null);
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

  const visit = task.kind === 'Site Visit';
  const editable = Boolean(task.mine) && task.status === 'Accepted';
  const reviewing = editable && step === 'review';
  const report = visit
    ? { checks, findings, ...(pin ?? {}) }
    : { reference_calls: calls.filter((c) => c.contact_name?.trim()), findings };
  const gaps: Gap[] = visit
    ? visitGaps({ checks, pinned: Boolean(pin), photos: task.photos.length, findings })
    : referenceGaps(calls);
  const answered = checks.filter((c) => c.result).length;
  const reached = new Set(calls.filter((c) => c.result === 'Reached' && c.verdict).map((c) => c.contact_name?.trim().toLowerCase())).size;
  const progress = visit ? `${answered} of ${checks.length} checks completed` : `${reached} of 2 references verified`;

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

  const setCheck = (i: number, patch: Partial<VisitCheck>) => setChecks((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setCall = (i: number, patch: Partial<ContactAttempt>) => setCalls((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const activity = [
    { key: 'asked', title: `Requested by ${task.requested_by_name ?? 'Loan Officer'}`, meta: formatDate(task.requested_on) },
    ...(task.accepted_on ? [{ key: 'taken', title: `Accepted by ${task.assigned_to_name ?? 'a Field Officer'}`, meta: formatDate(task.accepted_on) }] : []),
    ...(task.visited_on ? [{ key: 'visited', title: 'Location captured', meta: formatDate(task.visited_on) }] : []),
    ...(task.submitted_on
      ? [{ key: 'filed', title: 'Report submitted', meta: formatDate(task.submitted_on) }]
      : []),
    ...(task.cancelled_on ? [{ key: 'cancelled', title: 'Cancelled', meta: [formatDate(task.cancelled_on), task.cancel_reason].filter(Boolean).join(' · ') }] : []),
  ];

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Work queue
      </Link>

      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{task.applicant_name ?? task.kind}</h1>
            <StatusBadge status={task.status} />
            <Badge tone="neutral">{task.kind}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {task.name} ·{' '}
            {task.mine ? (
              <Link to={`/field/cases/${task.application}`} className="text-brand hover:underline">
                {task.application}
              </Link>
            ) : (
              task.application
            )}
            <span className="ml-2">
              From {task.requested_by_name ?? 'the Loan Officer'} · Due {formatDate(task.due_date)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!task.mine && task.status === 'Open' && (
            <Button disabled={busy} onClick={() => void act(() => fo.acceptTask(name))}>
              Accept task
            </Button>
          )}
          {editable && step === 'work' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void act(() => fo.saveReport(name, report)).then((ok) => ok && setSaved(true))}>
                Save
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(() => fo.saveReport(name, report)).then((ok) => {
                    if (ok) {
                      setStep('review');
                      setTab('task');
                    }
                  })
                }
              >
                Review report
              </Button>
            </>
          )}
          {reviewing && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setStep('work')}>
                Back to edit
              </Button>
              <Button
                disabled={busy || gaps.length > 0}
                onClick={() => void act(() => fo.submitReport(name, report)).then((ok) => ok && setStep('work'))}
              >
                Submit field report
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorLine>{error}</ErrorLine></div>}
      {saved && <p className="mb-4 text-sm text-emerald-700">Saved.</p>}

      <div className="mb-4">
        <SegmentedControl
          options={[
            { id: 'task', label: 'Task' },
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
            <Card>
              <RailTitle>Brief</RailTitle>
              <p className="whitespace-pre-wrap text-sm font-medium text-slate-800">{task.instructions}</p>
              <div className="mt-2 border-t border-slate-100 pt-2">
                <Row label="Case" value={task.application} />
                <Row label="Applicant" value={task.applicant_name ?? '—'} />
                {task.applicant_eid && <Row label="e-ID" value={<span className="font-mono text-xs">{task.applicant_eid}</span>} />}
                {task.phone && <Row label="Phone" value={<a href={`tel:${task.phone}`} className="text-brand">{task.phone}</a>} />}
                <Row label="Requested by" value={task.requested_by_name ?? '—'} />
                <Row label="Due" value={formatDate(task.due_date)} />
                <Row label="Region" value={task.region ?? '—'} />
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
          </div>

          <div className="min-w-0 space-y-4">
            {task.status === 'Cancelled' && <Notice tone="warn">Cancelled{task.cancel_reason ? `: ${task.cancel_reason}` : ''}</Notice>}

            {editable && step === 'work' && (
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{progress}</span>
                <span className="flex flex-wrap gap-2">
                  {visit ? (
                    <>
                      <Badge tone={task.photos.length ? 'success' : 'warning'}>{task.photos.length} photos</Badge>
                      <Badge tone={pin ? 'success' : 'warning'}>{pin ? 'Location captured' : 'No location yet'}</Badge>
                    </>
                  ) : (
                    <Badge tone="neutral">{calls.filter((c) => c.contact_name?.trim()).length} calls</Badge>
                  )}
                </span>
              </Card>
            )}

            {editable && step === 'work' && visit && (
              <>
                <Card className="space-y-1">
                  <RailTitle>Checklist</RailTitle>
                  <ol className="divide-y divide-slate-100">
                    {checks.map((c, i) => {
                      const needNote = c.result === 'No';
                      const showNote = needNote || Boolean(c.note) || noteOpen.has(c.item);
                      return (
                        <li key={c.item} className="space-y-2 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-800">
                              {i + 1}. {c.item}
                            </span>
                            <SegmentedControl
                              options={CHECK_RESULTS.map((r) => ({ id: r, label: r }))}
                              value={(c.result || '') as (typeof CHECK_RESULTS)[number]}
                              onChange={(result) => setCheck(i, { result })}
                            />
                          </div>
                          {showNote && (
                            <TextField
                              label={needNote ? 'Note — required for "No"' : 'Note'}
                              required={needNote}
                              value={c.note ?? ''}
                              
                              onChange={(note) => setCheck(i, { note })}
                            />
                          )}
                          {!showNote && (
                            <button
                              type="button"
                              onClick={() => setNoteOpen((s) => new Set(s).add(c.item))}
                              className="text-xs font-medium text-brand hover:underline"
                            >
                              + Add note
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </Card>

                <Card>
                  <RailTitle
                    aside={
                      <label className="cursor-pointer rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                        Take photo
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
                                // The photos only: the checklist, pin and notes on
                                // screen are not saved yet and must survive this.
                                setTask(await fo.task(name));
                              });
                          }}
                        />
                      </label>
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
                          <button type="button" onClick={() => void act(async () => setTask(await fo.removePhoto(name, p.name)))} className="text-xs font-medium text-rose-600 hover:underline">
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">None yet.</p>
                  )}
                </Card>

                <Card className="space-y-2">
                  <RailTitle aside={<Button variant={pin ? 'secondary' : 'primary'} onClick={dropPin}>{pin ? 'Capture again' : 'Capture my location'}</Button>}>
                    Location
                  </RailTitle>
                  {pin ? (
                    <p className="text-sm text-slate-700">
                      <span className="font-mono">{pin.latitude}, {pin.longitude}</span>
                      {pin.location_accuracy != null && <span className="text-slate-500"> · accurate to {pin.location_accuracy} m</span>}{' '}
                      <a href={mapLink(pin.latitude, pin.longitude)} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                        Open map
                      </a>
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">Not captured.</p>
                  )}
                </Card>
              </>
            )}

            {editable && step === 'work' && !visit && (
              <Card className="space-y-3">
                <RailTitle>References</RailTitle>
                {calls.map((c, i) => (
                  <div key={i} className="space-y-3 rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <CardLabel>Call {i + 1}</CardLabel>
                      {calls.length > 1 && (
                        <button type="button" onClick={() => setCalls((xs) => xs.filter((_, j) => j !== i))} className="text-xs font-medium text-rose-600 hover:underline">
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <TextField label="Reference" required value={c.contact_name ?? ''} onChange={(contact_name) => setCall(i, { contact_name })} />
                      <TextField label="Phone" type="tel" inputMode="tel" value={c.phone ?? ''} onChange={(phone) => setCall(i, { phone })} />
                      <TextField label="Relationship" value={c.relationship ?? ''} onChange={(relationship) => setCall(i, { relationship })} />
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-700">What happened?</p>
                      <SegmentedControl
                        options={CALL_RESULTS.map((r) => ({ id: r, label: r }))}
                        value={c.result}
                        onChange={(result: CallResult) => setCall(i, { result, verdict: result === 'Reached' ? c.verdict : '' })}
                      />
                    </div>
                    {c.result === 'Reached' && (
                      <div>
                        <p className="mb-1.5 text-sm font-medium text-slate-700">Verification result</p>
                        <SegmentedControl
                          options={VERDICTS.map((v) => ({ id: v, label: v }))}
                          value={(c.verdict || '') as Verdict}
                          onChange={(verdict) => setCall(i, { verdict })}
                        />
                      </div>
                    )}
                    <TextField label="Note" value={c.note ?? ''} onChange={(note) => setCall(i, { note })} />
                    {c.attempted_on && <p className="text-xs text-slate-400">{formatDate(c.attempted_on)}</p>}
                  </div>
                ))}
                <button type="button" onClick={() => setCalls((xs) => [...xs, { ...EMPTY_CALL }])} className="text-sm font-medium text-brand hover:underline">
                  + Log another call
                </button>
              </Card>
            )}

            {editable && step === 'work' && (
              <Card>
                <TextAreaField
                  label={visit ? 'Summary of what you saw' : 'Notes'}
                  required={visit}
                  value={findings}
                  onChange={setFindings}
                  rows={4}
                />
              </Card>
            )}

            {reviewing && (
              <>
                {gaps.length ? (
                  <Card className="space-y-2 border-rose-200">
                    <RailTitle>
                      {gaps.length} missing
                    </RailTitle>
                    <ul className="space-y-1.5">
                      {gaps.map((g) => (
                        <li key={g.label}>
                          <button type="button" onClick={() => setStep('work')} className="flex w-full items-center justify-between gap-2 text-left text-sm text-slate-700 hover:text-brand">
                            <span>{g.label}</span>
                            <span className="text-xs text-slate-400">{g.where}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : (
                  <Notice tone="good">Ready to submit.</Notice>
                )}
                <Card>
                  <RailTitle>Report</RailTitle>
                  {visit ? (
                    <>
                      {checks.map((c, i) => (
                        <Row key={c.item} label={`${i + 1}. ${c.item}`} value={c.result ? [c.result, c.note?.trim()].filter(Boolean).join(' — ') : 'Not answered'} />
                      ))}
                      <Row label="Photos" value={`${task.photos.length} taken`} />
                      <Row label="Location" value={pin ? `${pin.latitude}, ${pin.longitude}` : 'Missing'} />
                    </>
                  ) : (
                    calls
                      .filter((c) => c.contact_name?.trim())
                      .map((c, i) => (
                        <Row
                          key={i}
                          label={[c.contact_name, c.relationship].filter(Boolean).join(' · ')}
                          value={[c.result, c.verdict].filter(Boolean).join(' · ')}
                        />
                      ))
                  )}
                  {findings.trim() && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="text-sm text-slate-500">{visit ? 'Summary' : 'Notes'}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{findings}</p>
                    </div>
                  )}
                </Card>
              </>
            )}

            {task.status === 'Submitted' && (
              <>
                <Card>
                  <RailTitle aside={<Badge tone="success">Submitted</Badge>}>Report submitted</RailTitle>
                  <Row label="Submitted" value={formatDate(task.submitted_on)} />
                  <Row
                    label="Evidence"
                    value={visit ? `${task.checks.length} checks · ${task.photos.length} photos · ${hasPin(task.latitude, task.longitude) ? 'location' : 'no location'}` : `${task.reference_calls.length} calls`}
                  />
                </Card>
                <FieldReports tasks={[task]} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
