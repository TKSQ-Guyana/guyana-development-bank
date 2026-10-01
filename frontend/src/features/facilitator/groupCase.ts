import type { Cluster, ClusterCase } from '../../types';

/** The group's own application (filed in its head's name): the live one if
 *  there is one, otherwise the most recent — which can only be a rejection. */
export function groupCase(c: Cluster): ClusterCase | undefined {
  const own = c.applications.filter((a) => a.shared);
  return own.find((a) => a.status !== 'Rejected') ?? own[own.length - 1];
}
