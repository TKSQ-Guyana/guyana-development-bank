import { useCallback, useEffect, useRef, useState } from 'react';
import { call, uploadFile } from '../api';
import { useAuth } from '../auth';
import type { ApplicantDocument, DocumentShelf as Shelf } from '../types';
import { formatDate } from '../utils';

/** The evidence shelf: what the applicant has given GDB, and what is missing.
 *
 *  THREE CALLS TO ADD A DOCUMENT, and the middle one is not ours:
 *
 *    new_document      the row, so there is something to attach to
 *    upload_file       Frappe's own endpoint, which is what makes the private
 *                      file readable by exactly the people who may read the row
 *    confirm_document  the row is stamped with what arrived
 *
 *  Same component both sides of the desk. The server decides whose shelf this
 *  is, whether the reader may upload to it (`can_upload`) and which types it
 *  takes — on a group's case a member gets their own shelf, personal types
 *  only. What is missing is the server's answer too, and it is ADVISORY.
 */

const DOCTYPE = 'GDB Applicant Document';

// `Financials` is the business's accounts; the stored value predates the split.
const LABELS: Record<string, string> = { Financials: 'Business Financials' };
export const docLabel = (type: string) => LABELS[type] ?? type;

const STATUS_STYLE: Record<string, string> = {
  Received: 'bg-slate-100 text-slate-700',
  Accepted: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-700',
  Replaced: 'bg-amber-100 text-amber-800',
};

/** The formats the server accepts for one type — photos for a Trading Photo,
 *  PDF for everything the shelf held before it. */
export function acceptsFor(settings: Shelf['settings'], type: string): string {
  return settings.accepts_by_type?.[type] ?? settings.accepts;
}

/** ".jpg,.jpeg,.png" → "JPG, JPEG or PNG" */
export function formatsLabel(accepts: string): string {
  const names = accepts
    .split(',')
    .map((e) => e.trim().replace(/^\./, '').toUpperCase())
    .filter(Boolean);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] ?? '';
}

export function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Check the file against the shelf's own published rules, then the three
 *  calls. Throws with a message the applicant can act on.
 *
 *  The checks are not a second rule — the same two numbers the shelf already
 *  publishes (accepts, max_bytes). The point is WHO answers: an oversize body
 *  never reaches Frappe's check, it dies at nginx, and an nginx 413 is HTML the
 *  applicant cannot act on. */
export async function addDocument(
  file: File,
  type: string,
  settings: Shelf['settings'],
  application?: string,
): Promise<void> {
  const accepts = acceptsFor(settings, type);
  const accepted = accepts
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (accepted.length && !accepted.includes(extension)) {
    throw new Error(`${file.name}: use ${formatsLabel(accepts)}.`);
  }
  if (file.size > settings.max_bytes) {
    throw new Error(
      `${file.name} is ${sizeLabel(file.size)}. The limit is ${Math.round(
        settings.max_bytes / 1024 / 1024,
      )} MB.`,
    );
  }
  const row = await call<ApplicantDocument>('gdb_bank.documents.new_document', {
    document_type: type,
    application,
  });
  try {
    await uploadFile(file, { doctype: DOCTYPE, docname: row.name });
    await call('gdb_bank.documents.confirm_document', { name: row.name });
  } catch (err) {
    // The row was opened for a file that never arrived. Clear it up rather
    // than leaving an empty shelf entry the applicant cannot explain.
    await call('gdb_bank.documents.delete_document', { name: row.name }).catch(() => {});
    throw err;
  }
}

