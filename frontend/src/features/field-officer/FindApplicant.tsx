import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EidBoxes } from '../../components/EidBoxes';
import { Button } from '../../components/ui/Button';
import { Card, CardLabel } from '../../components/ui/Card';
import { StepBar } from '../../components/ui/Stepper';
import { EMPTY_EID, isCompleteEid } from '../../eid';
import { fo } from './api';
import type { ApplicantMatch } from './types';
import { ASSIST_STEPS, ErrorLine, RailTitle } from './ui';

/** FO.S04 — step 1 of a new assisted application: find the applicant by e-ID.
 *  A partial name comes back and nothing else; their records open only once
 *  they allow it (step 2, AssistConsentPage). */
export function FindApplicant() {
  const navigate = useNavigate();
  const [eid, setEid] = useState(EMPTY_EID);
  const [match, setMatch] = useState<ApplicantMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const usable = Boolean(match?.registered && !match.is_you);

  return (
    <div className="space-y-4">
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Work queue
      </Link>

      <Card className="p-6">
        <StepBar steps={ASSIST_STEPS} current={0} />
      </Card>

      <Card className="space-y-4 p-6">
        <RailTitle>Find applicant</RailTitle>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <CardLabel>e-ID</CardLabel>
            <div className="mt-1.5">
              <EidBoxes
                value={eid}
                onChange={(v) => {
                  setEid(v);
                  setMatch(null);
                }}
                disabled={busy}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={busy || !isCompleteEid(eid)}
            onClick={() => void run(async () => setMatch(await fo.findApplicant(eid)))}
          >
            Look up
          </Button>
        </div>

        {match?.registered && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-4">
              <CardLabel>e-ID</CardLabel>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">{match.eid}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-4">
              <CardLabel>Name</CardLabel>
              <p className="mt-1 text-lg font-bold text-slate-900">{match.masked_name}</p>
            </div>
          </div>
        )}
        {match && !match.registered && <ErrorLine>No portal account for this e-ID.</ErrorLine>}
        {match?.is_you && <ErrorLine>This is your own e-ID.</ErrorLine>}
        {error && <ErrorLine>{error}</ErrorLine>}
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate('/field')}>
          Cancel
        </Button>
        <Button
          disabled={busy || !usable}
          onClick={() =>
            void run(async () => {
              const c = await fo.askConsent({ eid: match!.eid });
              navigate(`/field/assist/${c.name}`);
            })
          }
        >
          Ask for consent
        </Button>
      </div>
    </div>
  );
}
