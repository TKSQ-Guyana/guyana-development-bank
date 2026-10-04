import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth";
import { IdSampleLink } from "./IdSamples";
import type { ApplicantDocument } from "../types";

/** Which identity document a file is, and the number printed on it — asked
 *  with every Identity upload so the officer can check the number on the page
 *  against what was typed, and against the KYC register. The server holds the
 *  same rule (evidence.clean_id_number); this only saves a round trip. */
export interface IdentityDetails {
  kind: string;
  number: string;
}

export const ID_DOCUMENT_KINDS = [
  "National ID Card",
  "Passport",
  "Driver's Licence",
  "e-ID",
];

const HINTS: Record<string, string> = {
  "National ID Card": "The number on the front of the card, e.g. 123456789",
  Passport: "The passport number on the photo page, e.g. R0123456",
  "Driver's Licence": "The licence number printed on the card",
  "e-ID": "Your e-ID number, e.g. 592-2001-0101",
};

export const idNumberHint = (kind: string) =>
  HINTS[kind] ?? "As printed on the document";

/** The number as the server keeps it: letters and digits, uppercased. */
export const compactIdNumber = (value: string) =>
  value.toUpperCase().replace(/[\s\-/.]/g, "");

/** Why a typed number cannot be right, or null. */
export function idNumberProblem(kind: string, number: string): string | null {
  const compact = compactIdNumber(number);
  if (!compact) return `Enter the number printed on your ${kind}.`;
  if (!/^[A-Z0-9]{5,20}$/.test(compact))
    return `Enter the ${kind} number as printed on it — letters and digits only.`;
  return null;
}

export const NATIONAL_ID_CARD = "National ID Card";

/** A National ID card's number is the person's National ID: why a typed one
 *  that differs is wrong, or null (server: evidence.require_national_id_match). */
export function nationalIdMismatch(
  kind: string,
  number: string,
  nationalId: string | null | undefined,
): string | null {
  if (kind !== NATIONAL_ID_CARD || !nationalId) return null;
  if (!compactIdNumber(number)) return null;
  return compactIdNumber(number) === compactIdNumber(nationalId)
    ? null
    : `The card number must match your National ID number (${nationalId}).`;
}

/** Ask for the document's kind and number before an Identity upload goes.
 *  `ask(fileName)` opens the dialog and resolves with the answer, or null if
 *  the person cancels; render `prompt` once in the component. */
