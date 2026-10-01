import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../../api';
import { useAuth } from '../../auth';
import { DocumentShelf, docLabel } from '../../components/DocumentShelf';
import { REGIONS } from '../../components/apply/cluster';
import { PayoutAccount } from '../../components/apply/PayoutAccount';
import { CheckIcon } from '../../components/ui/icons';
import { FieldOfficerRequest } from './FieldOfficerRequest';
import type { CitizenProfile, LoanApplication } from '../../types';
import {
  blockerFor,
  confirmErrors,
  EMPTY_ANSWERS,
  fromDraft,
  gyd,
  QUICK_STEPS,
  RAIL_STEPS,
  termOptions,
  toSavePayload,
  type QuickAnswers,
  type QuickLoanTerms,
  type QuickStepId,
} from './model/quickLoan';
import {
  Banner,
  Card,
  Check,
  Chips,
  Footer,
  Hero,
  inputClass,
  LinkButton,
  PageIntro,
  Panel,
  Pill,
  QButton,
  QField,
  QReadOnly,
  QSelect,
  QTextArea,
  RadioCard,
  SecHead,
  SectionTitle,
  Spinner,
  StepRail,
  Tabs,
  type StepState,
} from '../../components/portal/ui';

/** The Quick Loan application — an informal trader's own short form.
 *
 *  Deliberately NOT a branch of the SME wizard: no TIN, no DCRA, no accounts, no
 *  business plan. Identity, what they do and where, a photo of the trade, how
 *  much and what for, and where to pay them. The rules live in
 *  model/quickLoan.ts; the enforcement lives on the server. The screens follow
 *  the approved prototype (gdb-quick-loan-flow), drawn from ./ui.
 *
 *  Nothing is kept on the device. Until the loan step there is nothing the
 *  server will hold as a draft, and after it every step is saved to GDB — the
 *  applicant's answers never sit in browser storage.
 */

/** Where each document type is filed, for the Documents tab. */
const DOC_SLOTS: [type: string, title: string, help: string][] = [
  ['Trading Photo', 'Proof of business', 'Photos that show the business is running. Added in Proof of business.'],
  ['Receipts or Records', 'Receipts or invoices', 'Optional. Added in Proof of business.'],
  ['Identity', 'Identity document', 'Identity evidence, where requested. Added in Proof of business.'],
];

const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const stamp = (d: Date) =>
  `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${clock(d)}`;
const regionShort = (r: string) => r.split(' — ')[0];

