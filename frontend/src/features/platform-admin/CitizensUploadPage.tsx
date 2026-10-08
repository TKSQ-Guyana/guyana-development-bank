import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { HistoryIcon, ProfileIcon } from '../../components/ui/icons';
import { citizenImports, getCitizenImport, previewCitizenImport, runCitizenImport } from './api';
import type { CitizenImport, CitizenImportSummary, ImportRowResult, ImportStatus } from './types';
import {
  errorText,
  formatDateTime,
  hasReason,
  inputClass,
  Notice,
  Panel,
  PageHeader,
  ReasonField,
  StatTile,
} from './ui';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const POLL_MS = 3000;

/** `accept` only filters the picker — a dropped or renamed file still gets
 *  through it, so the name is checked here too. The server checks the bytes. */
function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith('.xlsx');
}

const STATUS_TONES: Record<ImportStatus, string> = {
  Previewed: 'bg-sky-50 text-sky-700',
  Queued: 'bg-amber-50 text-amber-700',
  Running: 'bg-amber-50 text-amber-700',
  Completed: 'bg-emerald-50 text-emerald-700',
  Failed: 'bg-rose-50 text-rose-700',
};

const RESULT_TONES: Record<ImportRowResult, string> = {
  New: 'bg-sky-50 text-sky-700',
  Existing: 'bg-slate-100 text-slate-600',
  Duplicate: 'bg-slate-100 text-slate-600',
  Error: 'bg-rose-50 text-rose-700',
  Created: 'bg-emerald-50 text-emerald-700',
  Failed: 'bg-rose-50 text-rose-700',
};