export function useIdentityPrompt(
  kinds: string[] = ID_DOCUMENT_KINDS,
  defaults?: Partial<IdentityDetails>,
): {
  prompt: ReactNode;
  ask: (fileName: string) => Promise<IdentityDetails | null>;
} {
  const [open, setOpen] = useState<{ fileName: string } | null>(null);
  const resolver = useRef<((v: IdentityDetails | null) => void) | null>(null);
  // The National ID the account was opened with: a National ID card's number.
  const { user } = useAuth();
  const nationalId = user?.national_id ?? null;

  const ask = useCallback((fileName: string) => {
    setOpen({ fileName });
    return new Promise<IdentityDetails | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (value: IdentityDetails | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
  };

  return {
    ask,
    prompt: open ? (
      <IdentityDialog
        fileName={open.fileName}
        kinds={kinds.length ? kinds : ID_DOCUMENT_KINDS}
        defaults={defaults}
        nationalId={nationalId}
        onDone={finish}
      />
    ) : null,
  };
}

function IdentityDialog({
  fileName,
  kinds,
  defaults,
  nationalId,
  onDone,
}: {
  fileName: string;
  kinds: string[];
  defaults?: Partial<IdentityDetails>;
  nationalId: string | null;
  onDone: (value: IdentityDetails | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState(
    defaults?.kind && kinds.includes(defaults.kind) ? defaults.kind : kinds[0],
  );
  const [number, setNumber] = useState(defaults?.number ?? "");
  const [tried, setTried] = useState(false);
  const problem =
    idNumberProblem(kind, number) ||
    nationalIdMismatch(kind, number, nationalId);
  const matches =
    kind === NATIONAL_ID_CARD &&
    !!nationalId &&
    compactIdNumber(number) === compactIdNumber(nationalId);

  /** Choosing the National ID card fills in the National ID on the account. */
  const pickKind = (k: string) => {
    setKind(k);
    if (k === NATIONAL_ID_CARD && nationalId) setNumber(nationalId);
    else if (kind === NATIONAL_ID_CARD && number === nationalId) setNumber("");
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const submit = () => {
    setTried(true);
    if (!problem) onDone({ kind, number: number.trim() });
  };

  // In a portal at the page root, and with no <form> of its own: the shelves
  // sit inside pages that are forms themselves (My details), where a nested
  // form's submit is the outer page's business.
  return createPortal(
    <dialog
      ref={ref}
      onClose={() => onDone(null)}
      aria-labelledby="id-details-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
    >
      <div
        className="space-y-4 p-5"
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName === "INPUT"
          ) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
            Identity document
          </p>
          <h2
            id="id-details-title"
            className="mt-1 text-lg font-black tracking-tight text-slate-900"
          >
            Which document is this?
          </h2>
          <p className="mt-1 truncate text-xs text-slate-500" title={fileName}>
            {fileName}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs font-bold text-slate-700">
            Document
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {kinds.map((k) => (
              <label
                key={k}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  kind === k
                    ? "border-brand bg-emerald-50 text-brand-dark ring-1 ring-brand/30"
                    : "border-slate-200 text-slate-700 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="id-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => pickKind(k)}
                  className="accent-[var(--color-brand)]"
                />
                {k}
              </label>
            ))}
          </div>
          <IdSampleLink kind={kind} className="mt-2" />
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-700">
            {kind} number <span className="text-rose-600">*</span>
          </span>
          <input
            autoFocus
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            aria-invalid={tried && !!problem}
            aria-describedby="id-number-help"
            className={`h-11 w-full rounded-lg border px-3 font-mono text-base tracking-wider focus:outline-none focus:ring-4 ${
              tried && problem
                ? "border-rose-400 focus:ring-rose-100"
                : "border-slate-300 focus:border-brand focus:ring-emerald-100"
            }`}
          />
          <span
            id="id-number-help"
            className={`mt-1 block text-xs ${tried && problem ? "text-rose-600" : "text-slate-500"}`}
          >
            {tried && problem
              ? problem
              : matches
                ? "✓ Matches your National ID number"
                : idNumberHint(kind)}
          </span>
        </label>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          GDB checks this number against the document you attach. Type it
          exactly as printed.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onDone(null)}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-bold text-white hover:bg-brand"
          >
            Upload
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

const CHECK_STYLE: Record<string, { text: string; className: string }> = {
  match: {
    text: "Matches KYC register",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  mismatch: {
    text: "Differs from KYC register",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
  },
  not_on_register: {
    text: "Not on KYC register",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
  },
  no_number: {
    text: "No number given",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
};

/** "Passport · R0123456", and for staff how it compares with the register. */
export function IdNumberLine({ doc }: { doc: ApplicantDocument }) {
  if (doc.document_type !== "Identity") return null;
  const check = doc.register_check;
  const style = check ? CHECK_STYLE[check.status] : null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {doc.id_document_number ? (
        <span className="rounded-md bg-white px-1.5 py-0.5 text-slate-700 ring-1 ring-slate-200">
          {doc.id_document_kind ?? "ID"} ·{" "}
          <span className="font-mono font-bold tracking-wider">
            {doc.id_document_number}
          </span>
        </span>
      ) : (
        <span className="text-slate-400">No document number recorded</span>
      )}
      {style && (
        <span
          className={`rounded-full px-2 py-0.5 font-bold ring-1 ring-inset ${style.className}`}
          title={
            check?.status === "mismatch"
              ? `Register ${check.id_type ?? "ID"} ends ${check.hint}`
              : check?.id_type
                ? `Register ID type: ${check.id_type}`
                : undefined
          }
        >
          {style.text}
          {check?.status === "mismatch" && check.hint
            ? ` (register ${check.hint})`
            : ""}
        </span>
      )}
    </p>
  );
}
