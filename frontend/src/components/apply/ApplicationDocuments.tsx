import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../../api';
import type { DocumentShelf as Shelf } from '../../types';
import { formatDate } from '../../utils';
import { acceptsFor, addDocument, formatsLabel, sizeLabel } from '../DocumentShelf';
import { ApplicationsIcon } from '../ui/icons';

/** The application's evidence as one row per document type, each with its own
 *  file picker — the wizard's Documents tab, and the review's optional
 *  "anything else" row. Same three calls as DocumentShelf (`addDocument`);
 *  what is expected is the server's `missing` list, and it stays advisory. */

export interface DocRow {
  type: string;
  title: string;
  hint: string;
}

const STATUS_TONE: Record<string, string> = {
  Received: 'bg-slate-100 text-slate-600',
  Accepted: 'bg-emerald-50 text-emerald-700',
  Rejected: 'bg-rose-50 text-rose-600',
};

export function ApplicationDocuments({
  application,
  rows,
  onChange,
}: {
  application: string;
  rows: DocRow[];
  /** The server's still-expected types, after every load. */
  onChange?: (missing: string[]) => void;
}) {
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await call<Shelf>('gdb_bank.documents.list_documents', { application });
      setShelf(data);
      onChange?.(data.missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    }
  }, [application, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (type: string, files: FileList) => {
    if (!shelf) return;
    setBusyType(type);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await addDocument(file, type, shelf.settings, application);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      await load();
      setBusyType(null);
    }
  };

  const remove = async (name: string) => {
    setError(null);
    try {
      await call('gdb_bank.documents.delete_document', { name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the document');
    }
  };

  if (!shelf) return <p className="text-sm text-slate-500">Loading documents…</p>;

  const maxMb = Math.round(shelf.settings.max_bytes / 1024 / 1024);

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}
      {rows
        .filter((r) => shelf.settings.types.includes(r.type))
        .map((r) => {
          const files = shelf.documents.filter(
            (d) => d.document_type === r.type && d.status !== 'Replaced',
          );
          return (
            <div key={r.type}>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-slate-100 text-slate-500">
                    <ApplicationsIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                      {r.title}
                      {shelf.missing.includes(r.type) && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Expected
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">{r.hint}</p>
                  </div>
                  {shelf.can_upload && (
                    <FilePicker
                      accept={acceptsFor(shelf.settings, r.type)}
                      busy={busyType === r.type}
                      disabled={busyType !== null}
                      label={files.length ? 'Add file' : 'Select file'}
                      onPick={(list) => void upload(r.type, list)}
                    />
                  )}
                </div>
                {files.length > 0 && (
                  <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                    {files.map((d) => (
                      <li key={d.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0 text-xs text-slate-500">
                          {d.file_url ? (
                            <a
                              href={d.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-brand hover:underline"
                            >
                              {d.file_name}
                            </a>
                          ) : (
                            'No file'
                          )}
                          {d.file_size ? ` · ${sizeLabel(d.file_size)}` : ''}
                          {d.uploaded_on ? ` · ${formatDate(d.uploaded_on)}` : ''}
                          {d.review_note && <p className="mt-0.5 text-rose-600">{d.review_note}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              STATUS_TONE[d.status] ?? STATUS_TONE.Received
                            }`}
                          >
                            {d.status}
                          </span>
                          {shelf.can_upload && (
                            <button
                              type="button"
                              disabled={busyType !== null}
                              onClick={() => void remove(d.name)}
                              className="text-xs font-semibold text-slate-400 hover:text-rose-600 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-1 px-1 text-[11px] text-slate-400">
                {formatsLabel(acceptsFor(shelf.settings, r.type))} · up to {maxMb} MB per file
              </p>
            </div>
          );
        })}
    </div>
  );
}

/** A button that opens the browser's own file chooser. */
function FilePicker({
  accept,
  label,
  busy,
  disabled,
  onPick,
}: {
  accept: string;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onPick: (files: FileList) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="flex-none rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Uploading…' : label}
      </button>
    </>
  );
}
