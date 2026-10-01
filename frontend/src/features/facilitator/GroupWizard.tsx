import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../../api';
import { GroupDetails, MembersTable, PLAN_SECTIONS, SharedPlan } from '../../components/apply/cluster';
import { MoneyField, Notice, ReadOnlyField, Section, TextAreaField, TextField } from '../../components/apply/fields';
import {
  AttentionList,
  ReviewSections,
  StepHeader,
  StepRail,
  primaryButton,
  secondaryButton,
  type Issue,
} from '../../components/apply/wizard';
import { Card } from '../../components/ui/Card';
import { ArrowRightIcon } from '../../components/ui/icons';
import type { Cluster, ClusterPlan, ClusterPlanSection, UseOfFundsRow } from '../../types';
import { encodeUseOfFunds, formatGyd } from '../../utils';
import { groupCase } from './groupCase';

/** The facilitator's group wizard: form the group, enrol its members, write its
 *  plan, request the facility, review and submit — filed in the head's name.
 *
 *  Same chrome as the citizen's application (components/apply/wizard). Every
 *  rule shown here is re-checked by the server (services/cluster.py,
 *  services/application.submit_group_application); this screen only says what
 *  is still missing. Members accept on their own sign-in, so acceptance is
 *  never something this screen can wait on — it is a review item instead. */

type StepId = 'group' | 'members' | 'plan' | 'funding' | 'review';

const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: 'group', title: 'Group details', blurb: 'Group name, activity and region.' },
  { id: 'members', title: 'Members', blurb: 'Invite by e-ID. Name an accepted member as head.' },
  { id: 'plan', title: 'Group plan', blurb: "The group's business case." },
  { id: 'funding', title: 'Facility', blurb: 'Loan amount, tenor and use of proceeds.' },
  { id: 'review', title: 'Review', blurb: '' },
];

const EMPTY_PLAN: ClusterPlan = {
  plan_executive_summary: '',
  plan_how_formed: '',
  plan_governance: '',
  plan_market: '',
  plan_shared_project: '',
  plan_operations: '',
  plan_impact: '',
};

