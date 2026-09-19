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
 *  Same component both sides of the desk. The applicant uploads and replaces;
 *  an underwriter reads and marks each item Accepted or Rejected. What is
 *  missing is the server's answer (`missing`), never worked out here. It is
 *  ADVISORY: nothing on this shelf blocks a submission any more, so the
 *  banner prompts, it does not refuse.
 */

const DOCTYPE = 'GDB Applicant Document';

const STATUS_STYLE: Record<string, string> = {
  Received: 'bg-slate-100 text-slate-700',
  Accepted: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-700',
  Replaced: 'bg-amber-100 text-amber-800',
};

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocumentShelf({
  application,
  applicant,
  canUpload,
  onChange,
  title = 'Documents',
}: {
  /** Omit for a personal shelf (identity, proof of address). */
  application?: string;
  /** Staff only: read one named person's shelf — a cluster member's own
   *  documents, reached from the head's case. The server refuses this for
   *  anyone but staff, so passing it is not what grants it. */
  applicant?: string;
  /** The applicant's own view. Staff read the shelf; they never fill it. */
  canUpload: boolean;
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
      setType((current) => current || data.settings.types[0] || '');
      onChange?.(data.missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    }
  }, [application, applicant, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (file: File) => {
    if (!type) return;
    // Say what the server would say, before the file crosses the network.
    // Not a second rule — the same two numbers the shelf already publishes
    // (document_settings: accepts, max_bytes). The point is WHO answers: an
    // oversize body never reaches Frappe's check, it dies at nginx, and an
    // nginx 413 is HTML the applicant cannot act on. Checked here, they are
    // told the size and the limit the moment they pick the file.
    const accepted = shelf?.settings.accepts
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (accepted?.length && !accepted.includes(extension)) {
      setError(
        `${file.name} is not a ${accepted.join(' or ')} file. GDB can only read ${accepted.join(
          ' or ',
        )} documents — export or scan it as ${accepted[0]} and try again.`,
      );
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (shelf && file.size > shelf.settings.max_bytes) {
      setError(
        `${file.name} is ${sizeLabel(file.size)}. The limit is ${Math.round(
          shelf.settings.max_bytes / 1024 / 1024,
        )} MB — please upload a smaller scan.`,
      );
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setBusy(true);
    setError(null);
    try {
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

  const maxMb = Math.round(shelf.settings.max_bytes / 1024 / 1024);
  const live = shelf.documents.filter((d) => d.status !== 'Replaced');
  const replaced = shelf.documents.filter((d) => d.status === 'Replaced');

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-slate-500">
          PDF only · up to {maxMb} MB each
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* Advisory, never a blocker — the server stopped gating submission on
          this. Worded as the prompt it now is for the applicant, and as a fact
          about the file for the staff reading it. */}
      {shelf.missing.length > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {canUpload ? (
            <>
              GDB will ask for your <strong>{shelf.missing.join(', ')}</strong> during review.
              Attaching now is quicker, but you can submit without it.
            </>
          ) : (
            <>
              Not on file: <strong>{shelf.missing.join(', ')}</strong>
            </>
          )}
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
                  {d.document_type}
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
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Document type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {shelf.settings.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">File</span>
            <input
              ref={fileInput}
              type="file"
              accept={shelf.settings.accepts}
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
                {d.document_type} · {d.file_name} · {formatDate(d.uploaded_on)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
