import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { call, setActing, uploadFile } from '../../api';
import { ChoiceCard } from '../../components/apply/fields';
import { acceptsFor, formatsLabel, sizeLabel } from '../../components/DocumentShelf';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Drawer } from '../../components/ui/Drawer';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { StageBadge, StepBar } from '../../components/ui/Stepper';
import type { DocumentShelf, LoanApplication } from '../../types';
import { Apply, type AssistMode } from '../../pages/Apply';
import { formatDate, formatGyd } from '../../utils';
import { QuickApplyPage } from '../quick-loan/QuickApplyPage';
import { fo } from './api';
import { OFFICER_SUBMITTED, submittedByOfficer } from './model/desk';
import { StatusBadge } from './StatusBadge';
import type { AssistConsent } from './types';
import { ASSIST_STEPS, ErrorLine, RailTitle, Row, Timeline } from './ui';

const POLL_MS = 10_000;

type Draft = AssistConsent['drafts'][number];
type OpenRequest = AssistConsent['open_requests'][number];
/** An application still being filled in — kept on the applicant's profile until
 *  GDB holds a Loan Application for it (profiles.pending_applications). */
type Pending = { id: string; state: { businessName?: string; amount?: string }; saved_on: string };

const CHECKBOX = 'mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30';

/** FO.S05 / FO.S06 / FO.S07 / W5 — one applicant the officer is helping, steps 2–4:
 *
 *  Pending:  waiting for the applicant to allow access in their own portal.
 *  Granted:  their applications (new, continue, send back or submit) and the
 *            information requests the officer may put a file against.
 *  Ended:    sent to the applicant — waiting for them, or submitted.
 *
 *  The application itself is filled in HERE, on the Application tab: the
 *  applicant's own form (pages/Apply, or the Quick Loan form) under
 *  `/field/assist/:consent/apply/…`. Every applicant call it makes carries this
 *  consent (api.setActing), so the server works on the applicant's records and
 *  refuses the moment their consent no longer holds. */
