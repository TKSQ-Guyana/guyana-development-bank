import { Badge } from '../../components/ui/Badge';
import { formatDate } from '../../utils';
import { mapLink } from './FieldTaskPage';
import { StatusBadge } from './StatusBadge';
import type { FieldTask } from './types';

const VERDICT_TONE = { Positive: 'success', Neutral: 'neutral', Negative: 'danger' } as const;

/** The field work on a case — what was asked and what the officer reported.
 *  Officer-observed evidence, shown beside (never mixed into) the applicant's
 *  own documents. Used on the Loan Officer's case and the officer's case view. */
export function FieldReports({ tasks, onCancel }: { tasks: FieldTask[]; onCancel?: (task: FieldTask) => void }) {
  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <h2 className="text-lg font-semibold text-slate-900">Field reports</h2>
      {!tasks.length && <p className="mt-2 text-sm text-slate-500">No field work asked for.</p>}
      <ul className="mt-2 divide-y divide-slate-100">
        {tasks.map((t) => (
          <li key={t.name} className="space-y-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                {t.kind} <StatusBadge status={t.status} />
              </p>
              {onCancel && (t.status === 'Open' || t.status === 'Accepted') && (
                <button type="button" onClick={() => onCancel(t)} className="text-xs font-medium text-rose-600 hover:underline">
                  Cancel
                </button>
              )}
            </div>
            <p className="text-sm text-slate-700">{t.instructions}</p>
            <p className="text-xs text-slate-500">
              asked {formatDate(t.requested_on)}
              {t.assigned_to_name && ` · ${t.assigned_to_name}`}
              {t.submitted_on && ` · reported ${formatDate(t.submitted_on)}`}
              {t.cancel_reason && ` · cancelled: ${t.cancel_reason}`}
            </p>

            {t.status === 'Submitted' && t.kind === 'Site Visit' && (
              <div className="space-y-2 rounded-md bg-slate-50 p-3">
                <ul className="space-y-1">
                  {t.checks.map((c) => (
                    <li key={c.item} className="flex justify-between gap-3 text-sm">
                      <span className="text-slate-600">{c.item}</span>
                      <span className="font-medium text-slate-900">{c.result || '—'}</span>
                    </li>
                  ))}
                </ul>
                {t.latitude != null && t.longitude != null && (
                  <a href={mapLink(t.latitude, t.longitude)} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand hover:underline">
                    Map pin {t.latitude}, {t.longitude}
                  </a>
                )}
                {t.photos.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {t.photos.map((p) => (
                      <li key={p.name}>
                        <a href={p.file_url} target="_blank" rel="noreferrer">
                          <img src={p.file_url} alt={p.file_name} className="aspect-square w-full rounded border border-slate-200 object-cover" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {t.status === 'Submitted' && t.kind === 'Reference Check' && (
              <ul className="space-y-1 rounded-md bg-slate-50 p-3">
                {t.reference_calls.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700">
                      {c.contact_name}
                      {c.relationship && <span className="text-slate-500"> · {c.relationship}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-500">{c.result}</span>
                      {c.verdict && <Badge tone={VERDICT_TONE[c.verdict]}>{c.verdict}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {t.status === 'Submitted' && t.findings && (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{t.findings}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
