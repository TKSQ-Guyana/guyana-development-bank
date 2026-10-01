import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { setActing } from '../../api';
import { Apply } from '../../pages/Apply';
import { fo } from './api';
import type { AssistConsent } from './types';
import { ErrorLine } from './ui';

/** FO.S06 — the applicant's own application form, filled by the officer with
 *  the applicant present. Every applicant call the form makes carries this
 *  consent (api.setActing), so the server works on the applicant's records and
 *  refuses the moment their consent no longer holds. */
export function AssistedApply() {
  const { consent = '' } = useParams<{ consent: string }>();
  const [c, setC] = useState<AssistConsent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActing(consent);
    fo.consent(consent)
      .then(setC)
      .catch((err: Error) => setError(err.message));
    return () => setActing(null);
  }, [consent]);

  if (error) return <ErrorLine>{error}</ErrorLine>;
  if (!c) return <p className="text-slate-500">Loading…</p>;
  if (c.status !== 'Granted') return <Navigate to={`/field/assist/${consent}`} replace />;

  return (
    <Apply
      assist={{
        consent,
        applicantName: c.applicant_name,
        applicantEid: c.applicant_eid,
        base: `/field/assist/${consent}/apply`,
        home: `/field/assist/${consent}`,
      }}
    />
  );
}
