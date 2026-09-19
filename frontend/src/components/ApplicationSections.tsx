import { Card, CardLabel } from './ui/Card';
import { Badge } from './ui/Badge';
import { formatGyd } from '../utils';

/** Sections B–H of the application — the business narrative an underwriter
 *  actually decides a development loan on.
 *
 *  `_portal_dict` has sent `sections` back on every case since the 33 fields
 *  were added; nothing before this component ever read it. That gap, not the
 *  data, was the bug — an underwriter deciding a case without ever seeing
 *  what the applicant wrote. This renders exactly the shape the wizard wrote,
 *  grouped the same way the wizard itself groups them (see Apply.tsx STEPS,
 *  install.APPLICATION_SECTIONS), so a case here reads as the same document
 *  the applicant filled in — not a re-interpretation of it.
 *
 *  Labelling matters more than layout: G is declared by the applicant and
 *  ranked below whatever evidence is on the shelf; H is a forecast and is
 *  never allowed to read like a filed result.
 */

type FieldType = 'currency' | 'int' | 'text';

interface FieldSpec {
  key: string;
  label: string;
  type?: FieldType;
}

interface SectionSpec {
  letter: string;
  title: string;
  source: 'Declared' | 'Forecast';
  note?: string;
  fields: FieldSpec[];
  /** Only rendered when the case's business stage matches — an existing
   *  trading business and a start-up never both carry a section. */
  onlyFor?: 'Existing' | 'New';
}

const SECTIONS: SectionSpec[] = [
  {
    letter: 'B',
    title: 'Legal structure & business identity',
    source: 'Declared',
    fields: [
      { key: 'legal_structure', label: 'Legal structure' },
      { key: 'co_applicants', label: 'Co-applicant e-IDs' },
      { key: 'sector', label: 'Sector' },
      { key: 'sub_sector', label: 'Sub-sector' },
    ],
  },
  {
    letter: 'C',
    title: 'What the business does',
    source: 'Declared',
    fields: [
      { key: 'products_services', label: 'Products / services' },
      { key: 'use_of_funds', label: 'Expected use of funds' },
      { key: 'challenges', label: 'Current challenges' },
      { key: 'employment_impact', label: 'Employment / development impact' },
    ],
  },
  {
    letter: 'D',
    title: 'Market and customers',
    source: 'Declared',
    fields: [
      { key: 'customer_segments', label: 'Customer segments' },
      { key: 'target_market', label: 'Target market' },
      { key: 'customer_need', label: 'Customer need / problem' },
      { key: 'competitors', label: 'Competitors / alternatives' },
      { key: 'pricing_approach', label: 'Pricing approach' },
    ],
  },
  {
    letter: 'E',
    title: 'Operations',
    source: 'Declared',
    fields: [
      { key: 'operating_location', label: 'Operating location' },
      { key: 'production_process', label: 'Production / service process' },
      { key: 'equipment_required', label: 'Equipment and assets' },
      { key: 'suppliers', label: 'Suppliers' },
      { key: 'permits_required', label: 'Permits / operating requirements' },
    ],
  },
  {
    letter: 'F',
    title: 'Team and capability',
    source: 'Declared',
    fields: [
      { key: 'key_people', label: 'Owners and key people' },
      { key: 'relevant_experience', label: 'Relevant experience' },
      { key: 'staff_count', label: 'Number of staff', type: 'int' },
      { key: 'skills_gaps', label: 'Skills gaps' },
    ],
  },
  {
    letter: 'G',
    title: 'Existing-business financials',
    source: 'Declared',
    onlyFor: 'Existing',
    note: 'Declared by the applicant. Evidence on the shelf — bank statements, filed accounts — outranks these figures wherever the two disagree.',
    fields: [
      { key: 'annual_revenue', label: 'Annual revenue', type: 'currency' },
      { key: 'cost_of_sales', label: 'Cost of sales', type: 'currency' },
      { key: 'operating_expenses', label: 'Operating expenses', type: 'currency' },
      { key: 'existing_obligations', label: 'Existing loan obligations', type: 'currency' },
      { key: 'cash_position', label: 'Current cash position', type: 'currency' },
    ],
  },
  {
    letter: 'H',
    title: 'New-venture projections',
    source: 'Forecast',
    onlyFor: 'New',
    note: 'Projections, not historical filed results — read them as the applicant’s plan, not as an account of what has already happened.',
    fields: [
      { key: 'expected_sales_volume', label: 'Expected sales volume' },
      { key: 'projected_revenue', label: 'Projected annual revenue', type: 'currency' },
      { key: 'projected_costs', label: 'Projected annual costs', type: 'currency' },
      { key: 'initial_costs', label: 'Initial start-up costs', type: 'currency' },
      { key: 'expected_cash_position', label: 'Expected monthly cash position', type: 'currency' },
      { key: 'assumptions', label: 'Assumptions behind projections' },
    ],
  },
];

function formatValue(value: string | number | null | undefined, type?: FieldType): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'currency') return formatGyd(Number(value));
  if (type === 'int') return String(value);
  return String(value);
}

function isBlank(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

const SOURCE_TONE: Record<SectionSpec['source'], 'neutral' | 'warning'> = {
  Declared: 'neutral',
  Forecast: 'warning',
};

export function ApplicationSections({
  sections,
  businessStage,
}: {
  sections: Record<string, string | number | null>;
  businessStage: string | null;
}) {
  const visible = SECTIONS.filter((s) => !s.onlyFor || s.onlyFor === businessStage);
  const hasAny = visible.some((s) => s.fields.some((f) => !isBlank(sections[f.key])));

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <CardLabel>Sections B–H</CardLabel>
          <h2 className="mt-0.5 font-semibold text-slate-800">Business narrative</h2>
        </div>
        <span className="text-xs text-slate-500">As the applicant wrote it — not verified unless noted</span>
      </div>

      {!hasAny && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">
          The applicant has not filled in the business narrative yet.
        </p>
      )}

      {hasAny && (
        <div className="space-y-6">
          {visible.map((section) => {
            const filled = section.fields.filter((f) => !isBlank(sections[f.key]));
            return (
              <section key={section.letter} className="border-t border-slate-100 pt-4 first:border-0 first:pt-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                    {section.letter}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
                  <Badge tone={SOURCE_TONE[section.source]}>{section.source}</Badge>
                </div>
                {section.note && <p className="mb-2 text-xs text-slate-500">{section.note}</p>}

                {filled.length === 0 ? (
                  <p className="text-sm text-slate-400">Not provided.</p>
                ) : (
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {section.fields.map((f) => {
                      const raw = sections[f.key];
                      if (isBlank(raw)) return null;
                      return (
                        <div key={f.key}>
                          <dt className="text-xs text-slate-500">{f.label}</dt>
                          <dd className="whitespace-pre-wrap text-sm font-medium text-slate-800">
                            {formatValue(raw, f.type)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