function Pill({ tone, children }: { tone: string; children: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

const isWorking = (status: ImportStatus) => status === 'Queued' || status === 'Running';

/** The platform administrator uploads the MPS call list; the server reads it,
 *  sorts every row and — only when asked, with a reason — opens a citizen
 *  account for each new person and texts them a temporary password. */
export function CitizensUploadPage() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<CitizenImport | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CitizenImportSummary[]>([]);

  const loadHistory = useCallback(() => {
    citizenImports()
      .then((page) => setHistory(page.rows))
      .catch(() => setHistory([]));
  }, []);

  useEffect(loadHistory, [loadHistory]);

  // Follow a queued or running import until it finishes.
  useEffect(() => {
    if (!batch || !isWorking(batch.status)) return;
    const timer = window.setTimeout(() => {
      getCitizenImport(batch.name)
        .then((next) => {
          setBatch(next);
          if (!isWorking(next.status)) loadHistory();
        })
        .catch((err) => setError(errorText(err, 'Could not check on the import.')));
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [batch, loadHistory]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (picked && !isXlsx(picked)) {
      setFile(null);
      setError('Only Excel .xlsx files can be uploaded.');
      if (input.current) input.current.value = '';
      return;
    }
    setError(null);
    setFile(picked);
  };

  const onUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setBatch(await previewCitizenImport(file));
      setReason('');
      loadHistory();
    } catch (err) {
      setError(errorText(err, 'The workbook could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      setBatch(await runCitizenImport(batch.name, reason.trim()));
    } catch (err) {
      setError(errorText(err, 'The import could not be started.'));
    } finally {
      setBusy(false);
    }
  };

  const open = async (name: string) => {
    setError(null);
    try {
      setBatch(await getCitizenImport(name));
    } catch (err) {
      setError(errorText(err, 'Could not open that import.'));
    }
  };

  const startOver = () => {
    setBatch(null);
    setFile(null);
    setReason('');
    setError(null);
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <PageHeader
        title="Citizens Upload"
        lede="Upload the MPS call list. Every row is checked first; accounts are created only for people GDB does not already have, and each is texted a temporary password."
      />
      <div className="space-y-6">
        {error && <Notice tone="error">{error}</Notice>}

        {!batch && (
          <Panel title="Upload" icon={<ProfileIcon />}>
            <form onSubmit={onUpload} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Excel file (.xlsx)</span>
                <input
                  ref={input}
                  type="file"
                  accept={`.xlsx,${XLSX_MIME}`}
                  onChange={onChange}
                  disabled={busy}
                  className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200`}
                />
              </label>
              <p className="text-xs text-slate-500">
                Every sheet is read. Each needs a header row with NAME, ADDRESS, REGION, CONTACT # and ID Number.
                Uploading creates nothing — you see what would happen first.
              </p>
              <Button type="submit" disabled={!file || busy}>
                {busy ? 'Checking…' : 'Upload'}
              </Button>
            </form>
          </Panel>
        )}

        {batch && <ImportResult batch={batch} reason={reason} setReason={setReason} busy={busy} onRun={onRun} onStartOver={startOver} />}

        <Panel title="Earlier uploads" icon={<HistoryIcon />} bodyClassName="p-0">
          {history.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No uploads yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Import</th>
                    <th className="px-5 py-2.5 font-semibold">File</th>
                    <th className="px-5 py-2.5 font-semibold">Uploaded</th>
                    <th className="px-5 py-2.5 font-semibold">Status</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Rows</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Created</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((row) => (
                    <tr key={row.name} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <button
                          type="button"
                          onClick={() => void open(row.name)}
                          className="font-semibold text-brand hover:underline"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-2.5 text-slate-600">{row.source_file_name}</td>
                      <td className="px-5 py-2.5 text-slate-600">{formatDateTime(row.uploaded_on)}</td>
                      <td className="px-5 py-2.5">
                        <Pill tone={STATUS_TONES[row.status]}>{row.status}</Pill>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{row.total_rows}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{row.created_count}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{row.error_rows + row.failed_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function ImportResult({
  batch,
  reason,
  setReason,
  busy,
  onRun,
  onStartOver,
}: {
  batch: CitizenImport;
  reason: string;
  setReason: (value: string) => void;
  busy: boolean;
  onRun: () => void;
  onStartOver: () => void;
}) {
  const { counts } = batch;
  const previewed = batch.status === 'Previewed';
  const working = isWorking(batch.status);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {batch.name} · {batch.file_name}
          <Pill tone={STATUS_TONES[batch.status]}>{batch.status}</Pill>
        </span>
      }
      icon={<ProfileIcon />}
      action={
        !working && (
          <Button variant="secondary" onClick={onStartOver}>
            Upload another file
          </Button>
        )
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Rows read" value={counts.total} />
          {previewed ? (
            <StatTile label="New" value={counts.new} tone="sky" hint="Will get an account" />
          ) : (
            <StatTile label="Created" value={counts.created} hint={`${counts.sms_sent} texted`} />
          )}
          <StatTile label="Already in GDB" value={counts.existing} hint="Skipped" />
          <StatTile label="Duplicates" value={counts.duplicate} hint="Same ID earlier in the file" />
          <StatTile label="Errors" value={counts.error + counts.failed} hint="See the report" />
        </div>

        {batch.already_imported_as && (
          <Notice tone="warning">
            This exact file was already imported as {batch.already_imported_as}. Rows created then are found again and
            skipped.
          </Notice>
        )}
        {previewed && !batch.sms_configured && (
          <Notice tone="warning">
            SMS is not set up, so nobody will be texted a temporary password. The accounts are still created; each
            person can use “Forgot password” on the sign-in page to set one, with a code sent to the same phone.
          </Notice>
        )}
        {previewed && !batch.keycloak_configured && (
          <Notice tone="error">
            Citizen account management in Keycloak is not configured, so accounts cannot be created on this site.
          </Notice>
        )}
        {batch.notes.map((note) => (
          <Notice key={note} tone="warning">
            {note}
          </Notice>
        ))}
        {batch.failure && <Notice tone="error">{batch.failure}</Notice>}
        {working && (
          <Notice tone="info">
            Creating accounts: {counts.created + counts.failed} of {counts.new} done. This page updates by itself.
          </Notice>
        )}
        {batch.status === 'Completed' && (
          <Notice tone="success">
            {counts.created} account{counts.created === 1 ? '' : 's'} created, {counts.sms_sent} texted.
            {counts.failed > 0 && ` ${counts.failed} could not be created — see the report.`}
          </Notice>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Sheet</th>
                <th className="px-4 py-2 text-right font-semibold">Rows</th>
                <th className="px-4 py-2 text-right font-semibold">{previewed ? 'New' : 'Created'}</th>
                <th className="px-4 py-2 text-right font-semibold">Skipped</th>
                <th className="px-4 py-2 text-right font-semibold">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batch.sheets.map((s) => (
                <tr key={s.sheet}>
                  <td className="px-4 py-2 font-medium text-slate-700">{s.sheet}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.total}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{previewed ? (s.new ?? 0) : (s.created ?? 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{(s.existing ?? 0) + (s.duplicate ?? 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{(s.error ?? 0) + (s.failed ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {batch.issues.length > 0 && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Rows that will not become an account</h3>
              {batch.error_report && (
                <a
                  href={batch.error_report}
                  download
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  Download the report (.xlsx)
                </a>
              )}
            </div>
            <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Sheet · Row</th>
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold">ID</th>
                    <th className="px-4 py-2 font-semibold">Result</th>
                    <th className="px-4 py-2 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batch.issues.map((row) => (
                    <tr key={`${row.sheet}-${row.row_number}`} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {row.sheet} · {row.row_number}
                      </td>
                      <td className="px-4 py-2 text-slate-800">{row.full_name}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                        {row.id_number}
                        {row.id_type && <span className="ml-1 font-sans text-slate-400">({row.id_type})</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Pill tone={RESULT_TONES[row.result]}>{row.result}</Pill>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {batch.issues_truncated && (
              <p className="mt-2 text-xs text-slate-500">Only the first 500 are shown. The report has them all.</p>
            )}
          </div>
        )}
        {batch.issues.length === 0 && batch.error_report && (
          <a href={batch.error_report} download className="inline-block text-sm font-semibold text-brand hover:underline">
            Download the report (.xlsx)
          </a>
        )}

        {previewed && counts.new > 0 && batch.keycloak_configured && (
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <ReasonField
              value={reason}
              onChange={setReason}
              disabled={busy}
              placeholder="e.g. MPS call list, 6 Oct 2026"
            />
            <Button disabled={busy || !hasReason(reason)} onClick={onRun}>
              {busy ? 'Starting…' : `Create ${counts.new} account${counts.new === 1 ? '' : 's'}`}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
