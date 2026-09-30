import { useEffect, useState } from 'react';
import { call } from '../../api';
import { Card } from '../../components/ui/Card';
import { CheckIcon } from '../../components/ui/icons';
import { Notice, Section, SelectField, TextField } from '../../components/apply/fields';
import { REGIONS } from '../../components/apply/cluster';
import { formatDate } from '../../utils';
import { BUSINESS_TYPES, CALL_TIMES } from './model/quickLoan';

/** "I need help from a field officer": who to call, where and when
 *  (gdb_bank.api.request_field_officer). The officer completes the Quick Loan
 *  with the applicant; the applicant still checks and submits it themselves. */
interface FieldOfficerRequestRow {
  name: string;
  applicant_name: string;
  phone: string;
  business_type: string;
  region: string;
  best_time: string | null;
  status: 'Waiting' | 'Contacted' | 'Cancelled';
  requested_on: string;
}

const button =
  'inline-flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-bold transition-colors disabled:opacity-50';

export function FieldOfficerRequest({
  defaultName,
  defaultPhone,
  onBack,
  onApplySelf,
}: {
  defaultName: string;
  defaultPhone: string;
  onBack: () => void;
  onApplySelf: () => void;
}) {
  const [request, setRequest] = useState<FieldOfficerRequestRow | null | undefined>(undefined);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [type, setType] = useState('');
  const [other, setOther] = useState('');
  const [region, setRegion] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<FieldOfficerRequestRow | null>('gdb_bank.api.my_field_officer_request')
      .then((r) => setRequest(r && r.status === 'Waiting' ? r : null))
      .catch(() => setRequest(null));
  }, []);

  const send = async () => {
    const missing = !name.trim()
      ? 'Enter your name.'
      : !phone.trim()
        ? 'Enter a phone number.'
        : !type
          ? 'Choose the type of business.'
          : type === 'Something else' && !other.trim()
            ? 'Tell us the type of business.'
            : !region
              ? 'Choose a region.'
              : null;
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setRequest(
        await call<FieldOfficerRequestRow>('gdb_bank.api.request_field_officer', {
          applicant_name: name,
          phone,
          business_type: type === 'Something else' ? other : type,
          region,
          best_time: time,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not send your request. Nothing was sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!request || !window.confirm('Cancel this request? No field officer will call you.')) return;
    setBusy(true);
    try {
      setRequest(await call<FieldOfficerRequestRow>('gdb_bank.api.cancel_field_officer_request', { name: request.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the request');
    } finally {
      setBusy(false);
    }
  };

  if (request === undefined) return <p className="text-slate-500">Loading…</p>;

  if (request) {
    const cancelled = request.status === 'Cancelled';
    return (
      <div>
        <header className="mb-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckIcon className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{cancelled ? 'Request cancelled' : 'Request sent'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {cancelled
              ? 'No field officer will call you about this request.'
              : `A GDB field officer for ${request.region.split(' — ')[0]} will call you on ${request.phone}${
                  request.best_time ? `, in the ${request.best_time.toLowerCase()}` : ''
                }.`}
          </p>
        </header>
        <Card className="space-y-6">
          <Section letter="1" title="Request record">
            <p className="text-sm text-slate-600">
              {request.applicant_name} · {request.business_type} · {request.region}
              <br />
              Sent {formatDate(request.requested_on)} · <strong>{request.name}</strong>
              <br />
              Quote this number if you contact GDB.
            </p>
          </Section>
          {!cancelled && (
            <Section letter="2" title="What happens next">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>The field officer calls to arrange a time.</li>
                <li>You go through the application together, in person or by phone.</li>
                <li>You check the answers and submit from your account. Nothing goes to GDB until you do.</li>
              </ol>
            </Section>
          )}
        </Card>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={onBack} className={`${button} text-slate-500 hover:bg-slate-100`}>
            Back to start
          </button>
          {cancelled ? (
            <button type="button" onClick={onApplySelf} className={`${button} bg-brand text-white hover:bg-brand-dark`}>
              Apply myself instead
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
              className={`${button} text-rose-600 hover:bg-rose-50`}
            >
              Cancel request
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5">
        <h2 className="text-2xl font-bold text-slate-900">Get help from a field officer</h2>
        <p className="mt-1 text-sm text-slate-500">
          A GDB field officer calls you and completes the application with you. You check it and submit it from your
          account.
        </p>
      </header>
      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      )}
      <Card className="space-y-6">
        <Section letter="1" title="Who should the field officer call?">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Your name" required value={name} onChange={setName} />
            <TextField
              label="Phone number"
              required
              inputMode="tel"
              value={phone}
              onChange={setPhone}
              placeholder="+592 600 0000"
              hint="The field officer calls this number."
            />
            <SelectField
              label="Type of business"
              required
              value={type}
              onChange={setType}
              options={BUSINESS_TYPES}
              placeholder="Choose a type"
            />
            <SelectField
              label="Region"
              required
              value={region}
              onChange={setRegion}
              options={REGIONS}
              placeholder="Choose a region"
            />
            {type === 'Something else' && (
              <TextField
                label="Tell us the type of business"
                required
                value={other}
                onChange={setOther}
                placeholder="For example: fishing, baking"
              />
            )}
            <SelectField
              label="Best time to call (optional)"
              value={time}
              onChange={setTime}
              options={CALL_TIMES}
              placeholder="Any time"
            />
          </div>
        </Section>
        <Notice tone="info">Nothing goes to GDB as an application until you submit it yourself.</Notice>
      </Card>
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={onBack} className={`${button} text-slate-500 hover:bg-slate-100`}>
          Back
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send()}
          className={`${button} bg-brand text-white shadow-sm shadow-brand/30 hover:bg-brand-dark`}
        >
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </div>
  );
}
