import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { call } from '../../api';
import { DocumentShelf } from '../../components/DocumentShelf';
import { Card } from '../../components/ui/Card';
import type { CitizenProfile, LoanApplication } from '../../types';
import {
  EMPTY_FINANCIALS,
  PersonalFinancialsForm,
  toForm,
  type PersonalFinancials,
} from './PersonalFinancialsForm';

/** A group member's own step: their personal financials, then the PDF behind them. */
export function MyFinancialsPage() {
  const { name = '' } = useParams<{ name: string }>();
  const [loan, setLoan] = useState<LoanApplication | null>(null);
  const [form, setForm] = useState<PersonalFinancials>(EMPTY_FINANCIALS);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<LoanApplication>('gdb_bank.api.loan_detail', { name })
      .then(setLoan)
      .catch((err: Error) => setError(err.message));
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((profile) => setForm(toForm(profile)))
      .catch((err: Error) => setError(err.message));
  }, [name]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const profile = await call<CitizenProfile>('gdb_bank.profiles.save_personal_financials', { ...form });
      setForm(toForm(profile));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to={`/loans/${name}`} className="text-sm font-medium text-brand hover:underline">
        ← Back to the group application
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Your personal financials</h1>
        {loan && (
          <p className="mt-1 text-sm text-slate-500">
            {loan.cluster} · {loan.name}
          </p>
        )}
      </div>

      <Card>
        <PersonalFinancialsForm
          value={form}
          onChange={(next) => {
            setForm(next);
            setSaved(false);
          }}
        />
      </Card>

      <DocumentShelf application={name} only="Personal Financials" title="Supporting document" />

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm font-semibold text-emerald-700">Saved</span>}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-md bg-black px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-black/20 transition-colors hover:bg-[#262626] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
