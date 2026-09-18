import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { call, uploadFile } from '../api';
import { useAuth } from '../auth';
import type { ApplicantDocument, InformationRequest } from '../types';
import { formatDate } from '../utils';

/** What the Bank has asked for, itemised.
 *
 *  An underwriter who needs another document raises an item here instead of
 *  sending a message: the ask becomes something the applicant can see, answer
 *  by uploading against it, and watch close — and something an examiner can
 *  count. A case waiting on a conversation is a case nobody can report on.
 *
 *  The applicant answers in place. The upload is the same three steps the
 *  document shelf uses, with the request named, so satisfying it is the
 *  server's conclusion rather than a box someone remembered to tick.
 */

const DOCTYPE = 'GDB Applicant Document';

const STATUS_STYLE: Record<string, string> = {
  Open: 'bg-amber-100 text-amber-800',
  Satisfied: 'bg-green-100 text-green-800',
  Withdrawn: 'bg-slate-100 text-slate-600',
};

interface Payload {
  requests: InformationRequest[];
  open: number;
}

export function InformationRequests({
  application,
  onChange,
}: {
  application: string;
  onChange?: () => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [item, setItem] = useState('');
  const [type, setType] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call<Payload>('gdb_bank.documents.list_requests', { application }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load requests');
    }
  }, [application]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user?.is_underwriter) return;
    call<{ types: string[] }>('gdb_bank.documents.document_settings')
      .then((s) => setTypes(s.types))
      .catch(() => setTypes([]));
  }, [user?.is_underwriter]);

  const raise = async (e: FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.documents.request_information', {
        application,
        item,
        document_type: type,
      });
      setItem('');
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise the request');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.documents.withdraw_request', { name });
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw the request');
    } finally {
      setBusy(false);
    }
  };

  const answer = async (request: InformationRequest, file: File) => {
    setBusy(true);
    setError(null);
    try {
      const row = await call<ApplicantDocument>('gdb_bank.documents.new_document', {
        document_type: request.document_type || 'Other',
        application,
        request: request.name,
      });
      try {
        await uploadFile(file, { doctype: DOCTYPE, docname: row.name });
        await call('gdb_bank.documents.confirm_document', { name: row.name });
      } catch (err) {
        await call('gdb_bank.documents.delete_document', { name: row.name }).catch(() => {});
        throw err;
      }
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const mine = !user?.is_underwriter && !user?.is_finance;
  if (data.requests.length === 0 && !user?.is_underwriter) return null;

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Information requested by GDB</h2>
        {data.open > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {data.open} open
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {data.requests.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">Nothing has been asked for on this case.</p>
      )}

      {data.requests.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100">
          {data.requests.map((r) => (
            <li key={r.name} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">
                    {r.item}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {r.status}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {r.document_type ? `${r.document_type} · ` : ''}
                    asked {formatDate(r.requested_on)}
                    {r.responded_on ? ` · answered ${formatDate(r.responded_on)}` : ''}
                  </p>
                </div>
                {user?.is_underwriter && r.status === 'Open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void withdraw(r.name)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                )}
              </div>

              {mine && r.status === 'Open' && (
                <label className="mt-2 block text-xs text-slate-500">
                  Answer with a PDF
                  <input
                    type="file"
                    accept=".pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void answer(r, file);
                      e.target.value = '';
                    }}
                    className="mt-1 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gdb-green file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-gdb-green-dark"
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      {user?.is_underwriter && (
        <form onSubmit={(e) => void raise(e)} className="border-t border-slate-200 pt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Ask the applicant for something</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1 text-sm">
              <span className="mb-1 block text-slate-500">What is needed</span>
              <input
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="e.g. Audited financials for 2025"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green"
              >
                <option value="">Any</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || !item.trim()}
              className="rounded-md bg-gdb-green px-4 py-2 text-sm font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-50"
            >
              Request
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
