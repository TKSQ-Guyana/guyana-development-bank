import { MoneyField, Section, SelectField, TextField } from '../../components/apply/fields';
import type { DeclaredFinancials } from '../../types';

/** One person's own finances — asked of every individual on a group's case.
 *  Presentation only: the server validates and stores them on the person's
 *  profile, so they follow the person rather than one application. */

/** The form holds every value as typed text; the server converts. */
export type PersonalFinancials = Record<Exclude<keyof DeclaredFinancials, 'financials_updated_on'>, string>;

export const EMPTY_FINANCIALS: PersonalFinancials = {
  employment_status: '',
  monthly_income: '',
  other_monthly_income: '',
  monthly_expenses: '',
  monthly_loan_repayments: '',
  total_debts: '',
  savings: '',
  dependents: '',
};

/** Saved figures back into form text. A 0 the person never typed stays blank. */
export function toForm(saved: DeclaredFinancials): PersonalFinancials {
  const text = (v: string | number | null) => (v === null || v === 0 ? '' : String(v));
  return {
    employment_status: saved.employment_status ?? '',
    monthly_income: text(saved.monthly_income),
    other_monthly_income: text(saved.other_monthly_income),
    monthly_expenses: text(saved.monthly_expenses),
    monthly_loan_repayments: text(saved.monthly_loan_repayments),
    total_debts: text(saved.total_debts),
    savings: text(saved.savings),
    dependents: text(saved.dependents),
  };
}

const EMPLOYMENT = ['Employed', 'Self-employed', 'Unemployed', 'Retired'];

export function PersonalFinancialsForm({
  value,
  onChange,
}: {
  value: PersonalFinancials;
  onChange: (next: PersonalFinancials) => void;
}) {
  const set = (key: keyof PersonalFinancials) => (v: string) => onChange({ ...value, [key]: v });

  return (
    <div className="space-y-6">
      <Section letter="1" title="Income and expenses" blurb="Per month, in Guyana dollars.">
        <SelectField
          label="Employment status"
          value={value.employment_status}
          onChange={set('employment_status')}
          options={EMPLOYMENT}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Monthly income" value={value.monthly_income} onChange={set('monthly_income')} required />
          <MoneyField
            label="Other monthly income"
            value={value.other_monthly_income}
            onChange={set('other_monthly_income')}
          />
          <MoneyField
            label="Monthly household expenses"
            value={value.monthly_expenses}
            onChange={set('monthly_expenses')}
            required
          />
          <MoneyField
            label="Monthly loan repayments"
            value={value.monthly_loan_repayments}
            onChange={set('monthly_loan_repayments')}
          />
        </div>
      </Section>

      <Section letter="2" title="What you owe and own">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Total debts outstanding" value={value.total_debts} onChange={set('total_debts')} />
          <MoneyField label="Savings" value={value.savings} onChange={set('savings')} />
          <TextField
            label="Dependents"
            value={value.dependents}
            onChange={(v) => set('dependents')(v.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </div>
      </Section>
    </div>
  );
}
