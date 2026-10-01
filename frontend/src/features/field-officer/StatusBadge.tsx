import { Badge } from '../../components/ui/Badge';

const DONE = new Set(['Helped remotely', 'Application started', 'Submitted', 'Granted', 'In progress']);
const WAITING = new Set(['Waiting', 'Open', 'Pending', 'Waiting for consent', 'Waiting for applicant', 'Visit booked']);
const STOPPED = new Set(["Couldn't reach", 'Declined', 'Cancelled', 'Expired']);

/** One pill for every field-operations status, in the kit's tones. */
export function StatusBadge({ status }: { status: string }) {
  const tone = DONE.has(status)
    ? 'success'
    : WAITING.has(status)
      ? 'warning'
      : STOPPED.has(status)
        ? 'danger'
        : status === 'Accepted'
          ? 'brand'
          : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}
