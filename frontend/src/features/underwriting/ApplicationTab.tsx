import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import type { LoanApplication } from '../../types';
import { formatGyd } from '../../utils';

/** The staff Application tab: what the applicant wrote, as cards. Every value
 *  is the applicant's own declaration from `sections` — nothing is derived or
 *  added up here (totals are Frappe's). */

type Sections = Record<string, string | number | null>;

function CardHead({ title, tag }: { title: string; tag?: 'Declared' | 'Forecast' }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {tag && <Badge tone={tag === 'Forecast' ? 'warning' : 'neutral'}>{tag}</Badge>}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}

/** A money field left empty is stored as 0, so 0 there means "not given". */
const text = (s: Sections, key: string) => {
  const v = s[key];
  return v === null || v === undefined || v === '' ? null : String(v);
};
const money = (s: Sections, key: string) => (Number(s[key]) ? formatGyd(Number(s[key])) : null);

function Fields({ rows }: { rows: [string, string | null, boolean?][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return <p className="text-sm text-slate-400">Not provided.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {shown.map(([label, v, wide]) => (
        <Field key={label} label={label} wide={wide}>
          {v}
        </Field>
      ))}
    </dl>
  );
}

function Figures({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return <p className="text-sm text-slate-400">Not provided.</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
      {shown.map(([label, v]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ApplicationTab({ loan }: { loan: LoanApplication }) {
  const s: Sections = loan.sections ?? {};
  const sector = [text(s, 'sector'), text(s, 'sub_sector')].filter(Boolean).join(' · ') || null;
  const funds = loan.use_of_funds ?? [];

  const plan: [string, string | null, boolean?][] = [
    ['Executive summary', text(s, 'executive_summary'), true],
    ['Unique selling proposition', text(s, 'unique_selling_point'), true],
    ['Employment / development impact', text(s, 'employment_impact'), true],
    ['Vision', text(s, 'vision')],
    ['Mission', text(s, 'mission')],
    ['Goals', text(s, 'goals'), true],
    ['Customer segments', text(s, 'customer_segments')],
    ['Target market', text(s, 'target_market')],
    ['Competitors', text(s, 'competitors'), true],
    ['Production / service process', text(s, 'production_process'), true],
    ['Equipment and assets', text(s, 'equipment_required')],
    ['Suppliers', text(s, 'suppliers')],
    ['Permits', text(s, 'permits_required'), true],
  ];

  return (
    <>
      <Card>
        <CardHead title="Business" tag="Declared" />
        <Fields
          rows={[
            ['Legal structure', text(s, 'legal_structure')],
            ['Sector', sector],
            ['Employees', text(s, 'staff_count')],
            ['Jobs to be created', text(s, 'jobs_created')],
            ['Location', text(s, 'operating_location')],
            ['What it does', text(s, 'products_services')],
            ['Co-applicant e-IDs', text(s, 'co_applicants'), true],
          ]}
        />
      </Card>

      {loan.business_stage === 'New' ? (
        <Card>
          <CardHead title="Projections" tag="Forecast" />
          <Figures
            rows={[
              ['Projected revenue', money(s, 'projected_revenue')],
              ['Projected costs', money(s, 'projected_costs')],
              ['Start-up costs', money(s, 'initial_costs')],
              ['Monthly cash', money(s, 'expected_cash_position')],
              ['Sales volume', text(s, 'expected_sales_volume')],
            ]}
          />
          {text(s, 'assumptions') && (
            <dl className="mt-3">
              <Field label="Assumptions">{text(s, 'assumptions')}</Field>
            </dl>
          )}
        </Card>
      ) : (
        <Card>
          <CardHead title="Financials" tag="Declared" />
          <Figures
            rows={[
              ['Annual revenue', money(s, 'annual_revenue')],
              ['Cost of sales', money(s, 'cost_of_sales')],
              ['Operating expenses', money(s, 'operating_expenses')],
              ['Loan obligations', money(s, 'existing_obligations')],
              ['Cash position', money(s, 'cash_position')],
            ]}
          />
        </Card>
      )}

      <Card>
        <CardHead title="Use of funds" tag="Declared" />
        {funds.length > 0 ? (
          <DataTable
            caption="What the applicant declared this loan will be spent on"
            columns={[
              { key: 'item', header: 'Item', className: 'text-slate-700', cell: (r) => r.item },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                className: 'font-medium text-slate-900',
                cell: (r) => formatGyd(r.amount),
              },
            ]}
            rows={funds}
            rowKey={(_, i) => String(i)}
            dense
            footnote={false}
            total={{
              item: 'Total',
              // Frappe's SUM of the lines. Never added up here.
              amount: loan.use_of_funds_total != null ? formatGyd(loan.use_of_funds_total) : '—',
            }}
          />
        ) : text(s, 'use_of_funds') ? (
          <p className="whitespace-pre-wrap text-sm text-slate-800">{text(s, 'use_of_funds')}</p>
        ) : (
          <p className="text-sm text-slate-400">Not provided.</p>
        )}
      </Card>

      {plan.some(([, v]) => v) && (
        <Card>
          <CardHead title="Business plan" tag="Declared" />
          <Fields rows={plan} />
        </Card>
      )}
    </>
  );
}
