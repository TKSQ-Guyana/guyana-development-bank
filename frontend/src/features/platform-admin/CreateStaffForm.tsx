import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EidBoxes } from '../../components/EidBoxes';
import { RequiredMark } from '../../components/ui/RequiredMark';
import { EMPTY_EID, isCompleteEid } from '../../eid';
import { createStaffAccount } from './api';
import type { CreateStaffResult } from './types';
import { errorText, hasReason, inputClass, Notice, ReasonField } from './ui';

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
    <Card>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">New staff account</h2>
          <p className="text-sm text-slate-500">
            They sign in with their work email. A one-time password is shown once the account is
            created; at their first sign-in they choose their own.
          </p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}

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
            Not used to sign in. Recorded so this person can never decide or release a loan of their
            own, filed from their citizen account.
          </p>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">
            Roles
            <RequiredMark />
          </legend>
          <div className="flex flex-wrap gap-3">
            {grantableRoles.map((role) => (
              <label key={role} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} disabled={busy} />
                {role}
              </label>
            ))}
          </div>
        </fieldset>

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
          </label>
        )}

        <ReasonField value={reason} onChange={setReason} disabled={busy} placeholder="e.g. New hire, credit team, starts 1 Oct" />

        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
