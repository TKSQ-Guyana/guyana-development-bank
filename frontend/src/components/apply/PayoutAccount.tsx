import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { BankAccountRecord } from '../../types';
import { ChoiceCard, Notice, SelectField, TextField } from './fields';

/** Where GDB pays the applicant — the same flow the SME form's Section J runs:
 *  ask the payment switch which accounts this e-ID holds, let the applicant pick
 *  one, fall back to typing it, and check a typed account with the bank. None of
 *  the outcomes stops an application; the server records the check on the
 *  account when it is saved (gdb_bank.api.save_bank_details), and release is
 *  where an unverified account is refused.
 *
 *  Controlled: the parent holds bank / account / branch and saves them. */
export interface PayoutValue {
  bank: string;
  accountNo: string;
  branchCode: string;
  /** Asked only of a typed account — a picked one comes with its holder. */
  holder: string;
  confirmNo: string;
  manual: boolean;
}

export function PayoutAccount({
  value,
  onChange,
}: {
  value: PayoutValue;
  onChange: (next: PayoutValue) => void;
}) {
  const [banks, setBanks] = useState<string[]>([]);
  const [mine, setMine] = useState<BankAccountRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [check, setCheck] = useState<BankAccountRecord | null>(null);
  const [checking, setChecking] = useState(false);

  const pick = (a: BankAccountRecord) => {
    onChange({
      ...value,
      bank: a.bank,
      accountNo: a.account_number,
      branchCode: a.branch_code ?? '',
      holder: a.account_name ?? value.holder,
      confirmNo: a.account_number,
      manual: false,
    });
    setCheck(null);
    setNote(null);
  };

  // The parent validates holder and confirmation only for a typed account.
  useEffect(() => {
    if (value.manual !== manual) onChange({ ...value, manual });
  }, [manual]);

  useEffect(() => {
    call<string[]>('gdb_bank.api.bank_options').then(setBanks).catch(() => setBanks([]));
    (async () => {
      try {
        const found = await call<BankAccountRecord[]>('gdb_bank.api.my_bank_accounts');
        setMine(found ?? []);
        if (found?.length === 1 && !value.accountNo) pick(found[0]);
        if (!found?.length) {
          setManual(true);
          const saved = await call<{ bank: string; bank_account_no: string; branch_code: string } | null>(
            'gdb_bank.api.my_bank_details',
          ).catch(() => null);
          if (saved && !value.accountNo) {
            onChange({
              ...value,
              bank: saved.bank ?? '',
              accountNo: saved.bank_account_no ?? '',
              branchCode: saved.branch_code ?? '',
              manual: true,
            });
          }
        }
      } catch {
        setMine([]);
        setManual(true);
        setNote('Bank unreachable. Enter your account below.');
      } finally {
        setLoading(false);
      }
    })();
    // Loaded once per mount; `value` seeds the choice but is not a dependency.
  }, []);

  const checkTyped = async () => {
    if (!value.bank || !value.accountNo) return;
    setChecking(true);
    try {
      setCheck(
        await call<BankAccountRecord>('gdb_bank.api.verify_bank_account', {
          bank: value.bank,
          bank_account_no: value.accountNo,
        }),
      );
    } catch {
      setCheck(null);
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Finding your accounts…</p>;

  if (!manual && (mine?.length ?? 0) > 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">
          {mine?.length === 1 ? 'Your registered account' : 'Choose an account'}
        </p>
        {mine?.map((a) => {
          const payable = a.status === 'Active';
          return (
            <ChoiceCard
              key={`${a.bank}-${a.account_number}`}
              title={a.bank}
              body={`••••${a.account_number.slice(-4)}${a.account_type ? ` · ${a.account_type}` : ''} · ${a.account_name ?? ''}`}
              note={payable ? undefined : `${a.status} — cannot receive payments`}
              disabled={!payable}
              selected={value.accountNo === a.account_number}
              onSelect={() => pick(a)}
            />
          );
        })}
        {mine?.[0]?.source !== 'bank_registry' && <p className="text-xs text-slate-500">Test data</p>}
        <button
          type="button"
          onClick={() => {
            setManual(true);
            setNote(null);
          }}
          className="text-xs font-semibold text-brand underline"
        >
          Use a different account
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SelectField
        label="Bank"
        required
        value={value.bank}
        onChange={(bank) => {
          onChange({ ...value, bank });
          setCheck(null);
        }}
        options={banks}
        placeholder="Choose an option"
        hint="Banks that can receive Ministry of Finance payments."
      />
      <div onBlur={() => void checkTyped()}>
        <TextField
          label="Account number"
          required
          inputMode="numeric"
          value={value.accountNo}
          onChange={(accountNo) => {
            onChange({ ...value, accountNo });
            setCheck(null);
          }}
          placeholder="Enter the account number"
        />
      </div>
      <TextField
        label="Confirm account number"
        required
        inputMode="numeric"
        value={value.confirmNo}
        onChange={(confirmNo) => onChange({ ...value, confirmNo })}
        placeholder="Enter it again"
      />
      <TextField
        label="Branch / branch code"
        value={value.branchCode}
        onChange={(branchCode) => onChange({ ...value, branchCode })}
        placeholder="For example: Water Street, or 012"
      />
      <TextField
        label="Account holder name"
        required
        value={value.holder}
        onChange={(holder) => onChange({ ...value, holder })}
        hint="As it appears on your bank records."
      />
      {checking && <p className="text-xs text-slate-500">Checking…</p>}
      {check && !checking && check.result !== 'Not Found' && (
        <Notice tone={check.result === 'Verified' ? 'good' : 'warn'}>
          {check.result === 'Verified' && `Verified — ${check.account_name}`}
          {check.result === 'Name Mismatch' && 'Name differs from your bank record'}
          {check.result === 'Inactive Account' && `Account ${check.status?.toLowerCase()} — use another`}
          {check.result === 'Unavailable' && 'Could not check with your bank'}
        </Notice>
      )}
      {note && <Notice tone="warn">{note}</Notice>}
      {(mine?.length ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => {
            setManual(false);
            setCheck(null);
            setNote(null);
          }}
          className="text-xs font-semibold text-brand underline"
        >
          Use a registered account
        </button>
      )}
    </div>
  );
}
