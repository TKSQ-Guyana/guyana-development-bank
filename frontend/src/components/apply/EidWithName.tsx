import { useEffect, useRef, useState } from 'react';
import { call } from '../../api';
import { EidBoxes } from '../EidBoxes';
import { isCompleteEid } from '../../eid';
import type { EidLookup } from '../../types';

/** An e-ID box that fills in the name once the number is complete.
 *
 *  The lookup answers a name only for an e-ID that already holds a portal
 *  account. An unknown number is not an error and must not read like one: a
 *  group inviting somebody who has never signed in is the ordinary case in a
 *  programme reaching people who are not online yet.
 *
 *  Lives here rather than in `cluster.tsx` because naming a person by e-ID is
 *  not a cluster question. Partners and shareholders are named exactly the
 *  same way, and were using the bare `EidBoxes` — so an applicant typed
 *  eleven digits and got no confirmation that they had named the right person.
 */
export function EidWithName({
  value,
  onChange,
  onResolved,
  disabled,
  /** Shown when the number resolves to nobody. The default speaks for an
   *  invitation; a declared partner is not invited anywhere, so that caller
   *  says something true of its own situation instead. */
  unknownNote = 'Not registered with GDB yet — the invitation waits for their first sign-in.',
}: {
  value: string;
  onChange: (next: string) => void;
  onResolved?: (found: EidLookup | null) => void;
  disabled?: boolean;
  unknownNote?: string;
}) {
  const [found, setFound] = useState<EidLookup | null>(null);
  const [looking, setLooking] = useState(false);
  // Guards a re-render from re-asking for a number already answered.
  const asked = useRef('');

  useEffect(() => {
    if (!isCompleteEid(value)) {
      asked.current = '';
      setFound(null);
      onResolved?.(null);
      return;
    }
    if (asked.current === value) return;
    asked.current = value;
    setLooking(true);
    call<EidLookup>('gdb_bank.api.lookup_eid', { eid: value })
      .then((r) => {
        setFound(r);
        onResolved?.(r);
      })
      .catch(() => {
        // A lookup that cannot run is not a reason to block a group from
        // naming somebody. The invitation goes out against the e-ID either way.
        setFound(null);
        onResolved?.(null);
      })
      .finally(() => setLooking(false));
    // onResolved is a fresh closure on every render; depending on it would
    // re-run this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-1">
      <EidBoxes value={value} onChange={onChange} disabled={disabled} />
      {looking && <p className="text-xs text-slate-400">Looking up this e-ID…</p>}
      {!looking && found?.registered && (
        <p className="text-xs font-semibold text-emerald-700">{found.name}</p>
      )}
      {!looking && found && !found.registered && (
        <p className="text-xs text-slate-500">{unknownNote}</p>
      )}
    </div>
  );
}
