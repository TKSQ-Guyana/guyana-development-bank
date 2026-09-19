import { Card } from '../components/ui/Card';
import { TrainingIcon } from '../components/ui/icons';

/** Placeholder. Training is a real capability in the programme spec — modules
 *  configured by product and sector, completion synchronised from the provider,
 *  tracked separately for every cluster member — and none of it is built. The
 *  page says so plainly rather than showing an empty progress bar that implies
 *  a record exists. */
export function Training() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Training</h2>
        <p className="mt-1 text-sm text-slate-500">
          Business training modules for GDB applicants and borrowers.
        </p>
      </div>

      <Card className="border border-dashed border-slate-200 py-14 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-light text-brand-text">
          <TrainingIcon className="h-7 w-7" />
        </span>
        <p className="text-base font-semibold text-slate-700">Coming soon</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Your training modules and completion record will appear here once the programme's
          curriculum is available. Each person completes their own modules — in a cluster, the head
          cannot complete them on anyone else's behalf.
        </p>
      </Card>
    </div>
  );
}
