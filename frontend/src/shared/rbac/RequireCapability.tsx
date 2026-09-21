import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { canAny } from './index';
import type { Capability } from './capabilities.generated';

/**
 * Route guard keyed to capabilities rather than roles.
 *
 * Replaces the old `RequireUnderwriter`: a route declares the capability it
 * needs, so a new persona granted that capability reaches the route with no
 * change here. A user who lacks it is sent to their own portal home (which the
 * backend tells us) rather than to `/`, which for a Board member would be a
 * page they are not permitted to load at all.
 */
export function RequireCapability({
  anyOf,
  children,
}: {
  anyOf: Capability[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAny(user, ...anyOf)) return <Navigate to={user.portal_home} replace />;

  return <>{children}</>;
}
