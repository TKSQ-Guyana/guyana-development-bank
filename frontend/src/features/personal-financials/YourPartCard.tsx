import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../../api';
import { Card } from '../../components/ui/Card';
import { CheckIcon } from '../../components/ui/icons';
import type { CitizenProfile } from '../../types';
import { formatDate } from '../../utils';

/** A group member's one task on the head's case, and whether it is done. */
export function YourPartCard({ application }: { application: string }) {
  const [doneOn, setDoneOn] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    call<CitizenProfile>('gdb_bank.profiles.my_profile')
      .then((p) => setDoneOn(p.financials_updated_on))
      .catch(() => setDoneOn(null));
  }, []);

  if (doneOn === undefined) return null;

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${
              doneOn ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {doneOn ? <CheckIcon className="h-4 w-4" /> : '!'}
          </span>
          <div>
            <p className="font-semibold text-slate-900">Your part: personal financials</p>
            <p className="text-sm text-slate-500">
              {doneOn ? `Saved ${formatDate(doneOn)}` : 'GDB assesses every member of the group.'}
            </p>
          </div>
        </div>
        <Link
          to={`/loans/${application}/my-financials`}
          className={
            doneOn
              ? 'rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'
              : 'rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/30 hover:bg-brand-dark'
          }
        >
          {doneOn ? 'Update' : 'Add your financials'}
        </Link>
      </div>
    </Card>
  );
}
