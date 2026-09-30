import { useState } from 'react';
import { call } from '../../api';
import { Card, CardLabel } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { LoanApplication } from '../../types';
import { formatGyd } from '../../utils';

/** The Disbursement Officer's decision on a Quick Loan: approve AND pay, or
 *  decline — one act, by one officer (gdb_bank.api.decide_quick_loan).
 *
 *  GDB's exception to four-eyes, for this product only. The server holds the
 *  controls that replace the second pair of eyes — the ceiling re-checked, a
 *  payout account on file, never your own application, a recorded reason, one
 *  transaction — so this panel only asks for the reason and confirms payment. */
export function QuickDecision({ loan, onDecided }: { loan: LoanApplication; onDecided: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: 'approve' | 'decline') => {
    if (!reason.trim()) {
      setError('Enter a reason.');
      return;
    }
    if (action === 'approve' && !window.confirm(`Pay ${formatGyd(loan.loan_amount)} to ${loan.applicant_name}?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('gdb_bank.api.decide_quick_loan', { application: loan.name, action, remarks: reason });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The decision was not recorded');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border border-gdb-gold/60">
      <CardLabel>Decision</CardLabel>
      <p className="mt-2 text-sm text-slate-600">
        {formatGyd(loan.loan_amount)} · {loan.term_months} months
      </p>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void decide('approve')}>
          {busy ? 'Paying…' : 'Approve and pay'}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void decide('decline')}>
          Decline
        </Button>
      </div>
    </Card>
  );
}