export function QuickApplyPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { name: routeName } = useParams<{ name: string }>();

  const [terms, setTerms] = useState<QuickLoanTerms | null>(null);
  const [answers, setAnswers] = useState<QuickAnswers>(EMPTY_ANSWERS);
  const [branchCode, setBranchCode] = useState('');
  const [step, setStep] = useState<QuickStepId>('eligibility');
  const [tab, setTab] = useState<'app' | 'docs'>('app');
  const [draft, setDraft] = useState<LoanApplication | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<LoanApplication | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState<string | null>(null);
  // "I need help from a field officer" — the request form instead of the steps.
  const [helping, setHelping] = useState(false);
  // The separate submit page, reached from Review.
  const [confirming, setConfirming] = useState(false);
  const [confirmTried, setConfirmTried] = useState(false);
  // The draft this page already holds — so the URL moving from /apply/quick to
  // /apply/quick/<name> on the first save is not read as "open another draft".
  const loaded = useRef<string | null>(null);

  const set =
    <K extends keyof QuickAnswers>(key: K) =>
    (value: QuickAnswers[K]) => {
      // An answer being changed is the applicant acting on the message.
      setError(null);
      setAnswers((a) => ({ ...a, [key]: value }));
    };

  useEffect(() => {
    call<QuickLoanTerms>('gdb_bank.api.quick_loan_terms')
      .then(setTerms)
      .catch((err: Error) => setError(err.message));
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((p) => {
        setProfile(p);
        setConsented(Boolean(p?.consent_version));
        setAnswers((a) => ({
          ...a,
          phone: a.phone || p.phone || p.verified_phone || '',
          dob: a.dob || p.date_of_birth || p.verified_birth_date || '',
          nationalId: a.nationalId || p.national_id || '',
          holder: a.holder || user?.full_name || '',
        }));
      })
      .catch(() => setConsented(false));
  }, []);

  useEffect(() => {
    if (!routeName || loaded.current === routeName) return;
    loaded.current = routeName;
    setBusy(true);
    call<LoanApplication>('gdb_bank.api.loan_detail', { name: routeName })
      .then((loan) => {
        if (loan.status !== 'Draft') {
          navigate(`/loans/${loan.name}`, { replace: true });
          return;
        }
        if (loan.product !== 'quick') {
          navigate(`/apply/${loan.name}`, { replace: true });
          return;
        }
        setDraft(loan);
        setAnswers((a) => ({ ...a, ...fromDraft(loan) }));
        setStep('proof');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }, [routeName, navigate]);

  // What is still not on file — Review and the Documents tab report it. The
  // Proof step's own shelf reports it too (onChange below).
  useEffect(() => {
    if (!draft?.name || (step !== 'review' && tab !== 'docs')) return;
    call<{ missing: string[] }>('gdb_bank.documents.list_documents', { application: draft.name })
      .then((shelf) => setMissing(shelf.missing))
      .catch((err: Error) => setError(err.message));
  }, [draft?.name, step, tab]);

  const index = QUICK_STEPS.findIndex((s) => s.id === step);
  const current = QUICK_STEPS[index];
  // How far the applicant has got. Going back to change an answer must not
  // cost the way forward again, so the rail stays open up to here.
  const [furthest, setFurthest] = useState(0);
  useEffect(() => {
    setFurthest((f) => Math.max(f, index));
  }, [index]);

  const saveDraft = async (): Promise<LoanApplication> => {
    const saved = await call<LoanApplication>(
      'gdb_bank.api.save_application',
      toSavePayload(answers, draft?.name),
    );
    setDraft(saved);
    setSavedAt(new Date());
    loaded.current = saved.name;
    if (routeName !== saved.name) navigate(`/apply/quick/${saved.name}`, { replace: true });
    return saved;
  };

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goTo = (id: QuickStepId) => {
    setError(null);
    setConfirming(false);
    setTab('app');
    setStep(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Leave the step on screen: its check, then whatever it saves. True when
   *  the step may be left. Shared by Continue and by the rail. */
  const leave = async (): Promise<boolean> => {
    if (!terms) return false;
    const blocker = blockerFor(step, answers, terms);
    if (blocker) {
      setError(blocker);
      return false;
    }
    if (step === 'eligibility' && answers.how === 'help') {
      setError(null);
      setHelping(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }
    if (step === 'eligibility' && !consented) {
      if (!consentChecked) {
        setError('Agree to let GDB look up your bank accounts to continue.');
        return false;
      }
      if (!(await run(() => call('gdb_bank.profiles.record_consent')))) return false;
      setConsented(true);
    }
    // Date of birth and national ID are the person's, so they go on the profile.
    if (
      step === 'about' &&
      !(await run(() =>
        call('gdb_bank.profiles.save_profile', { date_of_birth: answers.dob, national_id: answers.nationalId }),
      ))
    )
      return false;
    // The loan step is the first the server will hold as a draft; from here
    // on, moving forward saves to GDB.
    if (step === 'loan' && !(await run(saveDraft))) return false;
    if (step === 'bank') {
      const saved = await run(async () => {
        await call('gdb_bank.api.save_bank_details', {
          bank: answers.bank,
          bank_account_no: answers.accountNo,
          branch_code: branchCode,
          account_name: answers.holder,
        });
        await saveDraft();
      });
      if (!saved) return false;
    }
    return true;
  };

  const goNext = async () => {
    if (await leave()) goTo(QUICK_STEPS[Math.min(index + 1, QUICK_STEPS.length - 1)].id);
  };

  /** Rail navigation. Back is free. Forward goes as far as the applicant has
   *  already been, and stops at the first step in between that is no longer
   *  complete. */
  const jumpTo = async (i: number) => {
    if (i === index || i > furthest || busy || !terms) return;
    if (i < index) {
      goTo(QUICK_STEPS[i].id);
      return;
    }
    if (!(await leave())) return;
    const stuck = QUICK_STEPS.slice(index + 1, i).find((s) => blockerFor(s.id, answers, terms));
    goTo((stuck ?? QUICK_STEPS[i]).id);
    if (stuck) setError(blockerFor(stuck.id, answers, terms));
  };

  const submit = async () => {
    setConfirmTried(true);
    if (Object.keys(confirmErrors(answers)).length) return;
    setSubmitting(true);
    setSubmitFailed(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const saved = await saveDraft();
      setSubmitted(
        await call<LoanApplication>('gdb_bank.api.submit_application', {
          name: saved.name,
          accept_terms: 1,
          credit_check_consent: 1,
        }),
      );
      setSubmittedAt(new Date());
    } catch (err) {
      setSubmitFailed(err instanceof Error ? err.message : 'The submission did not go through.');
    } finally {
      setSubmitting(false);
    }
  };

  const screen = (): ReactNode => {
    if (!terms) {
      return error ? <Banner kind="error" title={error} /> : <p className="text-ql-muted">Loading…</p>;
    }
    const amount = gyd(Number(answers.amount));
    const months = `${answers.term} month${answers.term === '1' ? '' : 's'}`;

    if (submitted) {
      return (
        <Panel narrow>
          <Hero title="Your application has been submitted">
            Your application is now read-only. GDB will review it and contact you if more information is needed.
          </Hero>
          <Card>
            <b className="font-semibold">Submission record</b>
            <div className="mt-1 text-[13px] text-ql-ink2">
              Quick Loan · {amount} · {months}
              <br />
              Submitted {submittedAt ? stamp(submittedAt) : ''} · <b className="font-semibold">{submitted.name}</b>
              <br />
              Keep these application details when contacting GDB.
            </div>
          </Card>
          <Card tone="soft">
            <b className="font-semibold">What happens next</b>
            <div className="mt-1 text-[13px] text-ql-ink2">
              A member of the GDB team will review your application. If more information is required, you will receive
              a request explaining what to provide. Submission is not approval.
            </div>
          </Card>
          <div className="flex flex-wrap gap-3">
            <QButton kind="secondary" onClick={() => navigate(`/loans/${submitted.name}`)}>
              View submitted application
            </QButton>
            <QButton onClick={() => navigate('/apply')}>My applications</QButton>
          </div>
        </Panel>
      );
    }

    if (submitting) {
      return (
        <Panel narrow>
          <div className="flex items-center gap-4">
            <Spinner />
            <div>
              <h2 className="text-[23px] font-semibold leading-tight">Submitting your application</h2>
              <p className="text-ql-ink2">Sending your application to GDB</p>
            </div>
          </div>
          <p className="text-[13px] text-ql-ink2">
            Please wait for confirmation before trying again. No approval or lending decision has been made.
          </p>
          <Card tone="soft">
            <b className="font-semibold">Submission in progress</b>
            <div className="text-[13px] text-ql-ink2">
              Quick Loan · {amount}. Your saved information and attached documents are being submitted together.
            </div>
          </Card>
          <div>
            <QButton disabled>Submitting…</QButton>
          </div>
        </Panel>
      );
    }

    if (submitFailed) {
      return (
        <Panel narrow>
          <Hero kind="err" title="We could not submit your application">
            Your draft and documents are saved. Check your connection and try again.
          </Hero>
          <Card tone="soft">
            <b className="font-semibold">Your application is still a draft</b>
            <div className="text-[13px] text-ql-ink2">
              You can submit again. Trying again never creates a second application.
              <br />
              <span className="text-ql-muted">{submitFailed}</span>
            </div>
          </Card>
          <Footer>
            <QButton
              kind="secondary"
              onClick={() => {
                setSubmitFailed(null);
                setConfirming(false);
              }}
            >
              Back to review
            </QButton>
            <QButton onClick={() => void submit()}>Try again</QButton>
          </Footer>
        </Panel>
      );
    }

    if (helping) {
      return (
        <FieldOfficerRequest
          defaultName={user?.full_name ?? ''}
          defaultPhone={answers.phone}
          onBack={() => setHelping(false)}
          onApplySelf={() => {
            set('how')('self');
            setHelping(false);
          }}
        />
      );
    }

    if (confirming) {
      const errs = confirmTried ? confirmErrors(answers) : {};
      return (
        <Panel narrow>
          <PageIntro title="Confirm your submission">
            Quick Loan · {amount} · {months}
          </PageIntro>
          <Banner kind="warn" title="You will not be able to edit after submission">
            GDB can request specific corrections or additional information through a Request for Information.
            Submission is not a lending decision.
          </Banner>
          <div className="flex flex-col gap-3">
            <Check checked={answers.accurate} onChange={set('accurate')}>
              I confirm that the information I have provided is accurate.
            </Check>
            {errs.accurate && <div className="text-[12.5px] font-medium text-ql-red">{errs.accurate}</div>}
            <Check checked={answers.noGuarantee} onChange={set('noGuarantee')}>
              I understand that submitting this application does not guarantee a loan.
            </Check>
            {errs.noGuarantee && <div className="text-[12.5px] font-medium text-ql-red">{errs.noGuarantee}</div>}
          </div>
          <div className="flex flex-col gap-2">
            <SectionTitle>Credit check consent</SectionTitle>
            <p className="text-[13px] text-ql-ink2">
              GDB checks your credit history with EveryData, the credit bureau, before a person at GDB decides on your
              application.
            </p>
            <Check checked={answers.creditConsent} onChange={set('creditConsent')}>
              I consent to GDB obtaining my credit report from EveryData to assess this application.
            </Check>
            {errs.creditConsent && <div className="text-[12.5px] font-medium text-ql-red">{errs.creditConsent}</div>}
          </div>
          <Footer>
            <QButton
              kind="secondary"
              onClick={() => {
                setError(null);
                setConfirming(false);
              }}
            >
              Back to review
            </QButton>
            <QButton onClick={() => void submit()}>Submit application</QButton>
          </Footer>
        </Panel>
      );
    }

    if (step === 'eligibility') {
      return (
        <Panel narrow>
          <PageIntro title="Before you start" />
          {error && <Banner kind="error" title={error} />}
          <Card>
            <h3 className="text-[17px] font-semibold">For small businesses</h3>
            <div className="mt-3 overflow-hidden rounded-xl border border-ql-line">
              {[
                'Market vendors',
                'Small services, like repairs, hair or tailoring',
                'Home-based and mobile businesses',
                'Other small businesses',
              ].map((x, i) => (
                <div key={x} className={`flex items-center gap-3 px-4 py-3.5 text-[13px] ${i ? 'border-t border-ql-line' : ''}`}>
                  <CheckIcon className="h-4 w-4 flex-none" />
                  {x}
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="grid grid-cols-3 gap-4">
              {[
                ['Loan up to', gyd(terms.ceiling)],
                ['Interest', `${terms.rate_of_interest}%`],
                ['Collateral', 'None'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-ql-muted">{k}</div>
                  <b className="font-semibold">{v}</b>
                </div>
              ))}
            </div>
          </Card>
          <div className="flex flex-col gap-3">
            <h2 className="text-[19px] font-semibold">How would you like to apply?</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <RadioCard
                title="I will apply myself"
                body="Fill in the application in this portal. Your answers save as you go."
                selected={answers.how === 'self'}
                onSelect={() => set('how')('self')}
              />
              <RadioCard
                title="I need help from a field officer"
                body="A GDB field officer contacts you and completes the application with you."
                selected={answers.how === 'help'}
                onSelect={() => set('how')('help')}
              />
            </div>
          </div>
          {consented === false && answers.how === 'self' && (
            <Card tone="soft">
              <Check checked={consentChecked} onChange={setConsentChecked}>
                I agree to GDB receiving these records for my application.
              </Check>
            </Card>
          )}
          <Footer>
            <span />
            <QButton disabled={!answers.how || busy} onClick={() => void goNext()}>
              {busy ? 'Saving…' : answers.how === 'help' ? 'Continue to request help' : 'Start application'}
            </QButton>
          </Footer>
          <p className="text-xs text-ql-muted">Applying is free, and a person at GDB makes every decision.</p>
        </Panel>
      );
    }

    // ---------- The rail and its sections ----------

    const stateOf = (id: string): StepState => {
      const i = QUICK_STEPS.findIndex((s) => s.id === id);
      if (id === step) return 'cur';
      if (i > furthest || id === 'review') return '';
      return blockerFor(id as QuickStepId, answers, terms) ? 'attn' : 'done';
    };
    const issues = RAIL_STEPS.filter((s) => s.id !== 'review')
      .map((s) => ({ step: s, text: blockerFor(s.id, answers, terms) }))
      .filter((x): x is { step: (typeof RAIL_STEPS)[number]; text: string } => Boolean(x.text));
    const meta = `Quick Loan · ${draft ? 'Draft' : 'Not saved yet'}${savedAt ? ` · Saved · ${clock(savedAt)}` : ''}`;
    const overCap = Number(answers.amount) > terms.ceiling;

    const summary = (id: QuickStepId, title: string, body: ReactNode, pill?: ReactNode) => (
      <Card key={id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <b className="font-semibold">{title}</b>
            {pill ?? (blockerFor(id, answers, terms) ? <Pill tone="amber">1 item missing</Pill> : <Pill tone="green">Complete</Pill>)}
          </div>
          <LinkButton onClick={() => goTo(id)}>Edit</LinkButton>
        </div>
        <div className="mt-2 text-[13px] text-ql-ink2">{body}</div>
      </Card>
    );

    let body: ReactNode;
    if (tab === 'docs') {
      body = (
        <>
          <SecHead
            title="Your documents"
            intro="Everything you have uploaded, linked to the section it belongs to. Replace a file here or in its section."
          />
          {error && <Banner kind="error" title={error} />}
          {draft ? (
            DOC_SLOTS.map(([type, title, help]) => (
              <Card key={type}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <b className="font-semibold">{title}</b>
                    <div className="text-[13px] text-ql-muted">{help}</div>
                  </div>
                  <LinkButton onClick={() => goTo('proof')}>Open section</LinkButton>
                </div>
                <DocumentShelf application={draft.name} only={type} title={title} />
              </Card>
            ))
          ) : (
            <Banner kind="info" title="Documents open once your loan details are saved." />
          )}
          <div>
            <QButton kind="secondary" onClick={() => setTab('app')}>
              Back to application
            </QButton>
          </div>
        </>
      );
    } else if (step === 'review') {
      body = (
        <>
          <SecHead
            title="Review your application"
            meta={meta}
            intro={issues.length ? 'Review does not submit your application.' : 'Review all details before sending them to GDB.'}
          />
          {error && <Banner kind="error" title={error} />}
          {issues.length ? (
            <>
              <Banner kind="warn" title={`${issues.length} item${issues.length > 1 ? 's need' : ' needs'} your attention`}>
                Resolve the items below before submitting. You can return to any section.
              </Banner>
              <div className="overflow-hidden rounded-xl border border-ql-line">
                {issues.map(({ step: s, text }, i) => (
                  <div
                    key={s.id}
                    className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${i ? 'border-t border-ql-line' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <b className="text-[13px] font-semibold">{text}</b>
                      <div className="text-xs text-ql-muted">{s.title} · Required field missing</div>
                    </div>
                    <LinkButton onClick={() => goTo(s.id)}>Go to field</LinkButton>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Banner kind="success" title="No outstanding items">
              The required sections are complete.
            </Banner>
          )}
          {missing.length > 0 && (
            <Banner kind="info" title={`Not on file yet: ${missing.map(docLabel).join(', ')}`}>
              You can still submit. GDB may ask you for them.
            </Banner>
          )}
          <div className="flex flex-col gap-3">
            {summary(
              'about',
              'About you',
              <>
                {user?.full_name ?? '—'} · Date of birth: {answers.dob || '—'}
                <br />
                e-ID: {user?.eid ?? '—'} · National ID: {answers.nationalId ? `•••• ${answers.nationalId.slice(-4)}` : '—'}
                <br />
                {answers.phone || '—'}
              </>,
            )}
            {summary(
              'business',
              'Business description',
              <>
                {answers.businessName || 'No business name'} · {regionShort(answers.region) || '—'}
                <br />
                {answers.tradeActivity || '—'}
                <br />
                In business: {answers.tradingSince || '—'} · Location: {answers.tradeLocation || '—'}
              </>,
            )}
            {summary(
              'loan',
              'Loan details',
              <>
                Loan amount {answers.amount ? amount : '—'} · {months}
                <br />
                Purpose: {answers.purpose || '—'}
              </>,
            )}
            {summary(
              'proof',
              'Proof of business',
              <>
                Proof of business: {missing.includes('Trading Photo') ? 'not on file yet' : 'on file'}
                <br />
                Identity document: {missing.includes('Identity') ? 'not on file yet' : 'on file'}
              </>,
              missing.length ? <Pill tone="amber">Not on file yet</Pill> : <Pill tone="green">Complete</Pill>,
            )}
            {summary(
              'bank',
              'Bank information',
              <>
                {answers.bank || '—'}
                {branchCode ? ` · ${branchCode}` : ''}
                {answers.accountNo ? ` · •••• ${answers.accountNo.replace(/\s/g, '').slice(-4)}` : ''}
                {answers.holder && (
                  <>
                    <br />
                    Account holder: {answers.holder}
                  </>
                )}
              </>,
            )}
          </div>
          <Footer>
            <QButton kind="secondary" back onClick={() => goTo('bank')}>
              Back
            </QButton>
            <QButton
              disabled={issues.length > 0}
              onClick={() => {
                setError(null);
                setConfirmTried(false);
                setConfirming(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Continue to submit
            </QButton>
          </Footer>
        </>
      );
    } else {
      body = (
        <>
          <SecHead title={current.title} meta={meta} intro={current.blurb} />
          {error && <Banner kind="error" title={error} />}

          {step === 'about' && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <QReadOnly label="Full legal name" value={user?.full_name} source="e-ID" />
                <QField label="Date of birth" required>
                  <input type="date" value={answers.dob} onChange={(e) => set('dob')(e.target.value)} className={inputClass()} />
                </QField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <QReadOnly label="e-ID number" value={user?.eid} source="e-ID" />
                <QField label="National ID number" required>
                  <input
                    value={answers.nationalId}
                    onChange={(e) => set('nationalId')(e.target.value)}
                    placeholder="As printed on your National ID"
                    className={inputClass()}
                  />
                </QField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <QField label="Your phone number">
                  <input
                    type="tel"
                    value={answers.phone}
                    onChange={(e) => set('phone')(e.target.value)}
                    placeholder="+592 600 0000"
                    className={inputClass()}
                  />
                </QField>
                {(profile?.region || profile?.village_or_town) && (
                  <QReadOnly
                    label="Where do you live?"
                    value={[profile?.village_or_town, profile?.region].filter(Boolean).join(', ')}
                    source="Profile"
                  />
                )}
              </div>
            </>
          )}

          {step === 'business' && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <QField label="Business name (optional)">
                  <input
                    value={answers.businessName}
                    onChange={(e) => set('businessName')(e.target.value)}
                    placeholder="The name you trade under, if you have one"
                    className={inputClass()}
                  />
                </QField>
                <QField label="Which region do you do business in?" required>
                  <QSelect value={answers.region} onChange={set('region')} options={REGIONS} placeholder="Choose a region" />
                </QField>
              </div>
              <QField
                label="What does your business sell or do?"
                required
                helpFirst
                help="For example: vegetables at the market, phone repairs, or hair braiding from home."
              >
                <QTextArea value={answers.tradeActivity} onChange={set('tradeActivity')} />
              </QField>
              <QField label="How long have you been in business?" required>
                <Chips
                  label="How long have you been in business?"
                  options={terms.trading_since}
                  value={answers.tradingSince}
                  onChange={set('tradingSince')}
                />
              </QField>
              <QField label="Business location" required help="Choose Mobile if you move around to sell or work.">
                <Chips
                  label="Business location"
                  options={terms.trade_locations}
                  value={answers.tradeLocation}
                  onChange={set('tradeLocation')}
                />
              </QField>
            </>
          )}

          {step === 'loan' && (
            <>
              <QField
                label="Loan amount (GYD)"
                required
                help={`Up to ${gyd(terms.ceiling)}. GDB decides the approved amount.`}
                error={overCap ? `Exceeds the ${gyd(terms.ceiling)} limit. Enter ${gyd(terms.ceiling)} or less.` : null}
              >
                <input
                  inputMode="numeric"
                  value={answers.amount ? Number(answers.amount).toLocaleString('en-US') : ''}
                  onChange={(e) => set('amount')(e.target.value.replace(/\D/g, ''))}
                  placeholder="For example: 150,000"
                  className={inputClass(overCap)}
                />
              </QField>
              <QField
                label="Purpose of the loan"
                required
                helpFirst
                help="What you will use the money for, and how it helps your business."
              >
                <QTextArea value={answers.purpose} onChange={set('purpose')} />
              </QField>
              <QField label="Repayment term" required help="Equal monthly instalments. 0% interest.">
                <QSelect
                  value={answers.term}
                  onChange={set('term')}
                  options={termOptions(terms.max_term).map((m): [string, string] => [String(m), `${m} month${m === 1 ? '' : 's'}`])}
                  placeholder="Choose a term"
                />
              </QField>
            </>
          )}

          {step === 'proof' && draft && (
            <>
              <QField
                label="Proof of business"
                helpFirst
                help="Photos of your goods, tools or workspace, or anything else that shows the business is running."
              >
                <DocumentShelf application={draft.name} only="Trading Photo" title="Proof of business" onChange={setMissing} />
              </QField>
              <QField label="Any receipts or invoices (optional)" helpFirst help="From suppliers or customers, if you keep them.">
                <DocumentShelf application={draft.name} only="Receipts or Records" title="Receipts or invoices" />
              </QField>
              <QField label="Identity document" helpFirst help="Identity evidence, where requested.">
                <DocumentShelf application={draft.name} only="Identity" title="Identity document" />
              </QField>
            </>
          )}

          {step === 'bank' && (
            <>
              <PayoutAccount
                value={{
                  bank: answers.bank,
                  accountNo: answers.accountNo,
                  branchCode,
                  holder: answers.holder,
                  confirmNo: answers.confirmNo,
                  manual: answers.manualAccount,
                }}
                onChange={(next) => {
                  // Includes the saved account arriving after a too-early
                  // Save: a message about a blank account must not outlive it.
                  setError(null);
                  setAnswers((a) => ({
                    ...a,
                    bank: next.bank,
                    accountNo: next.accountNo,
                    holder: next.holder,
                    confirmNo: next.confirmNo,
                    manualAccount: next.manual,
                  }));
                  setBranchCode(next.branchCode);
                }}
              />
              <p className="text-[12.5px] text-ql-muted">GDB checks the account before any payment is released.</p>
            </>
          )}

          <Footer>
            <QButton kind="secondary" back onClick={() => goTo(QUICK_STEPS[Math.max(index - 1, 0)].id)}>
              Back
            </QButton>
            <QButton disabled={busy} onClick={() => void goNext()}>
              {busy ? 'Saving…' : step === 'bank' ? 'Save and review' : 'Save and continue'}
            </QButton>
          </Footer>
        </>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <StepRail
          steps={RAIL_STEPS}
          current={step}
          stateOf={stateOf}
          canOpen={(id) => !busy && QUICK_STEPS.findIndex((s) => s.id === id) <= furthest}
          onOpen={(id) => {
            setTab('app');
            void jumpTo(QUICK_STEPS.findIndex((s) => s.id === id));
          }}
        />
        <Tabs
          items={[
            ['app', 'Your application'],
            ['docs', 'Documents'],
          ]}
          value={tab}
          onChange={(v) => {
            setError(null);
            setTab(v);
          }}
        />
        <Panel>{body}</Panel>
      </div>
    );
  };

  return <>{screen()}</>;
}
