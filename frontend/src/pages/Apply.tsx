import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { call } from '../api';
import { useAuth } from '../auth';
import type { BankAccountRecord, Cluster, DcraRecord, LoanApplication } from '../types';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green';

export function Apply() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('12');
  const [income, setIncome] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [cluster, setCluster] = useState<Cluster | null>(null);
  // Where GDB pays out. Captured here because the applicant is the only one
  // who knows it, and a disbursement has nowhere to go without it.
  const [banks, setBanks] = useState<string[]>([]);
  const [bank, setBank] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [branchCode, setBranchCode] = useState('');
  // Accounts the payment switch says are this applicant's. They pick from
  // these rather than typing a number — which is also why they cannot
  // nominate somebody else's account, and why a transposed digit is not a
  // way to lose a disbursement.
  const [myAccounts, setMyAccounts] = useState<BankAccountRecord[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [manualAccount, setManualAccount] = useState(false);
  const [accountNote, setAccountNote] = useState<string | null>(null);
  // The result of checking a typed account. Advisory: it is shown and
  // recorded, and it never blocks the application.
  const [accountCheck, setAccountCheck] = useState<BankAccountRecord | null>(null);
  const [checking, setChecking] = useState(false);
  // Existing trading business or a start-up — asked first, because it decides
  // what the rest of this section can even ask for.
  const [stage, setStage] = useState<'' | 'Existing' | 'New'>('');
  // DCRA: the registered business behind the application.
  const [dcra, setDcra] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [dcraNote, setDcraNote] = useState<string | null>(null);
  const [dcraRecord, setDcraRecord] = useState<DcraRecord | null>(null);
  // Businesses DCRA says are this applicant's. They pick from these rather
  // than typing a number — which is also why they cannot claim someone else's.
  const [myBusinesses, setMyBusinesses] = useState<DcraRecord[] | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    call<Cluster | null>('gdb_bank.api.my_cluster')
      .then((c) => {
        setCluster(c);
        if (c?.loan_purpose) setPurpose(c.loan_purpose);
      })
      .catch(() => setCluster(null));
  }, []);

  useEffect(() => {
    call<string[]>('gdb_bank.api.bank_options').then(setBanks).catch(() => setBanks([]));
    void loadMyAccounts();

    call<{ dcra_number: string; business_name: string } | null>('gdb_bank.api.my_business')
      .then((b) => {
        if (!b) return;
        // Remember the stage, not the business: the register is asked afresh
        // each time so a struck-off or transferred registration is caught.
        setStage('Existing');
        void loadMyBusinesses();
      })
      .catch(() => undefined);
  }, []);

  const selectAccount = (a: BankAccountRecord) => {
    setBank(a.bank);
    setAccountNo(a.account_number);
    setBranchCode(a.branch_code ?? '');
    setAccountCheck(null);
    setAccountNote(null);
  };

  // Ask the switch which accounts this applicant holds. One selects itself;
  // several offer a choice; none falls back to typing, because a switch that
  // cannot answer must not stop an application — the account the applicant
  // then types is checked instead, and the result recorded either way.
  const loadMyAccounts = async () => {
    setAccountsLoading(true);
    try {
      const found = await call<BankAccountRecord[]>('gdb_bank.api.my_bank_accounts');
      setMyAccounts(found ?? []);
      if (found?.length === 1) selectAccount(found[0]);
      if (!found?.length) {
        setManualAccount(true);
        // The account they nominated last time, if there is one. Only ever a
        // fallback: an account the switch confirms is better evidence than an
        // account GDB merely stored once.
        await call<{ bank: string; bank_account_no: string; branch_code: string } | null>(
          'gdb_bank.api.my_bank_details',
        )
          .then((d) => {
            if (!d) return;
            setBank(d.bank ?? '');
            setAccountNo(d.bank_account_no ?? '');
            setBranchCode(d.branch_code ?? '');
          })
          .catch(() => undefined);
        setAccountNote(
          'We could not find an account registered in your name. Enter it yourself and GDB will verify it before paying out.',
        );
      }
    } catch {
      setMyAccounts([]);
      setManualAccount(true);
      setAccountNote(
        'Your bank could not be reached. Enter your account details and GDB will verify them before paying out.',
      );
    } finally {
      setAccountsLoading(false);
    }
  };

  // Check a typed account. Never blocks: what it does is make sure nobody
  // downstream has to guess whether the destination was ever checked.
  const checkTypedAccount = async () => {
    if (!bank || !accountNo) return;
    setChecking(true);
    try {
      setAccountCheck(
        await call<BankAccountRecord>('gdb_bank.api.verify_bank_account', {
          bank,
          bank_account_no: accountNo,
        }),
      );
    } catch {
      setAccountCheck(null);
    } finally {
      setChecking(false);
    }
  };

  const selectBusiness = (b: DcraRecord) => {
    setDcraRecord(b);
    setDcra(b.registration_number);
    setBusinessName(b.business_name ?? '');
    setDcraNote(null);
  };

  // Load the applicant's own registrations the moment they say the business
  // already exists. One hit selects itself; several offer a choice; none falls
  // back to typing, because a registry that cannot answer must not stop an
  // application.
  const loadMyBusinesses = async () => {
    setLooking(true);
    try {
      const found = await call<DcraRecord[]>('gdb_bank.api.my_businesses');
      setMyBusinesses(found ?? []);
      if (found?.length === 1) selectBusiness(found[0]);
      if (!found?.length) {
        setManualEntry(true);
        setDcraNote('DCRA has no business registered in your name. Enter the details yourself and GDB will verify them.');
      }
    } catch {
      setMyBusinesses([]);
      setManualEntry(true);
      setDcraNote('DCRA could not be reached. Enter the details yourself and GDB will verify them.');
    } finally {
      setLooking(false);
    }
  };

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Save the payout destination first: if this fails the applicant should
      // fix it and retry, not end up with a loan nobody can pay.
      await call('gdb_bank.api.save_bank_details', {
        bank,
        bank_account_no: accountNo,
        branch_code: branchCode,
      });
      const loan = await call<LoanApplication>('gdb_bank.api.apply_loan', {
        loan_amount: Number(amount),
        purpose,
        term_months: Number(term),
        monthly_income: income ? Number(income) : 0,
        phone,
        business_stage: stage,
        dcra_number: dcra,
        business_name: businessName,
      });
      navigate(`/loans/${loan.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-2xl font-bold">Apply for a Loan</h1>
      <p className="mb-6 text-sm text-slate-500">
        Your application goes straight to a GDB underwriter for review.
      </p>
      {cluster && (
        <p className="mb-6 rounded-md bg-gdb-gold/20 px-3 py-2 text-sm text-gdb-green-dark">
          This application will be linked to your cluster <strong>{cluster.name}</strong>
          {cluster.is_head
            ? ' — as head, you are applying on behalf of the group.'
            : ' — it stays your own application.'}
        </p>
      )}
      {/* Who this application will be filed under. Read-only on purpose: the
          name comes from the identity they signed in with, not from typing. */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Applying as</p>
        <p className="mt-1 text-lg font-semibold text-slate-800">{user?.full_name ?? '—'}</p>
        <p className="text-sm text-slate-500">
          {user?.eid ? (
            <>
              e-ID <span className="font-mono">{user.eid}</span>
            </>
          ) : (
            user?.user
          )}
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 rounded-xl bg-white p-6 shadow">
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Loan amount (GYD)</span>
            <input
              type="number"
              required
              min={1}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Term (months)</span>
            <input
              type="number"
              required
              min={1}
              max={360}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Monthly income (GYD, optional)
            </span>
            <input
              type="number"
              min={0}
              step="1"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Phone (optional)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Purpose of the loan</span>
          <textarea
            required
            rows={4}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Working capital for my agro-processing business"
            className={inputClass}
          />
        </label>

        <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">
            Your registered business
          </legend>
          <p className="mb-3 text-xs text-slate-500">
            Is this loan for a business you already run, or one you are starting?
          </p>

          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ['Existing', 'Existing business', 'Already registered with DCRA'],
                ['New', 'New business', 'Not registered yet'],
              ] as const
            ).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setStage(value);
                  setDcraNote(null);
                  setDcraRecord(null);
                  setManualEntry(false);
                  if (value === 'Existing') void loadMyBusinesses();
                  // A start-up has no registration, so never carry one across
                  // the switch and submit a number that belongs elsewhere.
                  if (value === 'New') setDcra('');
                }}
                className={`rounded-lg border p-3 text-left ${
                  stage === value
                    ? 'border-gdb-green bg-gdb-green/5 ring-1 ring-gdb-green'
                    : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-800">{title}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </button>
            ))}
          </div>

          {stage === 'Existing' && (
            <>
              {looking && (
                <p className="text-sm text-slate-500">Finding your businesses at DCRA…</p>
              )}

              {/* More than one registration in their name — they choose which
                  this loan is for. No typing, so no claiming another person's. */}
              {!manualEntry && (myBusinesses?.length ?? 0) > 1 && (
                <div className="mb-3 space-y-2">
                  <p className="text-sm font-medium text-slate-700">
                    DCRA has {myBusinesses?.length} businesses registered to you. Which is this
                    loan for?
                  </p>
                  {myBusinesses?.map((b) => (
                    <button
                      key={b.registration_number}
                      type="button"
                      onClick={() => selectBusiness(b)}
                      className={`w-full rounded-lg border p-3 text-left ${
                        dcra === b.registration_number
                          ? 'border-gdb-green bg-gdb-green/5 ring-1 ring-gdb-green'
                          : 'border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-slate-800">
                        {b.business_name}
                      </span>
                      <span className="block font-mono text-xs text-slate-500">
                        {b.registration_number} · {b.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* The registry could not help, so the number is typed after all
                  — and GDB verifies it rather than the form. */}
              {manualEntry && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    DCRA registration no.
                  </span>
                  <input
                    required
                    value={dcra}
                    onChange={(e) => setDcra(e.target.value.toUpperCase())}
                    placeholder="e.g. BN-2024-004512"
                    className={inputClass}
                  />
                </label>
              )}

              {/* The register answered — show what it holds, read-only. The
                  applicant supplies the number; DCRA supplies everything else. */}
              {dcraRecord?.business_name && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">{dcraRecord.business_name}</p>
                      <p className="font-mono text-xs text-slate-500">
                        {dcraRecord.registration_number}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        dcraRecord.status === 'Active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {dcraRecord.status}
                    </span>
                  </div>
                  <dl className="space-y-1 text-xs text-slate-600">
                    {dcraRecord.business_type && (
                      <div>
                        <dt className="inline text-slate-500">Type: </dt>
                        <dd className="inline">{dcraRecord.business_type}</dd>
                      </div>
                    )}
                    {dcraRecord.registered_on && (
                      <div>
                        <dt className="inline text-slate-500">Registered: </dt>
                        <dd className="inline">{dcraRecord.registered_on}</dd>
                      </div>
                    )}
                    {dcraRecord.region && (
                      <div>
                        <dt className="inline text-slate-500">Region: </dt>
                        <dd className="inline">{dcraRecord.region}</dd>
                      </div>
                    )}
                    {dcraRecord.proprietors?.length ? (
                      <div>
                        <dt className="inline text-slate-500">Proprietors: </dt>
                        <dd className="inline">{dcraRecord.proprietors.join(', ')}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="mt-2 text-xs text-slate-400">
                    {dcraRecord.source === 'dcra'
                      ? 'From the DCRA register.'
                      : dcraRecord.source === 'gdb_history'
                        ? 'From your earlier GDB application — GDB will verify it against DCRA.'
                        : 'Sandbox register — for testing only.'}
                  </p>
                  {dcraRecord.status && dcraRecord.status !== 'Active' && (
                    <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                      This registration is not active. GDB may ask you to restore it before funds
                      are released.
                    </p>
                  )}
                </div>
              )}

              {/* Manual path only: the register could not answer. */}
              {manualEntry && !dcraRecord?.business_name && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Registered business name
                  </span>
                  <input
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="As it appears on the certificate"
                    className={inputClass}
                  />
                </label>
              )}
              {dcraNote && <p className="mt-2 text-xs text-amber-700">{dcraNote}</p>}
            </>
          )}

          {stage === 'New' && (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Proposed business name
                </span>
                <input
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="What you intend to trade as"
                  className={inputClass}
                />
              </label>
              <p className="mt-2 rounded-md bg-gdb-gold/20 px-3 py-2 text-xs text-gdb-green-dark">
                No DCRA number is needed to apply. You will need to register the business with
                the Deeds and Commercial Registries Authority before funds can be released.
              </p>
            </>
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">
            Where should we pay you?
          </legend>
          <p className="mb-3 text-xs text-slate-500">
            If your loan is approved, GDB transfers the funds to this account. It must be in your
            own name.
          </p>

          {accountsLoading && (
            <p className="text-sm text-slate-500">Finding accounts registered in your name…</p>
          )}

          {/* Picked, never typed. The applicant can only choose an account the
              switch says is theirs, so a misdirected payout is not something
              this form can express. */}
          {!manualAccount && (myAccounts?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">
                {myAccounts?.length === 1
                  ? 'This account is registered in your name.'
                  : `You hold ${myAccounts?.length} accounts. Which should GDB pay into?`}
              </p>
              {myAccounts?.map((a) => {
                const payable = a.status === 'Active';
                return (
                  <button
                    key={`${a.bank}-${a.account_number}`}
                    type="button"
                    disabled={!payable}
                    onClick={() => selectAccount(a)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      accountNo === a.account_number
                        ? 'border-gdb-green bg-gdb-green/5 ring-1 ring-gdb-green'
                        : payable
                          ? 'border-slate-300 hover:bg-slate-50'
                          : 'border-slate-200 bg-slate-50 opacity-60'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-slate-800">{a.bank}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      ••••{a.account_number.slice(-4)}
                      {a.account_type ? ` · ${a.account_type}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">{a.account_name}</span>
                    {/* A real account in the right name that still cannot
                        receive funds. The applicant needs to know why it is
                        greyed out, not just that it is. */}
                    {!payable && (
                      <span className="mt-1 block text-xs font-medium text-amber-700">
                        {a.status} — your bank cannot receive a payment into this account.
                      </span>
                    )}
                  </button>
                );
              })}
              <p className="text-xs text-slate-500">
                {myAccounts?.[0]?.source === 'bank_registry'
                  ? 'From your bank. GDB confirms it again before paying out.'
                  : 'Test data — GDB confirms the account with your bank before paying out.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setManualAccount(true);
                  setAccountNote(null);
                }}
                className="text-xs font-medium text-gdb-green underline"
              >
                Pay into a different account
              </button>
            </div>
          )}

          {manualAccount && (
            <>
              <label className="mb-3 block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Bank</span>
                <select
                  required
                  value={bank}
                  onChange={(e) => {
                    setBank(e.target.value);
                    setAccountCheck(null);
                  }}
                  className={inputClass}
                >
                  <option value="">Select your bank…</option>
                  {banks.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-3 block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Account number
                </span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={accountNo}
                  onChange={(e) => {
                    setAccountNo(e.target.value);
                    setAccountCheck(null);
                  }}
                  onBlur={() => void checkTypedAccount()}
                  placeholder="Digits only, as printed on your statement"
                  className={inputClass}
                />
              </label>
              <label className="mb-3 block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Branch code <span className="font-normal text-slate-400">(optional)</span>
                </span>
                <input
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value)}
                  placeholder="e.g. DEM-GT-04"
                  className={inputClass}
                />
              </label>

              {checking && <p className="text-xs text-slate-500">Checking with the bank…</p>}

              {/* Three outcomes, never two. "We could not check" is said out
                  loud rather than shown as a pass — and none of them stops the
                  application, because a name the bank holds differently is an
                  underwriter's call, not a dead end on a form. */}
              {accountCheck && !checking && (
                <p
                  className={`text-xs ${
                    accountCheck.result === 'Verified' ? 'text-green-700' : 'text-amber-700'
                  }`}
                >
                  {accountCheck.result === 'Verified' &&
                    `Confirmed — held by ${accountCheck.account_name}.`}
                  {accountCheck.result === 'Name Mismatch' &&
                    'Your bank holds this account in a different name. You can still apply; GDB will check it before paying out.'}
                  {accountCheck.result === 'Inactive Account' &&
                    `This account is ${accountCheck.status?.toLowerCase()} and cannot receive a payment. Nominate another one.`}
                  {accountCheck.result === 'Not Found' &&
                    'Your bank has no account with this number. Check the digits against your statement.'}
                  {accountCheck.result === 'Unavailable' &&
                    'We could not reach your bank to check this. You can still apply; GDB will verify it before paying out.'}
                </p>
              )}

              {accountNote && <p className="mt-2 text-xs text-amber-700">{accountNote}</p>}

              {(myAccounts?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setManualAccount(false);
                    setAccountCheck(null);
                    setAccountNote(null);
                  }}
                  className="mt-2 text-xs font-medium text-gdb-green underline"
                >
                  Back to my registered accounts
                </button>
              )}
            </>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-gdb-green px-4 py-2 font-semibold text-white hover:bg-gdb-green-dark disabled:opacity-60"
        >
          {busy ? 'Submitting…' : 'Submit application'}
        </button>
      </form>
    </div>
  );
}
