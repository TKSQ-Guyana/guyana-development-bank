import { useCallback, useEffect, useRef, useState } from "react";
import { call, uploadFile } from "../api";
import { useAuth } from "../auth";
import type { ApplicantDocument, DocumentShelf as Shelf } from "../types";
import { formatDate } from "../utils";
import { IdNumberLine, useIdentityPrompt } from "./IdentityDetails";

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

const DOCTYPE = "GDB Applicant Document";

// `Financials` is the business's accounts; the stored value predates the split.
const LABELS: Record<string, string> = { Financials: "Business Financials" };
export const docLabel = (type: string) => LABELS[type] ?? type;

const STATUS_STYLE: Record<string, string> = {
  Received: "bg-slate-100 text-slate-700",
  Accepted: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-700",
  Replaced: "bg-amber-100 text-amber-800",
};

/** The formats the server accepts for one type — photos for a Trading Photo,
 *  PDF for everything the shelf held before it. */
export function acceptsFor(settings: Shelf["settings"], type: string): string {
  return settings.accepts_by_type?.[type] ?? settings.accepts;
}

/** ".jpg,.jpeg,.png" → "JPG, JPEG or PNG" */
export function formatsLabel(accepts: string): string {
  const names = accepts
    .split(",")
    .map((e) => e.trim().replace(/^\./, "").toUpperCase())
    .filter(Boolean);
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
    : (names[0] ?? "");
}

export function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  settings: Shelf["settings"],
  application?: string,
  identity?: { kind: string; number: string },
): Promise<void> {
  const accepts = acceptsFor(settings, type);
  const accepted = accepts
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
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
  const row = await call<ApplicantDocument>("gdb_bank.documents.new_document", {
    document_type: type,
    application,
    id_document_kind: identity?.kind,
    id_document_number: identity?.number,
  });
  try {
    await uploadFile(file, { doctype: DOCTYPE, docname: row.name });
    await call("gdb_bank.documents.confirm_document", { name: row.name });
  } catch (err) {
    // The row was opened for a file that never arrived. Clear it up rather
    // than leaving an empty shelf entry the applicant cannot explain.
    await call("gdb_bank.documents.delete_document", { name: row.name }).catch(
      () => {},
    );
    throw err;
  }
}

