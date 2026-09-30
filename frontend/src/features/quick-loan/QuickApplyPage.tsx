import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../../api';
import { useAuth } from '../../auth';
import { DocumentShelf } from '../../components/DocumentShelf';
import { Card } from '../../components/ui/Card';
import { ArrowRightIcon, CheckIcon } from '../../components/ui/icons';
import {
  ChoiceCard,
  MoneyField,
  Notice,
  ReadOnlyField,
  Section,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/apply/fields';
import { REGIONS } from '../../components/apply/cluster';
import { PayoutAccount } from '../../components/apply/PayoutAccount';
import { FieldOfficerRequest } from './FieldOfficerRequest';
import type { CitizenProfile, LoanApplication } from '../../types';
import {
  blockerFor,
  EMPTY_ANSWERS,
  fromDraft,
  gyd,
  QUICK_STEPS,
  termOptions,
  toSavePayload,
  type QuickAnswers,
  type QuickLoanTerms,
  type QuickStepId,
} from './model/quickLoan';

/** The Quick Loan application — an informal trader's own short form.
 *
 *  Deliberately NOT a branch of the SME wizard: no TIN, no DCRA, no accounts, no
 *  business plan. Identity, what they do and where, a photo of the trade, how
 *  much and what for, and where to pay them. The rules live in
 *  model/quickLoan.ts; the enforcement lives on the server.
 *
 *  Nothing is kept on the device. Until the loan step there is nothing the
 *  server will hold as a draft, and after it every step is saved to GDB — the
 *  applicant's answers never sit in browser storage.
 */
export function QuickApplyPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { name: routeName } = useParams<{ name: string }>();

  const [terms, setTerms] = useState<QuickLoanTerms | null>(null);
  const [answers, setAnswers] = useState<QuickAnswers>(EMPTY_ANSWERS);
  const [branchCode, setBranchCode] = useState('');
  const [step, setStep] = useState<QuickStepId>('eligibility');
  const [draft, setDraft] = useState<LoanApplication | null>(null);
  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<LoanApplication | null>(null);
  // "I need help from a field officer" — the request form instead of the steps.
  const [helping, setHelping] = useState(false);
  // The separate submit page, reached from Review.
  const [confirming, setConfirming] = useState(false);
  // The draft this page already holds — so the URL moving from /apply/quick to
  // /apply/quick/<name> on the first save is not read as "open another draft".
  const loaded = useRef<string | null>(null);

  const set =
    <K extends keyof QuickAnswers>(key: K) =>
    (value: QuickAnswers[K]) =>
      setAnswers((a) => ({ ...a, [key]: value }));

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

  const index = QUICK_STEPS.findIndex((s) => s.id === step);
  const current = QUICK_STEPS[index];
  const isLast = step === 'review';

  const saveDraft = async (): Promise<LoanApplication> => {
    const saved = await call<LoanApplication>(
      'gdb_bank.api.save_application',
      toSavePayload(answers, draft?.name),
    );
    setDraft(saved);
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
    setStep(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goNext = async () => {
    if (!terms) return;
    const blocker = blockerFor(step, answers, terms);
    if (blocker) {
      setError(blocker);
      return;
    }
    if (step === 'eligibility' && answers.how === 'help') {
      setError(null);
      setHelping(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (step === 'eligibility' && !consented) {
      if (!consentChecked) {
        setError('Agree to let GDB look up your bank accounts to continue.');
        return;
      }
      if (!(await run(() => call('gdb_bank.profiles.record_consent')))) return;
      setConsented(true);
    }
    // Date of birth and national ID are the person's, so they go on the profile.
    if (
      step === 'about' &&
      !(await run(() =>
        call('gdb_bank.profiles.save_profile', { date_of_birth: answers.dob, national_id: answers.nationalId }),
      ))
    )
      return;
    // The loan step is the first the server will hold as a draft; from here
    // on, moving forward saves to GDB.
    if (step === 'loan' && !(await run(saveDraft))) return;
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
      if (!saved) return;
    }
    goTo(QUICK_STEPS[Math.min(index + 1, QUICK_STEPS.length - 1)].id);
  };

  const submit = async () => {
    if (!terms) return;
    const blocker = blockerFor('confirm', answers, terms);
    if (blocker) {
      setError(blocker);
      return;
    }
    await run(async () => {
      const saved = await saveDraft();
      setSubmitted(
        await call<LoanApplication>('gdb_bank.api.submit_application', {
          name: saved.name,
          accept_terms: 1,
          credit_check_consent: 1,
        }),
      );
    });
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Your application has been submitted</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your application is now read-only. GDB will review it and contact you if more information is needed.
        </p>
        <p className="mt-2 font-mono text-sm text-slate-500">{submitted.name}</p>
        <button
          type="button"
          onClick={() => navigate(`/loans/${submitted.name}`)}
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-brand px-6 py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark"
        >
          View submitted application
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!terms) {
    return error ? (
      <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>
    ) : (
      <p className="text-slate-500">Loading…</p>
    );
  }

  const interest = `${terms.rate_of_interest}% interest`;

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
    return (
      <div>
        <header className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Quick Loan</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">Confirm your submission</h2>
          <p className="mt-1 text-sm text-slate-500">
            Quick Loan · {gyd(Number(answers.amount))} · {answers.term} months · {interest}
          </p>
        </header>
        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            {error}
          </div>
        )}
        <Card className="space-y-6">
          <Notice tone="warn">
            You will not be able to edit after submission. GDB can request specific corrections or additional
            information through a Request for Information. Submission is not a lending decision.
          </Notice>
          <Section letter="1" title="Your confirmation">
            {(
              [
                ['accurate', 'I confirm that the information I have provided is accurate.'],
                ['noGuarantee', 'I understand that submitting this application does not guarantee a loan.'],
              ] as const
            ).map(([key, text]) => (
              <label key={key} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={answers[key]}
                  onChange={(e) => set(key)(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                <span className="text-sm text-slate-700">{text}</span>
              </label>
            ))}
          </Section>
          <Section
            letter="2"
            title="Credit check consent"
            blurb="GDB checks your credit history with EveryData, the credit bureau, before a person at GDB decides on your application."
          >
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={answers.creditConsent}
                onChange={(e) => set('creditConsent')(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
              />
              <span className="text-sm text-slate-700">
                I consent to GDB obtaining my credit report from EveryData to assess this application.
              </span>
            </label>
          </Section>
        </Card>
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(false);
            }}
            className="rounded-md px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100"
          >
            Back to review
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <nav className="mb-6 overflow-x-auto scrollbar-none" aria-label="Quick Loan steps">
        <ol className="flex min-w-max items-center">
          {QUICK_STEPS.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => i <= index && goTo(s.id)}
                  disabled={i > index}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors ${
                    active ? 'bg-white shadow-sm' : done ? 'hover:bg-white/60' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                      done
                        ? 'bg-brand text-white'
                        : active
                          ? 'bg-brand text-white ring-4 ring-brand/15'
                          : 'border-2 border-slate-200 bg-white text-slate-300'
                    }`}
                  >
                    {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
                  </span>
                  <span
                    className={`hidden text-xs whitespace-nowrap sm:inline ${
                      active ? 'font-bold text-slate-900' : done ? 'font-medium text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    {s.title}
                  </span>
                </button>
                {i < QUICK_STEPS.length - 1 && <span className="mx-1 h-px w-4 flex-none bg-slate-200 sm:w-8" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <header className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          Quick Loan · Step {index + 1} of {QUICK_STEPS.length}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-slate-900">{current.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{current.blurb}</p>
      </header>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      )}

      <Card className="space-y-6 pb-20">
        {step === 'eligibility' && (
          <>
            <Section
              letter="1"
              title="For small businesses"
              blurb={`Loan up to ${gyd(terms.ceiling)} · Interest ${terms.rate_of_interest}% · Collateral: None`}
            >
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                <li>Market vendors</li>
                <li>Small services, like repairs, hair or tailoring</li>
                <li>Home-based and mobile businesses</li>
                <li>Other small businesses</li>
              </ul>
            </Section>
            <Section letter="2" title="How would you like to apply?">
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  title="I will apply myself"
                  body="Fill in the application in this portal. Your answers save as you go."
                  selected={answers.how === 'self'}
                  onSelect={() => set('how')('self')}
                />
                <ChoiceCard
                  title="I need help from a field officer"
                  body="A GDB field officer contacts you and completes the application with you."
                  selected={answers.how === 'help'}
                  onSelect={() => set('how')('help')}
                />
              </div>
            </Section>
            {consented === false && answers.how !== 'help' && (
              <Section letter="3" title="Before you continue">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50/80 p-3.5">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  <span className="text-sm font-medium text-slate-800">
                    I agree to GDB receiving these records for my application.
                  </span>
                </label>
              </Section>
            )}
          </>
        )}

        {step === 'about' && (
          <>
            <Section letter="1" title="About you">
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnlyField label="Full legal name" value={user?.full_name ?? '—'} source="e-ID" />
                <TextField
                  label="Date of birth"
                  required
                  type="date"
                  value={answers.dob}
                  onChange={set('dob')}
                />
                <ReadOnlyField label="e-ID number" value={user?.eid ?? '—'} source="e-ID" />
                <TextField
                  label="National ID number"
                  required
                  value={answers.nationalId}
                  onChange={set('nationalId')}
                  placeholder="As printed on your National ID"
                />
                <TextField
                  label="Your phone number"
                  inputMode="tel"
                  value={answers.phone}
                  onChange={set('phone')}
                  placeholder="+592 600 0000"
                />
                {(profile?.region || profile?.village_or_town) && (
                  <ReadOnlyField
                    label="Where do you live?"
                    value={[profile?.village_or_town, profile?.region].filter(Boolean).join(', ')}
                    source="Profile"
                  />
                )}
              </div>
            </Section>
            <Section
              letter="2"
              title="Priority-group declaration"
              blurb="Select the groups that apply to you."
            >
              {(
                [
                  ['youth', 'Youth entrepreneur'],
                  ['woman', 'Woman entrepreneur'],
                ] as const
              ).map(([key, text]) => (
                <label key={key} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={answers[key]}
                    onChange={(e) => set(key)(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  <span className="text-sm text-slate-700">{text}</span>
                </label>
              ))}
            </Section>
          </>
        )}

        {step === 'business' && (
          <>
            <Section letter="1" title="What does your business sell or do?">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Business name"
                  value={answers.businessName}
                  onChange={set('businessName')}
                  placeholder="The name you trade under, if you have one"
                />
                <SelectField
                  label="Which region do you do business in?"
                  required
                  value={answers.region}
                  onChange={set('region')}
                  options={REGIONS}
                  placeholder="Choose a region"
                />
              </div>
              <TextAreaField
                label="What does your business sell or do?"
                required
                rows={2}
                value={answers.tradeActivity}
                onChange={set('tradeActivity')}
                hint="For example: vegetables at the market, phone repairs, or hair braiding from home."
              />
            </Section>
            <Section letter="2" title="Business location" blurb="Choose Mobile if you move around to sell or work.">
              <div className="grid gap-3 sm:grid-cols-3">
                {terms.trade_locations.map((place) => (
                  <ChoiceCard
                    key={place}
                    title={place}
                    selected={answers.tradeLocation === place}
                    onSelect={() => set('tradeLocation')(place)}
                  />
                ))}
              </div>
            </Section>
            <Section letter="3" title="How long have you been in business?">
              <SelectField
                label="How long have you been in business?"
                required
                value={answers.tradingSince}
                onChange={set('tradingSince')}
                options={terms.trading_since}
                placeholder="Choose…"
              />
            </Section>
          </>
        )}

        {step === 'loan' && (
          <>
            <Section letter="1" title="Loan amount">
              <MoneyField
                label="Loan amount (GYD)"
                required
                value={answers.amount}
                onChange={set('amount')}
                hint={`Up to ${gyd(terms.ceiling)}. GDB decides the approved amount.`}
              />
            </Section>
            <Section letter="2" title="Purpose of the loan">
              <TextAreaField
                label="Purpose of the loan"
                required
                rows={2}
                value={answers.purpose}
                onChange={set('purpose')}
                hint="What you will use the money for, and how it helps your business."
              />
            </Section>
            <Section letter="3" title="Repayment term">
              <SelectField
                label="Monthly instalments"
                required
                value={answers.term}
                onChange={set('term')}
                options={termOptions(terms.max_term).map(String)}
              />
            </Section>
          </>
        )}

        {step === 'proof' && draft && (
          <>
            <Section
              letter="1"
              title="Proof of business"
              blurb="Photos of your goods, tools or workspace, or anything else that shows the business is running."
            >
              <DocumentShelf
                application={draft.name}
                only="Trading Photo"
                title="Proof of business"
                onChange={setMissing}
              />
            </Section>
            <Section
              letter="2"
              title="Any receipts or invoices (optional)"
              blurb="From suppliers or customers, if you keep them."
            >
              <DocumentShelf application={draft.name} only="Receipts or Records" title="Receipts or invoices" />
            </Section>
            <Section letter="3" title="Identity document" blurb="Identity evidence, where requested.">
              <DocumentShelf application={draft.name} only="Identity" title="Identity document" />
            </Section>
          </>
        )}

        {step === 'bank' && (
          <Section letter="1" title="Account for the loan" blurb="GDB checks the account before any payment is released.">
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
          </Section>
        )}

        {step === 'review' && (
          <>
            <Section letter="1" title="Review your application" blurb="Review all details before sending them to GDB.">
              <dl className="divide-y divide-slate-100 text-sm">
                {[
                  ['About you', `${user?.full_name ?? '—'} · e-ID: ${user?.eid ?? '—'}`],
                  ['Date of birth', answers.dob || '—'],
                  ['National ID', answers.nationalId ? `•••• ${answers.nationalId.slice(-4)}` : '—'],
                  [
                    'Priority groups',
                    [answers.youth && 'Youth', answers.woman && 'Woman'].filter(Boolean).join(', ') || 'None',
                  ],
                  ['Business name', answers.businessName || '—'],
                  ['Region', answers.region || '—'],
                  ['What your business sells or does', answers.tradeActivity],
                  ['Business location', answers.tradeLocation],
                  ['In business', answers.tradingSince || '—'],
                  ['Loan amount', gyd(Number(answers.amount))],
                  ['Monthly instalments', `${answers.term}`],
                  ['Purpose', answers.purpose],
                  [
                    'Bank information',
                    answers.accountNo
                      ? `${answers.bank} · •••• ${answers.accountNo.slice(-4)}${
                          answers.holder ? ` · ${answers.holder}` : ''
                        }`
                      : '—',
                  ],
                  [
                    'Documents',
                    missing.length ? `Still needed: ${missing.join(', ')}` : 'No outstanding items',
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-3 py-2">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="col-span-2 whitespace-pre-wrap font-medium text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
            <div className="rounded-lg bg-slate-50/80 p-5">
              <p className="text-sm text-slate-600">Review does not submit your application.</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="mt-4 w-full rounded-md bg-brand px-5 py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                Continue to submit
              </button>
            </div>
          </>
        )}
      </Card>

      {!isLast && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => goTo(QUICK_STEPS[Math.max(index - 1, 0)].id)}
            disabled={index === 0}
            className="rounded-md px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
          >
            Back
          </button>
          <span className="order-last w-full text-xs text-slate-400 sm:order-none sm:w-auto">
            {draft ? 'Draft saved' : ''}
          </span>
          <button
            type="button"
            onClick={() => void goNext()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {busy
              ? 'Saving…'
              : step === 'eligibility'
                ? answers.how === 'help'
                  ? 'Continue to request help'
                  : 'Start application'
                : step === 'bank'
                  ? 'Save and review'
                  : 'Save and continue'}
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
