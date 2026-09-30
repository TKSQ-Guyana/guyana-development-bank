import { useEffect, useState } from 'react';
import { call } from '../api';
import { DocumentShelf } from './DocumentShelf';
import { Badge } from './ui/Badge';
import { Card, CardLabel } from './ui/Card';
import { DataTable } from './ui/DataTable';
import type { Cluster, ClusterMember, MemberProfileSummary } from '../types';
import { formatDate, formatGyd } from '../utils';

/** The people behind a cluster application, for GDB staff.
 *
 *  The head applies on the group's behalf, so without this an underwriter is
 *  deciding a facility for a group whose other members are a list of names.
 *  Each member fills in their own details and attaches their own documents —
 *  nobody fills in anybody else's — and this is where those reach the person
 *  deciding the case.
 *
 *  Members do not get this view of each other: the plan is shared, the people
 *  are not each other's business. The server draws that line (api.cluster_view
 *  returns `profile` only to staff); this component is only ever rendered for
 *  staff in the first place.
 *
 *  WHY IT IS A TABLE. What a member declares is six amounts, and six amounts
 *  run together in a sentence — "Income G$10 · Other income G$100 · Expenses
 *  G$100 · …" — is not something an underwriter can read, let alone compare
 *  across a roster. Wrapped in the narrow tab column this panel actually
 *  lives in, the same figure sat at a different horizontal position on every
 *  member, so reading down a column was impossible. They are money, so they
 *  go in a money column: one line each, right-aligned, tabular, with the
 *  member's declaration beside the group's other members in the same shape.
 */

/** The figures a member declares, in the order an underwriter reads them:
 *  what comes in, what goes out, then what is already owed and held. */
const FIGURES: { key: keyof MemberProfileSummary; label: string }[] = [
  { key: 'monthly_income', label: 'Monthly income' },
  { key: 'other_monthly_income', label: 'Other monthly income' },
  { key: 'monthly_expenses', label: 'Monthly expenses' },
  { key: 'monthly_loan_repayments', label: 'Monthly loan repayments' },
  { key: 'total_debts', label: 'Total debts' },
  { key: 'savings', label: 'Savings' },
];

interface FigureRow {
  label: string;
  amount: number;
}

/** What the member declared on their personal financials step.
 *
 *  Nothing here is netted, summed or scored. The portal displays what a person
 *  declared; working out whether it adds up to capacity is the underwriter's
 *  judgement and — per the specification — an assessment record, never a
 *  number this screen invents beside the ones it was given.
 */
function DeclaredFinancials({ profile }: { profile: MemberProfileSummary | null }) {
  if (!profile?.financials_updated_on) {
    return (
      <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-800">
        Personal financials not declared yet — this member's own figures are not on file.
      </p>
    );
  }

  const rows: FigureRow[] = FIGURES.map((f) => ({
    label: f.label,
    amount: Number(profile[f.key] ?? 0),
  }));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <CardLabel>Declared financials</CardLabel>
        <span className="text-xs text-slate-500">
          {profile.employment_status ?? 'Employment not stated'} · {profile.dependents ?? 0}{' '}
          {profile.dependents === 1 ? 'dependent' : 'dependents'} · declared{' '}
          {formatDate(profile.financials_updated_on)}
        </span>
      </div>
      <DataTable
        caption="Monthly figures this cluster member declared"
        columns={[
          { key: 'label', header: 'Figure', cell: (r) => r.label },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            className: 'font-medium text-slate-900',
            cell: (r) => formatGyd(r.amount),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.label}
        dense
        footnote={false}
      />
    </div>
  );
}

/** Who the member is: the facts that are not money, as labelled pairs rather
 *  than a middot-separated run-on. A blank stays visible as an em-dash — an
 *  underwriter needs to see that a member has no phone number on file, which
 *  a line that simply omits it cannot show. */
function MemberFacts({ member }: { member: ClusterMember }) {
  const p = member.profile;
  const facts: [string, string | null][] = [
    ['Occupation', p?.occupation ?? null],
    ['Region', p?.region ?? null],
    ['Village or town', p?.village_or_town ?? null],
    ['Phone', p?.phone || p?.verified_phone || null],
    ['Joined', member.joined_on ? formatDate(member.joined_on) : null],
    ['Invited', member.invited_on ? formatDate(member.invited_on) : null],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="text-right font-medium text-slate-800">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS_TONE = {
  Active: 'success',
  Invited: 'warning',
  Declined: 'danger',
  Exited: 'neutral',
} as const;

export function ClusterMembers({ cluster, application }: { cluster: string; application: string }) {
  const [data, setData] = useState<Cluster | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    call<Cluster>('gdb_bank.api.cluster_view', { cluster })
      .then(setData)
      .catch(() => setData(null));
  }, [cluster]);

  if (!data) return null;

  const members = data.members ?? [];
  const active = members.filter((m) => m.member_status === 'Active').length;
  const waiting = members.filter((m) => m.member_status === 'Invited').length;
  // An underwriter needs this stated, not inferred from reading every card:
  // an unanswered invitation looks like a member and behaves like nobody.
  const undeclared = members.filter(
    (m) => m.member_status === 'Active' && !m.profile?.financials_updated_on,
  ).length;

  return (
    <Card className="mt-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <CardLabel>Cluster</CardLabel>
          <h2 className="mt-0.5 font-semibold text-slate-800">{data.name}</h2>
        </div>
        <span className="text-xs text-slate-500">
          {[data.region, data.sector].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Badge tone="success">{active} active</Badge>
        {waiting > 0 && <Badge tone="warning">{waiting} invitation not answered</Badge>}
        {undeclared > 0 && <Badge tone="warning">{undeclared} without declared financials</Badge>}
      </div>

      <div className="space-y-4">
        {members.map((m) => (
          <section
            key={m.member ?? m.member_eid ?? m.member_name}
            className="rounded-lg border border-slate-200 bg-slate-50/40 p-4"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{m.member_name}</h3>
                  {m.is_head && <Badge tone="brand">Head</Badge>}
                  <Badge tone={STATUS_TONE[m.member_status]}>{m.member_status}</Badge>
                </div>
                {/* Staff identify an applicant by e-ID, never by mailbox. When
                    there is none, say so as an absence rather than as a value
                    sitting where an e-ID goes. */}
                <p className="mt-0.5 font-mono text-xs text-slate-500">
                  {m.member_eid ?? <span className="font-sans italic text-slate-400">no e-ID on file</span>}
                </p>
              </div>
              {m.member && (
                <button
                  type="button"
                  onClick={() => setOpen(open === m.member ? null : m.member)}
                  className="flex-none rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {open === m.member ? 'Hide documents' : 'Documents'}
                </button>
              )}
            </div>

            <div className="space-y-4">
              <MemberFacts member={m} />
              {m.member_status === 'Active' && <DeclaredFinancials profile={m.profile} />}
            </div>

            {m.member && open === m.member && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <DocumentShelf
                  application={application}
                  applicant={m.member}
                  title={`${m.member_name} — documents`}
                />
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