export function DocumentShelf({
  application,
  applicant,
  only,
  onChange,
  title = "Documents",
  compact = false,
  viewOnly = false,
  listOnly = false,
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
  /** Narrow column (a sidebar): the type and the drop area stack, and no top margin. */
  compact?: boolean;
  /** Show what is on file without asking for it again (the identity document
   *  from registration). Only when nothing is on file can one be added. */
  viewOnly?: boolean;
  /** List what is on file and take nothing: a submitted application, whose
   *  missing documents are added from its checklist (CompleteApplication). */
  listOnly?: boolean;
}) {
  const { user } = useAuth();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const identityPrompt = useIdentityPrompt(shelf?.settings.id_document_kinds);

  const load = useCallback(async () => {
    try {
      const data = await call<Shelf>("gdb_bank.documents.list_documents", {
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
          "",
      );
      onChange?.(data.missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents");
    }
  }, [application, applicant, only, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (file: File) => {
    if (!type || !shelf) return;
    setError(null);
    // An identity document says which it is and its number first.
    const identity =
      type === "Identity" ? await identityPrompt.ask(file.name) : undefined;
    if (identity === null) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setBusy(true);
    try {
      await addDocument(file, type, shelf.settings, application, identity);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await call("gdb_bank.documents.delete_document", { name });
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not remove the document",
      );
    } finally {
      setBusy(false);
    }
  };

  const review = async (name: string, status: "Accepted" | "Rejected") => {
    setBusy(true);
    setError(null);
    try {
      const note =
        status === "Rejected"
          ? (window.prompt(
              "Why is this document not acceptable? The applicant will see this.",
            ) ?? "")
          : "";
      if (status === "Rejected" && !note.trim()) {
        setBusy(false);
        return;
      }
      await call("gdb_bank.documents.review_document", { name, status, note });
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record the review",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!shelf) return null;

  const maxMb = Math.round(shelf.settings.max_bytes / 1024 / 1024);
  const documents = only
    ? shelf.documents.filter((d) => d.document_type === only)
    : shelf.documents;
  const live = documents.filter((d) => d.status !== "Replaced");
  // viewOnly: a document already on file (the identity document from
  // registration) is shown, not asked for again. Only when there is none can
  // one be added here.
  const onFile = viewOnly && live.length > 0;
  const canUpload = shelf.can_upload && !onFile && !listOnly;
  const replaced = documents.filter((d) => d.status === "Replaced");
  const accepts = acceptsFor(shelf.settings, type);

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-xs ${only || compact ? "" : "mt-4"}`}
      aria-label={title}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-200 bg-emerald-50 text-brand-dark">
            <FileGlyph />
          </span>
          <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
          {live.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {live.length}
            </span>
          )}
        </div>
        {!onFile && (
          <span className="text-[11px] text-slate-500">
            {formatsLabel(accepts)} · up to {maxMb} MB each
          </span>
        )}
      </div>

      {error && (
        <p
          className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Advisory, never a blocker — the server stopped gating submission on
          this. Staff still see what is outstanding; the applicant-facing
          banner was dropped per product ask. */}
      {!canUpload && shelf.missing.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Not on file: <strong>{shelf.missing.map(docLabel).join(", ")}</strong>
        </p>
      )}

      {onFile && (
        <p className="mb-2 text-xs text-slate-500">
          From your registration — no need to upload it again.
        </p>
      )}

      {live.length === 0 ? (
        !canUpload && (
          <p className="mb-1 text-sm text-slate-500">Nothing uploaded yet.</p>
        )
      ) : (
        <ul className="mb-4 space-y-2">
          {live.map((d) => (
            <li
              key={d.name}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid h-9 w-9 flex-none place-items-center rounded-lg text-[10px] font-black ${
                    /\.pdf$/i.test(d.file_name ?? "")
                      ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200"
                      : "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                  }`}
                  aria-hidden
                >
                  {/\.pdf$/i.test(d.file_name ?? "") ? "PDF" : "IMG"}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                    {docLabel(d.document_type)}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        STATUS_STYLE[d.status] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {d.status}
                    </span>
                    {!d.application && (
                      <span className="text-[11px] font-medium text-slate-400">
                        on your profile
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {d.file_url ? (
                      <a
                        href={d.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brand hover:underline"
                      >
                        {d.file_name}
                      </a>
                    ) : (
                      "no file"
                    )}
                    {d.file_size ? ` · ${sizeLabel(d.file_size)}` : ""}
                    {d.uploaded_on ? ` · ${formatDate(d.uploaded_on)}` : ""}
                  </p>
                  <IdNumberLine doc={d} />
                  {d.review_note && (
                    <p className="mt-1 text-xs font-medium text-rose-700">
                      {d.review_note}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                {d.file_url && (
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    View
                  </a>
                )}
                {canUpload && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(d.name)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
                {/* Reviewed once: Accept / Reject only while it awaits review. */}
                {user?.is_underwriter &&
                  d.file_url &&
                  d.status === "Received" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review(d.name, "Accepted")}
                        className="rounded-lg border border-green-600 px-2.5 py-1 font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review(d.name, "Rejected")}
                        className="rounded-lg border border-red-500 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
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
        <div
          className={`flex flex-col gap-3 ${compact ? "" : "sm:flex-row sm:items-stretch"}`}
        >
          {!only && (
            <label
              className={`flex flex-col gap-1 text-xs font-bold text-slate-700 ${compact ? "" : "sm:w-56"}`}
            >
              Document type
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium focus:border-brand focus:outline-none focus:ring-4 focus:ring-emerald-100"
              >
                {shelf.settings.types.map((t) => (
                  <option key={t} value={t}>
                    {docLabel(t)}
                    {shelf.missing.includes(t) ? " — needed" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file && !busy) void add(file);
            }}
            className={`flex flex-1 cursor-pointer items-center justify-between gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition-colors ${
              busy
                ? "border-emerald-300 bg-emerald-50/60"
                : "border-slate-300 bg-slate-50/60 hover:border-brand hover:bg-emerald-50/40"
            }`}
          >
            <input
              ref={fileInput}
              type="file"
              accept={accepts}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void add(file);
              }}
              className="sr-only"
            />
            <span className="min-w-0 text-sm">
              <b className="block font-bold text-slate-800">
                {busy
                  ? "Uploading…"
                  : `Add ${only ? docLabel(only).toLowerCase() : docLabel(type).toLowerCase()}`}
              </b>
              <span className="text-xs text-slate-500">
                Click to choose a file, or drag it here
              </span>
            </span>
            <span className="flex-none rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white">
              Browse
            </span>
          </label>
        </div>
      )}

      {replaced.length > 0 && (
        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold">
            {replaced.length} replaced document
            {replaced.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1">
            {replaced.map((d) => (
              <li key={d.name}>
                {docLabel(d.document_type)} · {d.file_name} ·{" "}
                {formatDate(d.uploaded_on)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {identityPrompt.prompt}
    </section>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M5 2.5h6.5L15 6v11.5H5v-15Zm6 0V6.5h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
