import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { integrationSettings, saveIntegrationSettings, testIntegration } from './api';
import { ChevronRightIcon, KeyIcon, PlugIcon } from './icons';
import type { IntegrationGroup, IntegrationTest, SettingSource } from './types';
import { errorText, formatDateTime, hasReason, inputClass, Notice, PageHeader, ReasonField } from './ui';

const SOURCE_LABEL: Record<Exclude<SettingSource, null>, string> = {
  settings: 'Set here',
  site_config: 'Site config',
  environment: 'Environment',
};

const SOURCE_TONE: Record<Exclude<SettingSource, null>, string> = {
  settings: 'bg-brand-light text-brand-text',
  site_config: 'bg-sky-50 text-sky-700',
  environment: 'bg-violet-50 text-violet-700',
};

/** One integration's overrides. A secret is never shown — not masked, not at
 *  all: the server returns only whether one is set. It can be replaced or
 *  removed, and the change is recorded with its reason. */
function GroupCard({ group, onSaved }: { group: IntegrationGroup; onSaved: (groups: IntegrationGroup[]) => void }) {
  const initial = () =>
    Object.fromEntries(group.fields.filter((f) => !f.secret).map((f) => [f.key, f.source === 'settings' ? (f.value ?? '') : '']));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<IntegrationTest | null>(null);
  const [testing, setTesting] = useState(false);

  const changes = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const start = initial();
    for (const f of group.fields) {
      if (f.secret) {
        if (secrets[f.key]) out[f.key] = secrets[f.key];
        else if (removed.includes(f.key)) out[f.key] = '';
      } else if ((values[f.key] ?? '') !== (start[f.key] ?? '')) {
        out[f.key] = values[f.key] ?? '';
      }
    }
    return out;
  };
  const pending = changes();
  const dirty = Object.keys(pending).length > 0;
  const setCount = group.fields.filter((f) => f.is_set || f.source).length;
  const on = group.mode !== 'off';

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const groups = await saveIntegrationSettings(group.key, pending, reason.trim());
      setSecrets({});
      setRemoved([]);
      setReason('');
      setSaved(true);
      onSaved(groups);
    } catch (err) {
      setError(errorText(err, 'The settings were not saved.'));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setTest(null);
    setTesting(true);
    try {
      setTest(await testIntegration(group.key, pending));
    } catch (err) {
      setTest({ ok: false, latency_ms: null, detail: errorText(err, 'Check failed.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow ${open ? 'border-brand/30 shadow-md' : 'border-slate-200/80'}`}>
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl ${on ? 'bg-brand-light text-brand' : 'bg-slate-100 text-slate-400'}`}>
          <PlugIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{group.label}</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {on ? (group.mode === 'live' ? 'Live' : 'Configured') : 'Not configured'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {setCount} of {group.fields.length} settings set ·{' '}
            {group.last_change
              ? `last changed ${formatDateTime(group.last_change.acted_on)} by ${group.last_change.actor}`
              : 'never changed here'}
          </p>
          {test && !open && (
            <p className={`mt-1 text-xs ${test.ok === null ? 'text-slate-500' : test.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
              {test.detail}
              {test.latency_ms !== null && ` (${test.latency_ms} ms)`}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy || testing} onClick={() => void onTest()}>
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button variant={open ? 'secondary' : 'primary'} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Close' : 'Configure'}
            <ChevronRightIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            {group.fields.map((f) => (
              <div key={f.key} className={f.secret ? 'md:col-span-2' : ''}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    {f.secret && <KeyIcon className="h-3.5 w-3.5 text-slate-400" />}
                    {f.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      f.source ? SOURCE_TONE[f.source] : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {f.source ? SOURCE_LABEL[f.source] : 'Not set'}
                  </span>
                </div>
                {f.secret ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={secrets[f.key] ?? ''}
                      onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                      placeholder={
                        removed.includes(f.key)
                          ? 'Will be removed on save'
                          : f.is_set
                            ? 'Set — never shown. Type to replace it.'
                            : 'Not set. Type a value.'
                      }
                      disabled={busy}
                      className={`${inputClass} flex-1`}
                    />
                    {f.source === 'settings' && !removed.includes(f.key) && (
                      <Button variant="danger" type="button" disabled={busy} onClick={() => setRemoved((r) => [...r, f.key])}>
                        Remove
                      </Button>
                    )}
                  </div>
                ) : (
                  <input
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.source && f.source !== 'settings' ? `${f.value ?? ''} (from ${SOURCE_LABEL[f.source].toLowerCase()})` : ''}
                    disabled={busy}
                    className={inputClass}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">An empty field falls back to the site config, then the environment.</p>

          {error && <Notice tone="error">{error}</Notice>}
          {saved && <Notice tone="success">Saved and recorded in the access history.</Notice>}
          {test && (
            <Notice tone={test.ok === null ? 'info' : test.ok ? 'success' : 'error'}>
              {test.detail}
              {test.latency_ms !== null && ` (${test.latency_ms} ms)`}
            </Notice>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <ReasonField value={reason} onChange={setReason} disabled={busy} />
            </div>
            <Button disabled={busy || !dirty || !hasReason(reason)} onClick={() => void onSave()}>
              {busy ? 'Saving…' : dirty ? `Save ${Object.keys(pending).length} change${Object.keys(pending).length === 1 ? '' : 's'}` : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function IntegrationsPage() {
  const [groups, setGroups] = useState<IntegrationGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remount the cards after a save so each starts from what the server holds.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    integrationSettings()
      .then(setGroups)
      .catch((err) => setError(errorText(err, 'Could not load integration settings.')));
  }, []);

  const configured = groups?.filter((g) => g.mode !== 'off').length ?? 0;

  return (
    <div>
      <PageHeader
        title="Integrations"
        lede="Keycloak for both sign-in doors and for staff accounts, and the government registries. Values set here override the site config and the environment; secrets are stored encrypted and never shown again."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {groups && (
        <p className="mb-4 text-sm text-slate-500">
          <span className="font-semibold text-slate-800">{configured}</span> of {groups.length} integrations configured.
        </p>
      )}
      {!groups && !error && <p className="text-sm text-slate-400">Loading…</p>}
      <div className="space-y-4">
        {groups?.map((group) => (
          <GroupCard
            key={`${group.key}-${generation}`}
            group={group}
            onSaved={(next) => {
              setGroups(next);
              setGeneration((g) => g + 1);
            }}
          />
        ))}
      </div>
    </div>
  );
}
