import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { EidBoxes } from '../../components/EidBoxes';
import { RequiredMark } from '../../components/ui/RequiredMark';
import { EMPTY_EID, isCompleteEid } from '../../eid';
import { createStaffAccount } from './api';
import type { CreateStaffResult } from './types';
import { errorText, hasReason, inputClass, Notice, ReasonField, RolePicker } from './ui';

const EXCLUSIVE = ['Facilitator', 'Field Officer'];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="relative pl-10">
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-text">
        {n}
      </span>
      <h3 className="pt-1 text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/** A new GDB staff account: the Frappe account with its roles here, and — when
 *  the portal manages Keycloak — the Keycloak account, set with a one-time
 *  password the next panel shows once. No password is ever typed on this form. */
export function CreateStaffForm({
  grantableRoles,
  regions,
  onCreated,
  onCancel,
}: {
  grantableRoles: string[];
  regions: string[];
  onCreated: (result: CreateStaffResult) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [eid, setEid] = useState(EMPTY_EID);
  const [roles, setRoles] = useState<string[]>([]);
  const [region, setRegion] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eidTyped = eid !== EMPTY_EID;
  const ready = fullName.trim() && email.trim() && roles.length > 0 && hasReason(reason) && (!eidTyped || isCompleteEid(eid));
  const exclusiveClash = roles.length > 1 && roles.some((r) => EXCLUSIVE.includes(r));

  const toggle = (role: string) =>
    setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createStaffAccount({
        full_name: fullName.trim(),
        email: email.trim(),
        eid: isCompleteEid(eid) ? eid : undefined,
        region: region || undefined,
        roles,
        reason: reason.trim(),
      });
      onCreated(result);
    } catch (err) {
      setError(errorText(err, 'The account was not created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-7 pb-4">
      {error && <Notice tone="error">{error}</Notice>}

      <Step n={1} title="The person">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Full name
            <RequiredMark />
          </span>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Work email
            <RequiredMark />
          </span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="name@gdb.gov.gy"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">This is what they sign in with.</span>
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">National e-ID</span>
          <EidBoxes
            value={eid}
            onChange={setEid}
            disabled={busy}
            required={false}
            invalid={eidTyped && !isCompleteEid(eid)}
            describedBy="staff-eid-help"
          />
          <p id="staff-eid-help" className="mt-1 text-xs text-slate-500">
            Optional, not used to sign in. Recorded so this person can never decide or release a loan
            they applied for themselves.
          </p>
        </div>
      </Step>

      <Step n={2} title="Access">
        <RolePicker roles={grantableRoles} selected={roles} onToggle={toggle} disabled={busy} />
        {exclusiveClash && (
          <Notice tone="warning">Facilitator and Field Officer must be held alone — the server will refuse this combination.</Notice>
        )}
        {roles.includes('Field Officer') && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Region</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} className={inputClass}>
              <option value="">None</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">A Field Officer sees only applicants in their region.</span>
          </label>
        )}
      </Step>

      <Step n={3} title="Record why">
        <ReasonField value={reason} onChange={setReason} disabled={busy} placeholder="e.g. New hire, credit team, starts 1 Oct" />
      </Step>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !ready}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </div>
    </form>
  );
}
