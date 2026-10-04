import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../../api";
import type { ApplicantDocument, DocumentShelf as Shelf } from "../../types";
import { formatDate } from "../../utils";
import {
  acceptsFor,
  addDocument,
  formatsLabel,
  sizeLabel,
} from "../DocumentShelf";
import { IdNumberLine, useIdentityPrompt } from "../IdentityDetails";

/** The application's evidence as one tile per document type, each its own drop
 *  zone — the wizard's Documents tab, the Financial information step, and the
 *  review's optional "anything else" row. Same three calls as DocumentShelf
 *  (`addDocument`); what is expected is the server's `missing` list, and it
 *  stays advisory.
 *
 *  BEFORE THE DRAFT EXISTS (`application` null) a case document has nowhere to
 *  live yet, so the file is checked against the server's rules now and HELD by
 *  the caller (`queued` / `onQueue`), to be uploaded the moment the draft is
 *  saved. A personal document — identity, proof of address — belongs to the
 *  person, not the case, and is uploaded straight away either way. */

export interface DocRow {
  type: string;
  title: string;
  hint: string;
}

/** Files picked before the draft existed, by document type. */
export type QueuedFiles = Record<string, File[]>;

const PERSONAL = new Set([
  "Identity",
  "Proof of Address",
  "Personal Financials",
]);

