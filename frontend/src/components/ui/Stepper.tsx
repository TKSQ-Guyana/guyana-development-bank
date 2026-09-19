import { LOAN_STAGES, type LoanStage } from '../../types';
import { CheckIcon } from './icons';

/** What each rung means in the applicant's own words. The label under a case
 *  comes from the server (`stage_label`) because it is specific to that case;
 *  these are the generic names of the rungs themselves. */
const STEP_NAMES: Record<LoanStage, string> = {
  Draft: 'Started',
  Review: 'Under review',
  Approved: 'Decision',
  Signing: 'Signing',
  Disbursed: 'Funds released',
  Rejected: 'Not approved',
};

interface StepperProps {
  stage: LoanStage;
  /** The server's sentence for this case — shown under the rail. */
  label?: string;
  compact?: boolean;
}

export function Stepper({ stage, label, compact = false }: StepperProps) {
  // A declined case is not standing on a rung, so it does not get a rail: it
  // gets the reason it left the ladder.
  if (stage === 'Rejected') {
    return (
      <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-rose-700">{STEP_NAMES.Rejected}</p>
        {label && <p className="mt-0.5 text-xs text-rose-600/80">{label}</p>}
      </div>
    );
  }

  const current = LOAN_STAGES.indexOf(stage);

  return (
    <div>
      <ol className={`flex items-start ${compact ? 'gap-1' : 'gap-2'}`}>
        {LOAN_STAGES.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const last = i === LOAN_STAGES.length - 1;
          return (
            <li key={step} className="flex flex-1 items-start">
              <div className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  {/* Left half of the connector, so the dot sits centred over
                      its own label rather than between two of them. */}
                  <span
                    className={`h-0.5 flex-1 rounded-full ${i === 0 ? 'bg-transparent' : done || active ? 'bg-brand' : 'bg-slate-200'}`}
                  />
                  <span
                    className={`flex flex-none items-center justify-center rounded-full transition-all ${
                      compact ? 'h-5 w-5' : 'h-7 w-7'
                    } ${
                      done
                        ? 'bg-brand text-white'
                        : active
                          ? 'bg-brand text-white ring-4 ring-brand/15'
                          : 'border-2 border-slate-200 bg-white text-slate-300'
                    }`}
                  >
                    {done ? (
                      <CheckIcon className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                    ) : (
                      <span className={`font-semibold ${compact ? 'text-[10px]' : 'text-xs'}`}>{i + 1}</span>
                    )}
                  </span>
                  <span
                    className={`h-0.5 flex-1 rounded-full ${last ? 'bg-transparent' : done ? 'bg-brand' : 'bg-slate-200'}`}
                  />
                </div>
                {!compact && (
                  <span
                    className={`mt-2 text-center text-[11px] leading-tight ${
                      active ? 'font-semibold text-brand-text' : done ? 'text-slate-500' : 'text-slate-400'
                    }`}
                  >
                    {STEP_NAMES[step]}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {label && (
        <p className={`text-slate-600 ${compact ? 'mt-2 text-xs' : 'mt-4 text-center text-sm font-medium'}`}>
          {label}
        </p>
      )}
    </div>
  );
}

/** The stage as a single pill, for table rows and card headers. */
export function StageBadge({ stage }: { stage: LoanStage }) {
  const tones: Record<LoanStage, string> = {
    Draft: 'bg-slate-100 text-slate-600',
    Review: 'bg-sky-50 text-sky-700',
    Approved: 'bg-brand-light text-brand-text',
    Signing: 'bg-amber-50 text-amber-700',
    Disbursed: 'bg-emerald-50 text-emerald-700',
    Rejected: 'bg-rose-50 text-rose-600',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[stage]}`}>
      {STEP_NAMES[stage]}
    </span>
  );
}