export function AssistConsentPage() {
  const { consent = '' } = useParams<{ consent: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onApply = pathname.startsWith(`/field/assist/${consent}/apply`);
  const [c, setC] = useState<AssistConsent | null>(null);
  const [handedOff, setHandedOff] = useState<LoanApplication | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [tab, setTab] = useState<'overview' | 'application' | 'activity'>('overview');
  const [sending, setSending] = useState<Draft | null>(null);
  const [uploading, setUploading] = useState<OpenRequest | null>(null);
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fo.consent(consent)
      .then((next) => {
        setC(next);
        if (next.status === 'Granted') {
          call<Pending[]>('gdb_bank.profiles.pending_applications', { acting: consent })
            .then(setPending)
            .catch(() => setPending([]));
        }
        if (next.application) {
          fo.caseView(next.application)
            .then((v) => setHandedOff(v.case))
            .catch(() => setHandedOff(null));
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [consent]);
  // Again on every move between the form and the overview: the form may have
  // just saved, sent back or submitted, which ends or changes this consent.
  useEffect(load, [load, onApply]);

  // The form below acts for the applicant while this page is open. Set before
  // the form mounts (it renders only once the consent has loaded), cleared on leave.
  useEffect(() => {
    setActing(consent);
    return () => setActing(null);
  }, [consent]);

  // The applicant answers in their own portal; this page follows by itself.
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !c) return <ErrorLine>{error}</ErrorLine>;
  if (!c) return <p className="text-slate-500">Loading…</p>;

  const live = c.status === 'Granted';
  const name = c.applicant_name ?? c.masked_name ?? 'Applicant';
  const first = name.split(' ')[0];
  const submitted = Boolean(handedOff && handedOff.status !== 'Draft');
  const status = c.application
    ? submitted
      ? 'Submitted'
      : 'Waiting for applicant'
    : live
      ? 'In progress'
      : c.status === 'Pending'
        ? 'Waiting for consent'
        : c.status;
  // Submitted: every step done. Handed back: on the last one, with the applicant.
  const step = submitted ? ASSIST_STEPS.length : c.application ? 3 : live ? 2 : 1;
  const apply = (path: string) => navigate(`/field/assist/${consent}/apply${path ? `/${path}` : ''}`);
  const mode: AssistMode = {
    consent,
    applicantName: c.applicant_name,
    applicantEid: c.applicant_eid,
    base: `/field/assist/${consent}/apply`,
    home: `/field/assist/${consent}`,
  };
  const view = onApply && live ? 'application' : tab;
  const hasApplications = c.drafts.length + pending.length > 0;

  const activity = [
    { key: 'asked', title: 'Consent requested', meta: formatDate(c.requested_on) },
    ...(c.responded_on
      ? [{ key: 'answer', title: c.status === 'Declined' ? 'Consent declined' : 'Consent granted', meta: formatDate(c.responded_on) }]
      : []),
    ...c.drafts.map((d) => ({ key: d.name, title: `${d.name} saved`, meta: formatDate(d.modified) })),
    ...(c.ended_on ? [{ key: 'ended', title: c.end_reason || 'Access ended', meta: formatDate(c.ended_on) }] : []),
    ...(submitted && handedOff ? [{ key: 'submitted', title: 'Submitted to GDB', meta: formatDate(handedOff.submitted_on ?? null) }] : []),
  ];

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Work queue
      </Link>

      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{name}</h1>
            <StatusBadge status={status} />
            {handedOff && submittedByOfficer(handedOff) && <Badge tone="brand">{OFFICER_SUBMITTED}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-mono text-xs">{c.applicant_eid}</span>
            <span className="ml-2">{c.name}</span>
            {live && <span className="ml-2">· Access until {formatDate(c.expires_on)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && <Button onClick={() => apply('')}>New application</Button>}
          {(live || c.status === 'Pending') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`End access to ${first}'s records?`)) void act(() => fo.endConsent(consent));
              }}
            >
              End access
            </Button>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorLine>{error}</ErrorLine></div>}

      <Card className="mb-4 p-6">
        <StepBar
          steps={[
            ...ASSIST_STEPS.slice(0, -1),
            submitted ? 'Submitted to GDB' : c.application ? 'Sent to applicant' : ASSIST_STEPS[ASSIST_STEPS.length - 1],
          ]}
          current={step}
        />
      </Card>

      <div className="mb-4">
        <SegmentedControl
          options={[
            { id: 'overview', label: 'Overview' },
            ...(live ? [{ id: 'application' as const, label: 'Application' }] : []),
            { id: 'activity', label: `Activity ${activity.length}` },
          ]}
          value={view}
          onChange={(next) => {
            if (next === 'application') return apply('');
            setTab(next);
            if (onApply) navigate(`/field/assist/${consent}`);
          }}
        />
      </div>

      {view === 'activity' && (
        <Card>
          <Timeline empty="Nothing yet." items={activity} />
        </Card>
      )}

      {view === 'overview' && c.status === 'Pending' && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-slate-800">Waiting for {first} to allow access in their portal.</span>
          <StatusBadge status="Waiting for applicant" />
        </Card>
      )}

      {view === 'overview' && c.status === 'Declined' && (
        <Card>
          <span className="text-sm font-medium text-rose-700">{first} declined access.</span>
        </Card>
      )}

      {view === 'overview' && live && (
        <div className="space-y-4">
          <Card>
            <RailTitle aside={<Button variant="secondary" onClick={() => apply('')}>New application</Button>}>
              Applications
            </RailTitle>
            {!hasApplications ? (
              <p className="text-sm text-slate-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pending.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        {p.state.businessName || 'Untitled'} <Badge tone="warning">In progress</Badge>
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.state.amount ? `${formatGyd(Number(p.state.amount))} · ` : ''}Saved {formatDate(p.saved_on)}
                      </p>
                    </div>
                    <Button variant="secondary" onClick={() => apply(`draft/${p.id}`)}>
                      Continue
                    </Button>
                  </li>
                ))}
                {c.drafts.map((d) => (
                  <li key={d.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        {d.purpose || d.name} <Badge tone="brand">Ready</Badge>
                      </p>
                      <p className="text-xs text-slate-500">
                        {d.name} · {formatGyd(d.loan_amount)} · Saved {formatDate(d.modified)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => apply(d.name)}>
                        Continue
                      </Button>
                      <Button disabled={busy} onClick={() => setSending(d)}>
                        Send to applicant
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <RailTitle aside={c.open_requests.length ? <Badge tone="danger">{c.open_requests.length} open</Badge> : undefined}>
              Information requests
            </RailTitle>
            {!c.open_requests.length ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {c.open_requests.map((r) => (
                  <li key={r.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{r.item}</p>
                      <p className="text-xs text-slate-500">
                        {staged[r.name] ? `${staged[r.name]} · applicant to send` : `${r.application} · ${formatDate(r.requested_on)}`}
                      </p>
                    </div>
                    {!staged[r.name] && (
                      <Button variant="secondary" disabled={busy} onClick={() => setUploading(r)}>
                        Upload
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {view === 'overview' && c.application && (
        <Card>
          <RailTitle aside={handedOff && <StageBadge stage={handedOff.stage} />}>
            {submitted ? 'Submitted' : 'With applicant'}
          </RailTitle>
          <Row label="Application" value={<Link to={`/field/cases/${c.application}`} className="text-brand">{c.application}</Link>} />
          <Row label="Sent" value={formatDate(handedOff?.handed_off_on ?? c.ended_on)} />
          {submitted && <Row label="Submitted" value={formatDate(handedOff?.submitted_on ?? null)} />}
        </Card>
      )}

      {view === 'overview' && !live && !c.application && c.status === 'Ended' && (
        <Card>
          <Row label="Access ended" value={`${c.end_reason || '—'} · ${formatDate(c.ended_on)}`} />
        </Card>
      )}

      {view === 'application' && (
        <Routes>
          <Route
            path="apply"
            element={
              <Card className="space-y-3">
                <RailTitle>New application</RailTitle>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard title="Quick Loan" body="Informal traders" selected={false} onSelect={() => apply('quick')} />
                  <ChoiceCard title="SME Loan" body="Registered or new businesses" selected={false} onSelect={() => apply('new')} />
                </div>
              </Card>
            }
          />
          <Route path="apply/quick" element={<QuickApplyPage assist={mode} />} />
          <Route path="apply/quick/:name" element={<QuickApplyPage assist={mode} />} />
          <Route path="apply/new" element={<Apply assist={mode} />} />
          <Route path="apply/draft/:pid" element={<Apply assist={mode} />} />
          <Route path="apply/:name" element={<Apply assist={mode} />} />
        </Routes>
      )}

      <HandOffDrawer
        draft={sending}
        first={first}
        busy={busy}
        onClose={() => setSending(null)}
        onSend={async (d) => {
          if (await act(() => fo.handOff(consent, d.name))) setSending(null);
        }}
      />
      <UploadDrawer
        consent={consent}
        request={uploading}
        name={name}
        busy={busy}
        onClose={() => setUploading(null)}
        onSave={async (r, file) => {
          // W5: the file goes on the applicant's case against the request; only
          // the applicant sends it (documents.confirm_document refuses the officer).
          const ok = await act(async () => {
            const row = await call<{ name: string }>('gdb_bank.documents.new_document', {
              document_type: r.document_type || 'Other',
              application: r.application,
              request: r.name,
              acting: consent,
            });
            // The type and size were checked in the drawer against the shelf's
            // own rules, so the row is not opened for a file the server refuses.
            await uploadFile(file, { doctype: 'GDB Applicant Document', docname: row.name });
            setStaged((s) => ({ ...s, [r.name]: file.name }));
          });
          if (ok) setUploading(null);
        }}
      />
    </div>
  );
}

/** Step 4: give the draft back for the applicant to check and submit. */
function HandOffDrawer({
  draft,
  first,
  busy,
  onClose,
  onSend,
}: {
  draft: Draft | null;
  first: string;
  busy: boolean;
  onClose: () => void;
  onSend: (d: Draft) => Promise<void>;
}) {
  const [decl, setDecl] = useState([false, false]);
  useEffect(() => setDecl([false, false]), [draft]);
  const declarations = [`Answers read back to ${first} and agreed`, `${first} will review and submit with their own e-ID`];

  return (
    <Drawer
      open={Boolean(draft)}
      onClose={onClose}
      title="Send to applicant"
      subtitle={draft ? `${draft.name} · ${formatGyd(draft.loan_amount)} · ends your access` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !decl.every(Boolean)} onClick={() => draft && void onSend(draft)}>
            Send
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        {declarations.map((l, i) => (
          <label key={l} className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={decl[i]} onChange={() => setDecl((d) => d.map((b, j) => (j === i ? !b : b)))} className={CHECKBOX} />
            {l}
          </label>
        ))}
      </fieldset>
    </Drawer>
  );
}

/** A file for an information request, checked by the officer before it is saved. */
function UploadDrawer({
  consent,
  request,
  name,
  busy,
  onClose,
  onSave,
}: {
  consent: string;
  request: OpenRequest | null;
  name: string;
  busy: boolean;
  onClose: () => void;
  onSave: (r: OpenRequest, file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [checks, setChecks] = useState([false, false, false]);
  const [settings, setSettings] = useState<DocumentShelf['settings'] | null>(null);
  useEffect(() => {
    setFile(null);
    setChecks([false, false, false]);
    if (!request) return;
    // What this document type accepts is the server's rule, published on the
    // applicant's shelf (read under the consent this page acts with).
    // `acting` named here, not left to the page's setActing: this runs in a
    // child effect, which React fires before the page's own.
    call<DocumentShelf>('gdb_bank.documents.list_documents', { application: request.application, acting: consent })
      .then((shelf) => setSettings(shelf.settings))
      .catch(() => setSettings(null));
  }, [request, consent]);
  const accepts = settings && request ? acceptsFor(settings, request.document_type || 'Other') : '';
  const wrongType =
    file && accepts && !accepts.split(',').map((e) => e.trim().toLowerCase()).includes(file.name.slice(file.name.lastIndexOf('.')).toLowerCase());
  const tooBig = file && settings && file.size > settings.max_bytes;
  const labels = ['Readable, nothing cut off', 'The document requested', `Belongs to ${name}`];

  return (
    <Drawer
      open={Boolean(request)}
      onClose={onClose}
      title="Upload"
      subtitle={request?.item}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !file || !!wrongType || !!tooBig || !checks.every(Boolean)} onClick={() => request && file && void onSave(request, file)}>
            Save
          </Button>
        </>
      }
    >
      {!file ? (
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand">
          <span className="text-sm font-semibold text-brand">Take photo or choose file</span>
          <span className="text-xs text-slate-500">{accepts ? formatsLabel(accepts) : '…'}</span>
          <input
            type="file"
            accept={accepts || undefined}
            capture="environment"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </label>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2.5">
            <span className="truncate text-sm font-medium text-slate-800">
              {file.name} · {sizeLabel(file.size)}
            </span>
            <button type="button" onClick={() => setFile(null)} className="text-xs font-medium text-brand hover:underline">
              Change
            </button>
          </div>
          {wrongType && <ErrorLine>Use {formatsLabel(accepts)}.</ErrorLine>}
          {tooBig && <ErrorLine>Too large. Limit {Math.round(settings!.max_bytes / 1024 / 1024)} MB.</ErrorLine>}
          <fieldset className="space-y-2">
            {labels.map((l, i) => (
              <label key={l} className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={checks[i]} onChange={() => setChecks((cs) => cs.map((b, j) => (j === i ? !b : b)))} className={CHECKBOX} />
                {l}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </Drawer>
  );
}
