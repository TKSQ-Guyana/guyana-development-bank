import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { call } from '../api';
import { Banner, Footer, PageIntro, Panel, Pill, QButton, RadioCard } from '../components/portal/ui';
import { gyd, type QuickLoanTerms } from '../features/quick-loan/model/quickLoan';

/** "Choose your loan" — the first screen of every application, as in the
 *  applicant prototype. The SME Direct Loan goes on to its own form
 *  (/apply/new/sme), the Quick Loan to /apply/quick. Nothing is saved here.
 *
 *  The Quick Loan's figures are the server's (quick_loan_terms). The SME loan
 *  states no ceiling: its Loan Product holds none (maximum_loan_amount 0). */
export function ChooseLoan() {
  const navigate = useNavigate();
  const [pick, setPick] = useState<'sme' | 'quick' | null>(null);
  const [terms, setTerms] = useState<QuickLoanTerms | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<QuickLoanTerms>('gdb_bank.api.quick_loan_terms')
      .then(setTerms)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Panel narrow>
      <PageIntro title="Choose your loan">Pick the loan that fits your business. GDB decides the approved amount.</PageIntro>
      {error && <Banner kind="error" title={error} />}
      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Loan type">
        <RadioCard
          title="SME Direct Loan"
          badge={<Pill tone="green">Open</Pill>}
          meta="0% interest · No collateral"
          body="For a registered business or a new venture, with a full business plan."
          selected={pick === 'sme'}
          onSelect={() => setPick('sme')}
        />
        <RadioCard
          title="Quick Loan"
          badge={<Pill tone="green">Open</Pill>}
          meta={
            terms
              ? `Up to ${gyd(terms.ceiling)} · ${terms.rate_of_interest}% interest · No collateral`
              : 'No collateral'
          }
          body="For market vendors, small services and other small businesses. No business registration needed."
          selected={pick === 'quick'}
          onSelect={() => setPick('quick')}
        />
      </div>
      <Footer>
        <QButton kind="secondary" onClick={() => navigate('/')}>
          Back to dashboard
        </QButton>
        <QButton disabled={!pick} onClick={() => navigate(pick === 'quick' ? '/apply/quick' : '/apply/new/sme')}>
          Continue
        </QButton>
      </Footer>
    </Panel>
  );
}
