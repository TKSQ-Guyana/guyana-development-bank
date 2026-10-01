import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EidBoxes } from '../../components/EidBoxes';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EMPTY_EID, isCompleteEid } from '../../eid';
import { fo } from './api';
import type { ApplicantMatch } from './types';
import { ErrorLine } from './ui';

/** FO.S04 — find the applicant by e-ID. A partial name comes back and nothing
 *  else; the applicant's records open only once they allow it (FO.S05). */
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

  return (
    <div className="max-w-lg">
      <Link to="/field" className="text-sm font-medium text-brand hover:underline">
        ← Field desk
      </Link>
      <Card className="mt-3 space-y-4 p-6">
        <h2 className="text-xl font-bold text-slate-900">Find applicant</h2>
        <EidBoxes
          value={eid}
          onChange={(v) => {
            setEid(v);
            setMatch(null);
          }}
          disabled={busy}
        />
        {match && !match.registered && <p className="text-sm text-slate-500">No portal account holds this e-ID yet.</p>}
        {match?.registered && (
          <div className="rounded-md bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Name on the e-ID</p>
            <p className="text-sm font-semibold text-slate-900">{match.masked_name}</p>
          </div>
        )}
        {match?.is_you && <ErrorLine>This is your own e-ID.</ErrorLine>}
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="flex justify-end gap-2">
          {match?.registered && !match.is_you ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const c = await fo.askConsent({ eid: match.eid });
                  navigate(`/field/assist/${c.name}`);
                })
              }
            >
              Ask for access
            </Button>
          ) : (
            <Button
              disabled={busy || !isCompleteEid(eid)}
              onClick={() => void run(async () => setMatch(await fo.findApplicant(eid)))}
            >
              Find
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
