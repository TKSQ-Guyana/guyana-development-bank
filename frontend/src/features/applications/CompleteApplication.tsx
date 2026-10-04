import { useCallback, useEffect, useState } from "react";
import { call } from "../../api";
import { EidBoxes } from "../../components/EidBoxes";
import { BankAccountForm } from "../../components/profile/BankAccountForm";
import { addDocument, docLabel } from "../../components/DocumentShelf";
import {
  Field,
  MoneyField,
  Notice,
  PhoneField,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/apply/fields";
import { Button } from "../../components/ui/Button";
import { EMPTY_EID, isCompleteEid } from "../../eid";
import type {
  ApplicationGap,
  ApplicationGaps,
  ChecklistDocument,
  DocumentSettings,
} from "../../types";

/** Completing a submitted application, while GDB is still reviewing it.
 *
 *  Only what was left out is offered: the documents not yet on file, and the
 *  answers left blank. Everything already given stays as it was submitted —
 *  the server refuses to overwrite an answer or replace a filed document
 *  (services/application_edit), so this screen is a convenience over that
 *  rule, never the rule itself.
 */
export function CompleteApplication({
  application,
  onSaved,
  onClose,
}: {
  application: string;
  /** Something was added: re-read the case. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const [gaps, setGaps] = useState<ApplicationGaps | null>(null);
  const [settings, setSettings] = useState<DocumentSettings | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGaps(
        await call<ApplicationGaps>("gdb_bank.api.application_gaps", {
          name: application,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load");
    }
  }, [application]);

  useEffect(() => {
    void load();
    call<DocumentSettings>("gdb_bank.documents.document_settings")
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [load]);

  const upload = async (
    item: ChecklistDocument,
    file: File,
    number: string,
  ) => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await addDocument(
        file,
        item.document_type,
        settings,
        application,
        item.id_document_kind
          ? { kind: item.id_document_kind, number }
          : undefined,
      );
      setSaved(`${item.label} uploaded.`);
      await load();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const sections = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => v.trim()),
    );
    if (!Object.keys(sections).length) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const out = await call<{ written: string[] }>(
        "gdb_bank.api.complete_application",
        { name: application, sections },
      );
      setAnswers({});
      setSaved(
        `${out.written.length} answer${out.written.length === 1 ? "" : "s"} added to your application.`,
      );
      await load();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  if (!gaps) {
    return error ? (
      <Notice tone="warn">{error}</Notice>
    ) : (
      <p className="text-sm text-slate-500">Loading…</p>
    );
  }

  const missingDocs = gaps.documents.filter((d) => !d.on_file);
  const filled = Object.values(answers).some((v) => v.trim());

  return (
    <section
      className="space-y-5 rounded-2xl border border-brand/30 bg-white p-5 shadow-xs sm:p-6"
      aria-label="Complete your application"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">
            Complete your application
          </h2>
          <p className="mt-1 max-w-xl text-xs text-slate-600">
            Add what was left out when you applied. Everything you already
            submitted stays as it is and cannot be changed here.
          </p>
        </div>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Done
        </Button>
      </div>

      {error && (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saved}
        </p>
      )}

      {/* Where the loan is paid: the same fields as the loan forms, and
          changeable while GDB reviews — it is the person's account, not an
          answer on the application. */}
      <div>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Bank account
        </h3>
        <div className="rounded-xl border border-slate-200 p-4">
          <BankAccountForm />
        </div>
      </div>

      {/* The checklist: every document, on file or not. Only missing ones
          take an upload. */}
      <div>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Documents
        </h3>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {gaps.documents.map((d) => (
            <ChecklistRow
              key={d.key}
              item={d}
              busy={busy}
              accepts={
                settings?.accepts_by_type?.[d.document_type] ??
                settings?.accepts ??
                ".pdf"
              }
              onUpload={(file, number) => void upload(d, file, number)}
            />
          ))}
        </ul>
        {missingDocs.length === 0 && (
          <p className="mt-2 text-xs font-semibold text-emerald-700">
            Every document on the checklist is on file.
          </p>
        )}
      </div>

      {/* The answers left blank. */}
      <div>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Missing answers
        </h3>
        {gaps.fields.length === 0 ? (
          <p className="text-xs font-semibold text-emerald-700">
            Every question on your application has been answered.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {gaps.fields.map((g) => (
                <GapField
                  key={g.key}
                  gap={g}
                  value={answers[g.key] ?? ""}
                  onChange={(v) => setAnswers((a) => ({ ...a, [g.key]: v }))}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void save()} disabled={busy || !filled}>
                {busy ? "Saving…" : "Save and update"}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ChecklistRow({
  item,
  busy,
  accepts,
  onUpload,
}: {
  item: ChecklistDocument;
  busy: boolean;
  accepts: string;
  onUpload: (file: File, number: string) => void;
}) {
  const eid = item.id_document_kind === "e-ID";
  const [number, setNumber] = useState(eid ? EMPTY_EID : "");
  const numberReady = !item.id_document_kind
    ? true
    : eid
      ? isCompleteEid(number)
      : number.trim().length > 0;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-black ${
            item.on_file
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-800"
          }`}
          aria-hidden
        >
          {item.on_file ? "✓" : "!"}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">
            {item.id_document_kind ? item.label : docLabel(item.label)}
          </p>
          <p className="text-xs text-slate-500">
            {item.on_file
              ? "Submitted — cannot be changed"
              : item.required
                ? "Expected for this application"
                : "Not on file yet"}
          </p>
        </div>
      </div>

      {!item.on_file && (
        <div className="flex flex-wrap items-end gap-2">
          {item.id_document_kind &&
            (eid ? (
              <div className="w-56">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">
                  e-ID number
                </span>
                <EidBoxes
                  value={number}
                  onChange={setNumber}
                  disabled={busy}
                  required={false}
                />
              </div>
            ) : (
              <label className="block w-44 text-[11px] font-semibold text-slate-500">
                Number on the card
                <input
                  value={number}
                  disabled={busy}
                  onChange={(e) => setNumber(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
            ))}
          <label
            className={`inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-xs font-semibold text-white ${
              busy || !numberReady
                ? "pointer-events-none bg-slate-300"
                : "bg-brand hover:bg-brand-dark"
            }`}
            title={numberReady ? undefined : "Enter the number first"}
          >
            Upload
            <input
              type="file"
              accept={accepts}
              className="sr-only"
              disabled={busy || !numberReady}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file, number);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
    </li>
  );
}

function GapField({
  gap,
  value,
  onChange,
}: {
  gap: ApplicationGap;
  value: string;
  onChange: (v: string) => void;
}) {
  if (gap.key === "phone") {
    return <PhoneField label={gap.label} value={value} onChange={onChange} />;
  }
  if (gap.fieldname === "gdb_applicant_eid") {
    return (
      <Field label={gap.label}>
        <EidBoxes
          value={value || EMPTY_EID}
          onChange={(v) => onChange(v === EMPTY_EID ? "" : v)}
          required={false}
        />
      </Field>
    );
  }
  switch (gap.fieldtype) {
    case "Select":
      return (
        <SelectField
          label={gap.label}
          value={value}
          onChange={onChange}
          options={gap.options ?? []}
        />
      );
    case "Small Text":
      return (
        <div className="sm:col-span-2">
          <TextAreaField label={gap.label} value={value} onChange={onChange} />
        </div>
      );
    case "Currency":
      return <MoneyField label={gap.label} value={value} onChange={onChange} />;
    case "Date":
      return (
        <TextField
          label={gap.label}
          value={value}
          onChange={onChange}
          type="date"
        />
      );
    case "Int":
    case "Percent":
    case "Float":
      return (
        <TextField
          label={gap.label}
          value={value}
          onChange={onChange}
          type="number"
          inputMode="numeric"
        />
      );
    default:
      return <TextField label={gap.label} value={value} onChange={onChange} />;
  }
}