export function GroupWizard() {
  const navigate = useNavigate();
  const { cluster: routeCluster } = useParams<{ cluster: string }>();

  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [loading, setLoading] = useState(Boolean(routeCluster));
  const [step, setStep] = useState<StepId>('group');
  const [furthest, setFurthest] = useState<StepId>('group');

  const [name, setName] = useState('');
  const [activity, setActivity] = useState('');
  const [region, setRegion] = useState('');
  const [locality, setLocality] = useState('');
  const [registered, setRegistered] = useState('');
  const [plan, setPlan] = useState<ClusterPlan>(EMPTY_PLAN);
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('12');
  const [loanPurpose, setLoanPurpose] = useState('');
  const [useOfFunds, setUseOfFunds] = useState<UseOfFundsRow[]>([{ item: '', amount: 0 }]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Fill the form from the server's group. `form` false keeps what is typed. */
  const hydrate = (c: Cluster, form: boolean) => {
    setCluster(c);
    if (!form) return;
    setName(c.name);
    setActivity(c.group_purpose ?? '');
    setRegion(c.region ?? '');
    setLocality(c.locality ?? '');
    setRegistered(c.is_registered ?? '');
    setPlan({ ...EMPTY_PLAN, ...Object.fromEntries(PLAN_SECTIONS.map((s) => [s.key, c.plan?.[s.key] ?? ''])) });
    const app = groupCase(c);
    if (app && app.status !== 'Rejected') {
      setAmount(app.loan_amount ? String(app.loan_amount) : '');
      setTerm(app.term_months ? String(app.term_months) : '12');
      setLoanPurpose(app.purpose ?? '');
      setUseOfFunds(app.use_of_funds?.length ? app.use_of_funds : [{ item: '', amount: 0 }]);
    }
  };

  const refresh = async () => {
    if (!cluster) return;
    hydrate(await call<Cluster>('gdb_bank.api.cluster_view', { cluster: cluster.name }), false);
  };

  // The URL catching up with a group just created is not a request to reload.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!routeCluster || loaded.current === routeCluster) return;
    loaded.current = routeCluster;
    setLoading(true);
    call<Cluster>('gdb_bank.api.cluster_view', { cluster: routeCluster })
      .then((c) => {
        hydrate(c, true);
        // An existing group opens on its review: it lists what is still missing.
        setStep('review');
        setFurthest('review');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCluster]);

  const app = cluster ? groupCase(cluster) : undefined;
  const draftName = app?.status === 'Draft' ? app.name : null;
  // With the Bank and not rejected: the group, plan and facility are frozen.
  const locked = Boolean(app && app.status !== 'Draft' && app.status !== 'Rejected');
  const head = cluster?.members.find((m) => m.is_head);
  const accepted = cluster?.joined_count ?? 0;

  const index = STEPS.findIndex((s) => s.id === step);
  const reached = Math.max(index, STEPS.findIndex((s) => s.id === furthest));
  useEffect(() => {
    if (index > STEPS.findIndex((s) => s.id === furthest)) setFurthest(step);
  }, [index, furthest, step]);
  const frozen = (id: StepId) => locked && (id === 'group' || id === 'plan' || id === 'funding');

  /** Everything a step still lacks, for the review. */
  const missingIn = (id: StepId): string[] => {
    const out: string[] = [];
    if (id === 'group') {
      if (!name.trim()) out.push('Enter the group name.');
      if (!activity.trim()) out.push('Enter the group activity.');
      if (!region) out.push('Select the region.');
      if (!registered) out.push('Select the registration status.');
    }
    if (id === 'members') {
      if (!head) out.push('Name an accepted member as head.');
      if (accepted === 0) out.push('At least one other member must accept.');
    }
    if (id === 'plan') {
      if (!(plan.plan_executive_summary ?? '').trim()) out.push('Enter the executive summary.');
      if (!(plan.plan_shared_project ?? '').trim()) out.push('Describe the shared project.');
    }
    if (id === 'funding') {
      if (!amount || Number(amount) <= 0) out.push('Enter the loan amount.');
      if (!term || Number(term) < 1 || Number(term) > 360) out.push('Enter a tenor of 1 to 360 months.');
      if (!loanPurpose.trim()) out.push('Enter the purpose of the loan.');
      if (!draftName && !locked) out.push('Save the facility request.');
    }
    return out;
  };

  /** What stops Continue. Members never block: acceptance happens elsewhere. */
  const leaveBlocker = (id: StepId): string | null => {
    if (frozen(id)) return null;
    if (id === 'members') return null;
    if (id === 'funding' && !head) return 'Name the group head on Members first.';
    return missingIn(id).filter((m) => m !== 'Save the facility request.')[0] ?? null;
  };

  const run = async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const leaveStep = async (): Promise<boolean> => {
    const blocker = leaveBlocker(step);
    if (blocker) {
      setError(blocker);
      return false;
    }
    setError(null);
    if (frozen(step)) return true;
    if (step === 'group') {
      return run(async () => {
        const details = { group_purpose: activity, region, locality, is_registered: registered };
        if (!cluster) {
          const created = await call<Cluster>('gdb_bank.api.create_cluster', { cluster_name: name.trim(), ...details });
          hydrate(created, false);
          loaded.current = created.name;
          navigate(`/facilitator/groups/${encodeURIComponent(created.name)}`, { replace: true });
        } else {
          hydrate(await call<Cluster>('gdb_bank.api.save_cluster_details', { cluster: cluster.name, ...details }), false);
        }
      });
    }
    if (step === 'plan' && cluster) {
      return run(async () => {
        hydrate(await call<Cluster>('gdb_bank.api.save_cluster_plan', { cluster: cluster.name, ...plan }), false);
      });
    }
    if (step === 'funding' && cluster) {
      return run(async () => {
        await call('gdb_bank.api.save_group_application', {
          cluster: cluster.name,
          loan_amount: Number(amount),
          purpose: loanPurpose,
          term_months: Number(term),
          sections: { use_of_funds: encodeUseOfFunds(useOfFunds) },
          name: draftName ?? undefined,
        });
        await refresh();
      });
    }
    return true;
  };

  const goTo = (id: StepId) => {
    setError(null);
    setStep(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goNext = async () => {
    if (!(await leaveStep())) return;
    goTo(STEPS[Math.min(index + 1, STEPS.length - 1)].id);
  };

  const jumpTo = async (i: number) => {
    if (i === index || i > reached || busy || frozen(STEPS[i].id)) return;
    if (i < index) return goTo(STEPS[i].id);
    if (!(await leaveStep())) return;
    goTo(STEPS[i].id);
  };

  const submit = async () => {
    if (!cluster || !draftName) return;
    if (!window.confirm(`Submit ${cluster.name}'s application to GDB in ${head?.member_name ?? 'the head'}'s name?`)) {
      return;
    }
    const ok = await run(async () => {
      await call('gdb_bank.api.submit_group_application', { cluster: cluster.name, name: draftName });
      await refresh();
    });
    if (ok) setNotice(`Submitted to GDB in ${head?.member_name ?? 'the head'}'s name.`);
  };

  const discard = async () => {
    if (!cluster || !draftName || !window.confirm('Discard the draft application? The group stays.')) return;
    await run(async () => {
      await call('gdb_bank.api.discard_group_application', { cluster: cluster.name, name: draftName });
      setAmount('');
      setTerm('12');
      setLoanPurpose('');
      setUseOfFunds([{ item: '', amount: 0 }]);
      await refresh();
    });
  };

  if (loading) return <p className="text-sm text-slate-500">Loading group…</p>;

  // --- review model -------------------------------------------------------
  const reviewSteps = STEPS.filter((s) => s.id !== 'review');
  const issues: Issue[] = reviewSteps.flatMap((s) =>
    frozen(s.id)
      ? []
      : missingIn(s.id).map((title) => ({
          section: s.id,
          title,
          where: s.title,
          kind: s.id === 'members' ? 'Awaiting members' : 'Required',
          action: s.id === 'members' ? 'Go to members' : 'Go to field',
          go: () => goTo(s.id),
        })),
  );
  const show = (v: string | null | undefined) => (v && String(v).trim()) || '—';
  const sections = reviewSteps.map((s) => ({
    id: s.id,
    title: s.title,
    issues: issues.filter((i) => i.section === s.id).length,
    summary:
      s.id === 'group'
        ? [name, region].filter(Boolean).join(' · ')
        : s.id === 'members'
          ? `${accepted + (head ? 1 : 0)} accepted · ${cluster?.invited_count ?? 0} invited · Head: ${head?.member_name ?? '—'}`
          : s.id === 'plan'
            ? `${PLAN_SECTIONS.filter((p) => (plan[p.key] ?? '').trim()).length} of ${PLAN_SECTIONS.length} sections`
            : [amount && formatGyd(Number(amount)), term && `${term} months`, loanPurpose].filter(Boolean).join(' · '),
    answers: (s.id === 'group'
      ? [
          ['Group name', show(name)],
          ['Group activity', show(activity)],
          ['Region', show(region)],
          ['Locality', show(locality)],
          ['Registration status', show(registered)],
        ]
      : s.id === 'members'
        ? (cluster?.members ?? []).map((m) => [
            `${m.member_name}${m.member_eid ? ` · ${m.member_eid}` : ''}`,
            m.is_head ? 'Head' : m.member_status === 'Active' ? 'Accepted' : m.member_status,
          ])
        : s.id === 'plan'
          ? PLAN_SECTIONS.map((p) => [p.title, show(plan[p.key])])
          : [
              ['Borrower (group head)', head ? `${head.member_name} · ${head.member_eid ?? ''}` : '—'],
              ['Loan amount', amount ? formatGyd(Number(amount)) : '—'],
              ['Tenor', term ? `${term} months` : '—'],
              ['Interest rate', '0%'],
              ['Purpose', show(loanPurpose)],
              [
                'Use of proceeds',
                show(
                  useOfFunds
                    .filter((r) => r.item.trim())
                    .map((r) => `${r.item} — ${formatGyd(r.amount || 0)}`)
                    .join('\n'),
                ),
              ],
            ]) as [string, string][],
  }));

  const current = STEPS[index];
  const isLast = step === 'review';
  const status = locked
    ? `With GDB · ${app?.stage_label || app?.status}`
    : draftName
      ? `Draft ${draftName}`
      : cluster
        ? 'Group saved · no application yet'
        : 'Not yet saved';

  return (
    <div className="space-y-4">
      <StepRail
        steps={STEPS}
        index={index}
        reached={reached}
        attention={(id) => id !== 'review' && issues.some((i) => i.section === id)}
        locked={(i) => frozen(STEPS[i].id)}
        onJump={(i) => void jumpTo(i)}
      />

      {notice && <Notice tone="good">{notice}</Notice>}
      {app?.status === 'Rejected' && !draftName && (
        <Notice tone="warn">Previous application {app.name} was not approved. A new one can be filed.</Notice>
      )}
      {error && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      )}

      <Card className={`space-y-6 p-6 ${isLast ? '' : 'pb-20'}`}>
        <StepHeader title={isLast ? 'Review group application' : current.title} status={status} blurb={current.blurb} />

        {step === 'group' && (
          <Section letter="1" title="Group identification">
            <TextField
              label="Group name"
              required
              value={name}
              onChange={setName}
              disabled={Boolean(cluster)}
              hint={cluster ? 'Fixed once created.' : undefined}
            />
            <GroupDetails
              purpose={activity}
              onPurpose={setActivity}
              region={region}
              onRegion={setRegion}
              locality={locality}
              onLocality={setLocality}
              registered={registered}
              onRegistered={setRegistered}
            />
          </Section>
        )}

        {step === 'members' && cluster && (
          <Section letter="2" title="Group members">
            {head ? (
              <ReadOnlyField
                label="Group head"
                value={`${head.member_name} · ${head.member_eid ?? ''}`}
                source="Borrower"
                hint={app ? 'Fixed once an application exists.' : undefined}
              />
            ) : (
              <Notice tone="warn">No head yet. Name an accepted member — the application is filed in their name.</Notice>
            )}
            <MembersTable cluster={cluster} onChanged={(c) => hydrate(c, false)} headLocked={Boolean(app && app.status !== 'Rejected')} />
            <button type="button" onClick={() => void run(refresh)} disabled={busy} className={secondaryButton}>
              Refresh statuses
            </button>
          </Section>
        )}

        {step === 'plan' && (
          <Section letter="3" title="Group business plan">
            <SharedPlan
              plan={plan}
              onChange={(key: ClusterPlanSection, value: string) => setPlan((p) => ({ ...p, [key]: value }))}
            />
          </Section>
        )}

        {step === 'funding' && (
          <Section letter="4" title="Facility request" blurb="Interest-free. Principal repayment only.">
            <ReadOnlyField
              label="Borrower"
              value={head ? `${head.member_name} · ${head.member_eid ?? ''}` : null}
              source="Group head"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField label="Loan amount" required value={amount} onChange={setAmount} />
              <TextField label="Tenor (months)" required type="number" inputMode="numeric" value={term} onChange={setTerm} />
            </div>
            <TextAreaField label="Purpose of loan" required value={loanPurpose} onChange={setLoanPurpose} placeholder="e.g. Shared cold store" />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Use of proceeds</span>
              <div className="space-y-2">
                {useOfFunds.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={row.item}
                      onChange={(e) => setUseOfFunds((rows) => rows.map((r, j) => (j === i ? { ...r, item: e.target.value } : r)))}
                      aria-label={`Use of proceeds line ${i + 1}, item`}
                      placeholder="Item"
                      className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.amount || ''}
                      onChange={(e) =>
                        setUseOfFunds((rows) => rows.map((r, j) => (j === i ? { ...r, amount: Number(e.target.value) || 0 } : r)))
                      }
                      aria-label={`Use of proceeds line ${i + 1}, amount in Guyanese dollars`}
                      placeholder="G$"
                      className="w-36 rounded-md border border-slate-200 px-3 py-2 text-right text-sm tabular-nums focus:border-brand focus:outline-none"
                    />
                    {useOfFunds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setUseOfFunds((rows) => rows.filter((_, j) => j !== i))}
                        aria-label={`Remove use of proceeds line ${i + 1}`}
                        className="px-2 text-slate-300 hover:text-rose-500"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setUseOfFunds((rows) => [...rows, { item: '', amount: 0 }])}
                  className="text-xs font-semibold text-brand underline"
                >
                  Add line
                </button>
                <span className="text-sm font-semibold text-slate-800 tabular-nums">
                  Total {formatGyd(useOfFunds.reduce((sum, r) => sum + (r.amount || 0), 0))}
                </span>
              </div>
            </div>
          </Section>
        )}

        {step === 'review' && (
          <div className="space-y-5">
            {!locked && <AttentionList issues={issues} blocking />}
            <ReviewSections sections={sections} onEdit={(id) => goTo(id as StepId)} readOnly={locked} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => navigate('/facilitator')} className={secondaryButton}>
                  Back to groups
                </button>
                {draftName && !locked && (
                  <button type="button" onClick={() => void discard()} disabled={busy} className={secondaryButton}>
                    Discard draft
                  </button>
                )}
              </div>
              {!locked && (
                <button
                  type="button"
                  disabled={busy || issues.length > 0 || !draftName}
                  onClick={() => void submit()}
                  className={primaryButton}
                >
                  {busy ? 'Submitting…' : 'Submit application'}
                </button>
              )}
            </div>
            {!locked && (
              <p className="text-right text-xs text-slate-400">
                Filed in the head&rsquo;s name. Members sign the Letter of Offer.
              </p>
            )}
          </div>
        )}
      </Card>

      {!isLast && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => goTo(STEPS[Math.max(index - 1, 0)].id)}
            disabled={index === 0}
            className={secondaryButton}
          >
            Back
          </button>
          <button type="button" onClick={() => void goNext()} disabled={busy} className={primaryButton}>
            {busy ? 'Saving…' : step === 'funding' ? 'Save and continue' : 'Continue'}
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
