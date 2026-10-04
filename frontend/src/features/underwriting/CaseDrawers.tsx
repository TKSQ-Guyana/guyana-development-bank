import { useEffect, useState } from "react";
import { call } from "../../api";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import {
  EID_NOTICE,
  EID_REQUEST,
  eidItemFor,
  needsEid,
} from "../../shared/eidNotice";
import type { DocumentSettings, LoanApplication } from "../../types";
import { formatGyd } from "../../utils";

const FIELD =
  "mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** Approve or decline — the same review_loan call the case page always made,
 *  in a drawer. Approving does NOT issue the Letter of Offer; that stays its
 *  own step in the Offer tab. */
export function DecisionDrawer({
  loan,
  action,
  onClose,
  onDecided,
}: {
  loan: LoanApplication;
  action: "approve" | "reject" | null;
  onClose: () => void;
  onDecided: (loan: LoanApplication) => void;
}) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = action === "approve";
  const noEid = approve && needsEid(loan.applicant_eid);

  useEffect(() => {
    if (action) setError(null);
    // No e-ID on the account: the approval message starts with the notice.
    if (action === "approve" && needsEid(loan.applicant_eid)) {
      setRemarks((r) =>
        r.includes(EID_NOTICE) ? r : r ? `${EID_NOTICE}\n${r}` : EID_NOTICE,
      );
    }
  }, [action, loan.applicant_eid]);

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await call<LoanApplication>("gdb_bank.api.review_loan", {
        name: loan.name,
        action,
        remarks,
      });
      setRemarks("");
      onDecided(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={action !== null}
      onClose={onClose}
      title={approve ? "Approve application" : "Decline application"}
      subtitle={`${loan.applicant_name} · ${loan.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={approve ? "primary" : "danger"}
            className={
              approve ? "" : "bg-rose-600! text-white! hover:bg-rose-700!"
            }
            onClick={() => void submit()}
            disabled={busy}
          >
            {approve ? "Approve" : "Decline application"}
          </Button>
        </>
      }
    >
      <div className="rounded-md bg-slate-50 px-3 py-2">
        <Fact label="Requested" value={formatGyd(loan.loan_amount)} />
        <Fact label="Term" value={`${loan.term_months} months`} />
      </div>

      {noEid && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This applicant has no e-ID on their account, so the message below
          starts with “{EID_NOTICE}” You can edit it.
        </p>
      )}

      <label className="block text-sm font-medium text-slate-700">
        Message to applicant
        <textarea
          rows={5}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          className={FIELD}
        />
      </label>

      {approve && (
        <p className="text-xs text-slate-500">
          Issue the Letter of Offer next, from the Offer tab.
        </p>
      )}

      {error && (
        <p
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}
    </Drawer>
  );
}

interface Item {
  item: string;
  type: string;
}

/** Ask the applicant for one or more things. Each item is one
 *  request_information call — the same call the requests panel makes. */
export function RequestInfoDrawer({
  application,
  applicantEid,
  open,
  onClose,
  onSent,
}: {
  application: string;
  /** The applicant's e-ID, if any: "e-ID" is offered only when there is none. */
  applicantEid?: string | null;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [items, setItems] = useState<Item[]>([{ item: "", type: "" }]);
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    call<DocumentSettings>("gdb_bank.documents.document_settings")
      .then((s) => setTypes(s.request_types ?? s.types))
      .catch(() => setTypes([]));
  }, [open]);

  const offered = needsEid(applicantEid)
    ? types
    : types.filter((t) => t !== EID_REQUEST);

  const set = (i: number, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Choosing "e-ID" fills in what to ask, unless the officer already wrote it;
  // leaving "e-ID" takes that text back out (never the officer's own words).
  const setType = (i: number, type: string) =>
    setItems((xs) =>
      xs.map((x, j) =>
        j !== i ? x : { ...x, type, item: eidItemFor(type, x.item) },
      ),
    );

  const send = async () => {
    const todo = items.filter((x) => x.item.trim());
    if (!todo.length) return;
    setBusy(true);
    setError(null);
    let sent = 0;
    try {
      for (const x of todo) {
        await call("gdb_bank.documents.request_information", {
          application,
          item: x.item,
          document_type: x.type,
        });
        sent++;
      }
      setItems([{ item: "", type: "" }]);
      onSent();
      onClose();
    } catch (err) {
      // Keep only what did not go, so a retry never asks twice.
      const left = todo.slice(sent);
      setItems(left.length ? left : [{ item: "", type: "" }]);
      if (sent) onSent();
      setError(
        err instanceof Error ? err.message : "Could not send the request",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Request information"
      subtitle="Each item appears on the applicant's case."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void send()}
            disabled={busy || !items.some((x) => x.item.trim())}
          >
            Send request
          </Button>
        </>
      }
    >
      {items.map((x, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              Item {i + 1}
            </span>
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <label className="mt-2 block text-sm font-medium text-slate-700">
            What you need
            <input
              value={x.item}
              onChange={(e) => set(i, { item: e.target.value })}
              className={FIELD}
            />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Section
            <select
              value={x.type}
              onChange={(e) => setType(i, e.target.value)}
              className={FIELD}
            >
              <option value="">Any</option>
              {offered.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems((xs) => [...xs, { item: "", type: "" }])}
        className="text-sm font-medium text-brand hover:underline"
      >
        + Add item
      </button>

      {error && (
        <p
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}
    </Drawer>
  );
}

const FIELD_KINDS = ["Site Visit", "Reference Check"] as const;

/** Ask a Field Officer in the applicant's region for a site visit or a
 *  reference check. The report comes back onto this case (Credit risk tab). */
export function FieldTaskDrawer({
  application,
  open,
  onClose,
  onSent,
}: {
  application: string;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<string>(FIELD_KINDS[0]);
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("gdb_bank.field_officer.request_field_task", {
        application,
        kind,
        instructions,
        due_date: due || undefined,
        address: address || undefined,
      });
      setInstructions("");
      setDue("");
      setAddress("");
      onSent();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the request",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Request field visit"
      subtitle="Goes to Field Officers in the applicant's region."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void send()}
            disabled={busy || !instructions.trim()}
          >
            Send request
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium text-slate-700">
        Task
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={FIELD}
        >
          {FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        What to check
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          className={FIELD}
        />
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Due
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className={FIELD}
        />
      </label>
      {kind === "Site Visit" && (
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Address{" "}
          <span className="font-normal text-slate-400">
            (defaults to the applicant's)
          </span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={FIELD}
          />
        </label>
      )}
      {error && (
        <p
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}
    </Drawer>
  );
}