const STATUS_TONE: Record<string, string> = {
  Received: "bg-sky-50 text-sky-700 ring-sky-200",
  Accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Rejected: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function ApplicationDocuments({
  application,
  rows,
  onChange,
  queued,
  onQueue,
  summary = true,
}: {
  application: string | null;
  rows: DocRow[];
  /** The server's still-expected types, after every load (only once a draft exists). */
  onChange?: (missing: string[]) => void;
  queued?: QueuedFiles;
  onQueue?: (next: QueuedFiles) => void;
  /** The "N of M added" bar above the tiles. */
  summary?: boolean;
}) {
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identityPrompt = useIdentityPrompt(shelf?.settings.id_document_kinds);

  const load = useCallback(async () => {
    try {
      const data = await call<Shelf>(
        "gdb_bank.documents.list_documents",
        application ? { application } : {},
      );
      setShelf(data);
      if (application) onChange?.(data.missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents");
    }
  }, [application, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = (
    file: File,
    type: string,
    settings: Shelf["settings"],
  ): string | null => {
    const accepts = acceptsFor(settings, type);
    const allowed = accepts
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (allowed.length && !allowed.includes(extension))
      return `${file.name}: use ${formatsLabel(accepts)}.`;
    if (file.size > settings.max_bytes)
      return `${file.name} is ${sizeLabel(file.size)}. The limit is ${Math.round(settings.max_bytes / 1024 / 1024)} MB.`;
    return null;
  };

  const add = async (type: string, files: File[]) => {
    if (!shelf || files.length === 0) return;
    setError(null);
    // Held until the draft exists — after the same checks the upload would make.
    if (!application && !PERSONAL.has(type)) {
      const problem = files
        .map((f) => check(f, type, shelf.settings))
        .find(Boolean);
      if (problem) {
        setError(problem);
        return;
      }
      onQueue?.({
        ...(queued ?? {}),
        [type]: [...(queued?.[type] ?? []), ...files],
      });
      return;
    }
    // An identity document says which it is and its number first — one
    // file at a time, each its own document.
    const identities: ({ kind: string; number: string } | undefined)[] = [];
    for (const file of files) {
      if (type !== "Identity") {
        identities.push(undefined);
        continue;
      }
      const answer = await identityPrompt.ask(file.name);
      if (!answer) return;
      identities.push(answer);
    }
    setBusyType(type);
    try {
      for (const [i, file] of files.entries()) {
        await addDocument(
          file,
          type,
          shelf.settings,
          PERSONAL.has(type) ? undefined : (application ?? undefined),
          identities[i],
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      await load();
      setBusyType(null);
    }
  };

  const unqueue = (type: string, index: number) => {
    const next = { ...(queued ?? {}) };
    next[type] = (next[type] ?? []).filter((_, i) => i !== index);
    onQueue?.(next);
  };

  const remove = async (name: string) => {
    setError(null);
    try {
      await call("gdb_bank.documents.delete_document", { name });
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not remove the document",
      );
    }
  };

  if (!shelf)
    return (
      <div className="grid gap-3 md:grid-cols-2" aria-busy>
        {rows.map((r) => (
          <div
            key={r.type}
            className="h-36 animate-pulse rounded-2xl bg-slate-100"
          />
        ))}
      </div>
    );

  const shown = rows.filter((r) => shelf.settings.types.includes(r.type));
  const filesFor = (type: string) =>
    shelf.documents.filter(
      (d) => d.document_type === type && d.status !== "Replaced",
    );
  const added = shown.filter(
    (r) => filesFor(r.type).length > 0 || (queued?.[r.type]?.length ?? 0) > 0,
  ).length;
  const maxMb = Math.round(shelf.settings.max_bytes / 1024 / 1024);

  return (
    <div className="space-y-3">
      {identityPrompt.prompt}
      {summary && shown.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5">
          <p className="text-sm font-bold text-slate-800">
            {added} of {shown.length} added
          </p>
          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-emerald-400 transition-all"
              style={{ width: `${(added / shown.length) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Up to {maxMb} MB per file · optional at submission
          </p>
        </div>
      )}

      {error && (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className={`grid gap-3 ${shown.length > 1 ? "md:grid-cols-2" : ""}`}>
        {shown.map((r) => (
          <DocTile
            key={r.type}
            row={r}
            accept={acceptsFor(shelf.settings, r.type)}
            files={filesFor(r.type)}
            queued={queued?.[r.type] ?? []}
            expected={shelf.missing.includes(r.type)}
            canUpload={shelf.can_upload}
            busy={busyType === r.type}
            locked={busyType !== null}
            holds={!application && !PERSONAL.has(r.type)}
            onAdd={(list) => void add(r.type, list)}
            onRemove={(name) => void remove(name)}
            onUnqueue={(i) => unqueue(r.type, i)}
          />
        ))}
      </div>
    </div>
  );
}

function DocTile({
  row,
  accept,
  files,
  queued,
  expected,
  canUpload,
  busy,
  locked,
  holds,
  onAdd,
  onRemove,
  onUnqueue,
}: {
  row: DocRow;
  accept: string;
  files: ApplicantDocument[];
  queued: File[];
  expected: boolean;
  canUpload: boolean;
  busy: boolean;
  locked: boolean;
  /** Files are held until the draft is saved, not uploaded now. */
  holds: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (name: string) => void;
  onUnqueue: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const has = files.length > 0 || queued.length > 0;
  const rejected = files.some((f) => f.status === "Rejected");

  const state = rejected
    ? {
        label: "Needs replacing",
        tone: "bg-rose-50 text-rose-700 ring-rose-200",
      }
    : files.length
      ? {
          label: "Uploaded",
          tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        }
      : queued.length
        ? { label: "Ready", tone: "bg-sky-50 text-sky-700 ring-sky-200" }
        : expected
          ? {
              label: "Expected",
              tone: "bg-amber-50 text-amber-700 ring-amber-200",
            }
          : {
              label: "Optional",
              tone: "bg-slate-100 text-slate-500 ring-slate-200",
            };

  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-4 transition-all ${
        over
          ? "border-brand shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
          : has
            ? "border-emerald-200"
            : "border-slate-200 hover:border-slate-300"
      }`}
      onDragOver={(e) => {
        if (!canUpload || locked) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!canUpload || locked) return;
        const list = Array.from(e.dataTransfer.files ?? []);
        if (list.length) onAdd(list);
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${
            has
              ? "bg-brand text-white"
              : expected
                ? "bg-amber-50 text-amber-600"
                : "bg-slate-100 text-slate-500"
          }`}
          aria-hidden
        >
          {has ? <TickGlyph /> : <DocGlyph />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold leading-tight text-slate-900">
            {row.title}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{row.hint}</p>
        </div>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${state.tone}`}
        >
          {state.label}
        </span>
      </div>

      {(files.length > 0 || queued.length > 0) && (
        <ul className="mt-3 space-y-1.5">
          {files.map((d) => (
            <li
              key={d.name}
              className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5"
            >
              <FileBadge name={d.file_name ?? ""} />
              <div className="min-w-0 flex-1">
                {d.file_url ? (
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs font-semibold text-slate-800 hover:text-brand hover:underline"
                  >
                    {d.file_name}
                  </a>
                ) : (
                  <span className="block truncate text-xs font-semibold text-slate-500">
                    No file
                  </span>
                )}
                <span className="block text-[11px] text-slate-500">
                  {[
                    d.file_size ? sizeLabel(d.file_size) : "",
                    d.uploaded_on ? formatDate(d.uploaded_on) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <IdNumberLine doc={d} />
                {d.review_note && (
                  <span className="block text-[11px] font-medium text-rose-600">
                    {d.review_note}
                  </span>
                )}
              </div>
              <span
                className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                  STATUS_TONE[d.status] ?? STATUS_TONE.Received
                }`}
              >
                {d.status}
              </span>
              {canUpload && (
                <RemoveButton
                  disabled={locked}
                  label={`Remove ${d.file_name}`}
                  onClick={() => onRemove(d.name)}
                />
              )}
            </li>
          ))}
          {queued.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2.5 rounded-lg border border-dashed border-sky-200 bg-sky-50/50 px-2.5 py-1.5"
            >
              <FileBadge name={f.name} />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-800">
                  {f.name}
                </span>
                <span className="block text-[11px] text-sky-700">
                  {sizeLabel(f.size)} · uploads when you save Funding
                </span>
              </div>
              <RemoveButton
                disabled={locked}
                label={`Remove ${f.name}`}
                onClick={() => onUnqueue(i)}
              />
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              if (list.length) onAdd(list);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={locked}
            onClick={() => input.current?.click()}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              over
                ? "border-brand bg-emerald-50 text-brand-dark"
                : "border-slate-200 bg-slate-50/60 text-slate-500 hover:border-brand hover:bg-emerald-50/50 hover:text-brand-dark"
            }`}
          >
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                <span className="font-bold text-brand-dark">Uploading…</span>
              </>
            ) : (
              <>
                <UploadGlyph />
                <span>
                  <b className="font-bold text-slate-700">
                    {has ? "Add another file" : "Drop a file here"}
                  </b>{" "}
                  or{" "}
                  <span className="font-bold text-brand underline-offset-2 hover:underline">
                    browse
                  </span>
                  <span className="text-slate-400">
                    {" "}
                    · {formatsLabel(accept)}
                  </span>
                </span>
              </>
            )}
          </button>
          {holds && !has && (
            <p className="mt-1.5 text-center text-[11px] text-slate-400">
              Uploaded when you save Funding — keep this page open.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FileBadge({ name }: { name: string }) {
  const pdf = /\.pdf$/i.test(name);
  return (
    <span
      className={`grid h-7 w-7 flex-none place-items-center rounded-md text-[9px] font-black ring-1 ${
        pdf
          ? "bg-rose-50 text-rose-600 ring-rose-200"
          : "bg-sky-50 text-sky-700 ring-sky-200"
      }`}
      aria-hidden
    >
      {pdf ? "PDF" : "IMG"}
    </span>
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Remove"
      disabled={disabled}
      onClick={onClick}
      className="grid h-6 w-6 flex-none place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

function DocGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M5 2.5h6.5L15 6v11.5H5v-15Zm6 0V6.5h4M7.5 10.5h5M7.5 13.5h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M5 10.5l3.2 3L15 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4 flex-none"
      aria-hidden
    >
      <path
        d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 13.5V16h12v-2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
