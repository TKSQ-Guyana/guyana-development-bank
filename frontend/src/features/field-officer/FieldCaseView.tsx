import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { StageBadge } from '../../components/ui/Stepper';
import type { LoanApplication } from '../../types';
import { formatDate, formatGyd } from '../../utils';
import { ApplicationTab } from '../underwriting/ApplicationTab';
import { fo } from './api';
import { FieldReports } from './FieldReports';
import type { FieldTask, HistoryEvent } from './types';
import { ErrorLine, RailTitle, Row, Timeline } from './ui';

/** FO.S11 — the case, read-only, with its history. Open to a Field Officer
 *  only while they hold an assignment on it (field_operations.holds_assignment). */
export function FieldCaseView() {
  const { name = '' } = useParams<{ name: string }>();
  const [data, setData] = useState<{ case: LoanApplication; history: HistoryEvent[]; tasks: FieldTask[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fo.caseView(name).then(setData).catch((err: Error) => setError(err.message));
  }, [name]);

  if (error) return <ErrorLine>{error}</ErrorLine>;
  if (!data) return <p className="text-slate-500">Loading…</p>;
  const loan = data.case;

  return (
    <div>
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Field desk
      </Link>

      <div className="mb-5 mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">{loan.applicant_name}</h1>
          <StageBadge stage={loan.stage} />
          <Badge tone="neutral">Read only</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {[loan.business_name, loan.name].filter(Boolean).join(' · ')}
          <span className="ml-2 font-mono text-xs">{loan.applicant_eid ?? ''}</span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-24">
          <Card>
            <RailTitle>Loan facts</RailTitle>
            <Row label="Requested" value={`${formatGyd(loan.loan_amount)} · ${loan.term_months} months`} />
            <Row label="Status" value={loan.status === 'Draft' && loan.handed_off_on ? 'Waiting for applicant' : loan.status} />
            {loan.assisted_by_name && <Row label="Assisted by" value={loan.assisted_by_name} />}
            {loan.submitted_by_name && <Row label="Submitted by" value={loan.submitted_by_name} />}
            <Row label="Started" value={formatDate(loan.creation)} />
          </Card>
          <Card>
            <RailTitle>History</RailTitle>
            <Timeline
              empty="Nothing yet."
              items={data.history.map((e, i) => ({
                key: String(i),
                title: e.what,
                meta: [formatDate(e.on), e.who].filter(Boolean).join(' · '),
              }))}
            />
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          {loan.product === 'standard' && <ApplicationTab loan={loan} />}
          <FieldReports tasks={data.tasks} />
        </div>
      </div>
    </div>
  );
}