export function DocumentShelf({
  application,
  applicant,
  only,
  onChange,
  title = 'Documents',
}: {
  /** Omit for a personal shelf (identity, proof of address). */
  application?: string;
  /** Show and accept a single document type — a focused step's one upload. */
  only?: string;
  /** Staff only: read one named person's shelf — a cluster member's own
   *  documents, reached from the head's case. The server refuses this for
   *  anyone but staff, so passing it is not what grants it. */
  applicant?: string;
  /** Called with the server's list of still-missing required types. */
  onChange?: (missing: string[]) => void;
  title?: string;
}) {
  const { user } = useAuth();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await call<Shelf>('gdb_bank.documents.list_documents', {
        application,
        applicant,
      });
      setShelf(data);
      const types = only ? [only] : data.settings.types;
      // Offer what is still missing first.
      setType(
        (current) =>
          (types.includes(current) && current) ||
          data.missing.find((t) => types.includes(t)) ||
          types[0] ||
          '',
      );
      onChange?.(data.missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    }
  }, [application, applicant, only, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (file: File) => {
    if (!type || !shelf) return;
    setBusy(true);
    setError(null);
    try {
      await addDocument(file, type, shelf.settings, application);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.documents.delete_document', { name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the document');
    } finally {
      setBusy(false);
    }
  };

  const review = async (name: string, status: 'Accepted' | 'Rejected') => {
    setBusy(true);
    setError(null);
    try {
      const note =
        status === 'Rejected'
          ? window.prompt('Why is this document not acceptable? The applicant will see this.') ?? ''
          : '';
      if (status === 'Rejected' && !note.trim()) {
        setBusy(false);
        return;
      }
      await call('gdb_bank.documents.review_document', { name, status, note });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the review');
    } finally {
      setBusy(false);
    }
  };

  if (!shelf) return null;

  const canUpload = shelf.can_upload;
  const maxMb = Math.round(shelf.settings.max_bytes / 1024 / 1024);
  const documents = only ? shelf.documents.filter((d) => d.document_type === only) : shelf.documents;
  const live = documents.filter((d) => d.status !== 'Replaced');
  const replaced = documents.filter((d) => d.status === 'Replaced');

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-slate-500">
          {formatsLabel(acceptsFor(shelf.settings, type))} · up to {maxMb} MB each
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* Advisory, never a blocker — the server stopped gating submission on
          this. Staff still see what is outstanding; the applicant-facing
          banner was dropped per product ask. */}
      {!canUpload && shelf.missing.length > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Not on file: <strong>{shelf.missing.map(docLabel).join(', ')}</strong>
        </p>
      )}

      {live.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">Nothing uploaded yet.</p>
      )}

      {live.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100">
          {live.map((d) => (
            <li key={d.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {docLabel(d.document_type)}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      STATUS_STYLE[d.status] ?? 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {d.status}
                  </span>
                  {!d.application && (
                    <span className="ml-2 text-xs text-slate-400">held on the profile</span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
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
                    'no file'
                  )}
                  {d.file_size ? ` · ${sizeLabel(d.file_size)}` : ''}
                  {d.uploaded_on ? ` · ${formatDate(d.uploaded_on)}` : ''}
                </p>
                {d.review_note && (
                  <p className="mt-1 text-xs text-red-700">{d.review_note}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                {canUpload && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(d.name)}
                    className="rounded-xl border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
                {user?.is_underwriter && d.file_url && (
                  <>
                    <button
                      type="button"
                      disabled={busy || d.status === 'Accepted'}
                      onClick={() => void review(d.name, 'Accepted')}
                      className="rounded-md border border-green-600 px-2 py-1 font-medium text-green-700 hover:bg-green-50 disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy || d.status === 'Rejected'}
                      onClick={() => void review(d.name, 'Rejected')}
                      className="rounded-md border border-red-500 px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
          <label className={only ? 'hidden' : 'text-sm'}>
            <span className="mb-1 block text-slate-500">Document type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {shelf.settings.types.map((t) => (
                <option key={t} value={t}>
                  {docLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">File</span>
            <input
              ref={fileInput}
              type="file"
              accept={acceptsFor(shelf.settings, type)}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void add(file);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-dark"
            />
          </label>
          {busy && <span className="pb-2 text-sm text-slate-500">Uploading…</span>}
        </div>
      )}

      {replaced.length > 0 && (
        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer">
            {replaced.length} replaced document{replaced.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-1">
            {replaced.map((d) => (
              <li key={d.name}>
                {docLabel(d.document_type)} · {d.file_name} · {formatDate(d.uploaded_on)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
