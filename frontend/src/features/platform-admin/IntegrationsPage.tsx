import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { integrationSettings, saveIntegrationSettings, testIntegration } from './api';
import type { IntegrationGroup, IntegrationTest, SettingSource } from './types';
import { errorText, formatDateTime, hasReason, inputClass, Notice, PageHeader, ReasonField } from './ui';

const SOURCE_LABEL: Record<Exclude<SettingSource, null>, string> = {
  settings: 'Set here',
  site_config: 'Site config',
  environment: 'Environment',
};

/** One integration's overrides. A secret is never shown — not masked, not at
 *  all: the server returns only whether one is set. It can be replaced or
 *  removed, and the change is recorded with its reason. */
function GroupCard({ group, onSaved }: { group: IntegrationGroup; onSaved: (groups: IntegrationGroup[]) => void }) {
  const initial = () =>
    Object.fromEntries(group.fields.filter((f) => !f.secret).map((f) => [f.key, f.source === 'settings' ? (f.value ?? '') : '']));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<IntegrationTest | null>(null);

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
    try {
      setTest(await testIntegration(group.key, pending));
    } catch (err) {
      setTest({ ok: false, latency_ms: null, detail: errorText(err, 'Check failed.') });
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{group.label}</h2>
          <p className="text-xs text-slate-400">
            {group.last_change
              ? `Last changed ${formatDateTime(group.last_change.acted_on)} by ${group.last_change.actor}`
              : 'Never changed here'}
          </p>
        </div>
        <Badge tone={group.mode === 'off' ? 'neutral' : group.mode === 'sandbox' ? 'warning' : 'success'}>{group.mode}</Badge>
      </div>

      {group.fields.map((f) => (
        <div key={f.key}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{f.label}</span>
            <span className="text-[11px] text-slate-400">{f.source ? SOURCE_LABEL[f.source] : 'Not set'}</span>
          </div>
          {f.secret ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">
                {removed.includes(f.key) ? 'Will be removed' : f.is_set ? 'Set — never shown' : 'Not set'}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={secrets[f.key] ?? ''}
                onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder="Type a new value to replace it"
                disabled={busy}
                className={`${inputClass} flex-1`}
              />
              {f.source === 'settings' && !removed.includes(f.key) && (
                <Button variant="secondary" type="button" disabled={busy} onClick={() => setRemoved((r) => [...r, f.key])}>
                  Remove override
                </Button>
              )}
            </div>
          ) : (
            <>
              <input
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.source && f.source !== 'settings' ? `${f.value ?? ''} (from ${SOURCE_LABEL[f.source].toLowerCase()})` : ''}
                disabled={busy}
                className={inputClass}
              />
            </>
          )}
        </div>
      ))}
      <p className="text-xs text-slate-400">
        An empty field falls back to the site config, then the environment.
      </p>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Saved and recorded in the access history.</Notice>}
      {test && (
        <Notice tone={test.ok === null ? 'info' : test.ok ? 'success' : 'error'}>
          {test.detail}
          {test.latency_ms !== null && ` (${test.latency_ms} ms)`}
        </Notice>
      )}

      <ReasonField value={reason} onChange={setReason} disabled={busy} />
      <div className="flex gap-2">
        <Button disabled={busy || !dirty || !hasReason(reason)} onClick={() => void onSave()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void onTest()}>
          Test connection
        </Button>
      </div>
    </Card>
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

  return (
    <div>
      <PageHeader
        title="Integrations"
        lede="Keycloak for both sign-in doors and for staff accounts, and the government registries. Values set here override the site config and the environment; secrets are stored encrypted and never shown again."
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
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
