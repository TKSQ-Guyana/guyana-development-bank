import { ProfileIcon } from '../../components/ui/icons';
import { Panel, PageHeader } from './ui';

/** The citizens who hold a portal account. Nothing is listed until the
 *  server endpoint behind it exists — no stand-in rows in the meantime. */
export function ApplicantsListPage() {
  return (
    <>
      <PageHeader
        title="Applicants List"
        lede="Citizens who have opened a portal account with their e-ID."
      />
      <Panel title="Applicants" icon={<ProfileIcon />}>
        <p className="text-sm text-slate-500">No applicants to show yet.</p>
      </Panel>
    </>
  );
}
