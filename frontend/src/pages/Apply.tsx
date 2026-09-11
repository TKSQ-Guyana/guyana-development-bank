import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { call } from '../api';
import type { Cluster, LoanApplication } from '../types';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 focus:border-gdb-green focus:outline-none focus:ring-1 focus:ring-gdb-green';

export function Apply() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('12');
  const [income, setIncome] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [cluster, setCluster] = useState<Cluster | null>(null);

  useEffect(() => {
    call<Cluster | null>('gdb_bank.api.my_cluster')
      .then((c) => {
        setCluster(c);
        if (c?.loan_purpose) setPurpose(c.loan_purpose);
      })
      .catch(() => setCluster(null));
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const loan = await call<LoanApplication>('gdb_bank.api.apply_loan', {
        loan_amount: Number(amount),
        purpose,
        term_months: Number(term),
        monthly_income: income ? Number(income) : 0,
        phone,
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
