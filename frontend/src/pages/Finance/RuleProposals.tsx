import { useCallback, useEffect, useState } from 'react';
import { decideRuleProposal, listRuleProposals, proposeRuleChange } from '../../api';
import type { LendingRuleProposal, LendingRuleType } from '../../types';
import { formatDate } from '../../utils';
import { useAuth } from '../../auth';
import { Card, CardLabel } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';

/** Propose a change to a lending rule, and decide one someone else proposed.
 *
 *  The workflow (GDB Lending Rule Proposal / install.ensure_lending_rule_
 *  proposal_workflow) is the source of truth for what state a proposal is in
 *  and who may move it. This page only renders that state and calls
 *  gdb_bank.rules — the same officer who proposed a change is refused a
 *  second time server-side even if this page had a bug and let them try.
 */

const RULE_TYPES: LendingRuleType[] = [
  'Interest Rate',
  'Maximum Loan Amount',
  'Minimum Loan Amount',
  'Loan Term Limits',
  'Required Documents',
  'Standard Conditions',
  'Capacity Calculation',
  'Charges',
];

const STATE_TONE: Record<LendingRuleProposal['workflow_state'], 'neutral' | 'warning' | 'success' | 'danger'> = {
  Draft: 'neutral',
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
};

const emptyForm = {
  rule_type: RULE_TYPES[0],
  current_value: '',
  proposed_value: '',
  justification: '',
  effective_date: new Date().toISOString().slice(0, 10),
};

export function RuleProposals() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<LendingRuleProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    setError(null);
    listRuleProposals()
      .then(setProposals)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await proposeRuleChange(form);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit this proposal');
    } finally {
      setBusy(false);
    }
  };

  const approve = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await decideRuleProposal(name, 'Approve');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve this proposal');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (name: string) => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await decideRuleProposal(name, 'Reject', reason.trim());
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject this proposal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Finance</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Lending Rules</h1>
      <p className="mt-2 text-sm text-slate-500">
        Propose a change to a lending rule. Another Finance officer must decide it — never the one who proposed it.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      <Card className="mt-6">
        <CardLabel>New proposal</CardLabel>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Rule</span>
            <select
              value={form.rule_type}
              onChange={(e) => setForm({ ...form, rule_type: e.target.value as LendingRuleType })}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Effective date</span>
            <input
              type="date"
              value={form.effective_date}
              onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Current value</span>
            <input
              value={form.current_value}
              onChange={(e) => setForm({ ...form, current_value: e.target.value })}
              placeholder="e.g. G$3,000,000"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Proposed value</span>
            <input
              value={form.proposed_value}
              onChange={(e) => setForm({ ...form, proposed_value: e.target.value })}
              placeholder="e.g. G$3,500,000"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-600">Justification</span>
            <textarea
              rows={3}
              value={form.justification}
              onChange={(e) => setForm({ ...form, justification: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4">
          <Button
            disabled={busy || !form.current_value || !form.proposed_value || !form.justification}
            onClick={() => void submit()}
          >
            Propose
          </Button>
        </div>
      </Card>

      <div className="mt-8 space-y-3">
        {proposals === null && <p className="text-sm text-slate-500">Loading…</p>}
        {proposals?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No lending-rule changes have been proposed yet.
          </p>
        )}
        {proposals?.map((p) => (
          <Card key={p.name}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-800">{p.rule_type}</p>
                  <Badge tone={STATE_TONE[p.workflow_state]}>{p.workflow_state}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {p.current_value} <span className="text-slate-400">&rarr;</span> {p.proposed_value}
                </p>
                <p className="mt-1 text-sm text-slate-500">{p.justification}</p>
                <p className="mt-2 text-xs text-slate-400">
                  Effective {formatDate(p.effective_date)} · proposed by {p.proposed_by} on{' '}
                  {formatDate(p.proposed_on)}
                  {p.decided_by && (
                    <>
                      {' '}
                      · decided by {p.decided_by} on {formatDate(p.decided_on ?? '')}
                    </>
                  )}
                </p>
                {p.decision_note && <p className="mt-1 text-xs text-slate-500">Reason: {p.decision_note}</p>}
              </div>

              {p.workflow_state === 'Pending' && p.proposed_by !== user?.user && (
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => void approve(p.name)}>
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => setRejecting(rejecting === p.name ? null : p.name)}
                    >
                      Reject
                    </Button>
                  </div>
                  {rejecting === p.name && (
                    <div className="flex w-64 flex-col gap-2">
                      <textarea
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why is this being turned down?"
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                      <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void reject(p.name)}>
                        Confirm rejection
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {p.workflow_state === 'Pending' && p.proposed_by === user?.user && (
                <Badge tone="neutral">Awaiting another Finance officer</Badge>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
