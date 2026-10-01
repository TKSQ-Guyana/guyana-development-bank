/** The platform administrator's console, over gdb_bank.platform_admin.
 *
 *  Every rule — which roles are grantable, whose account may be touched, that
 *  a reason is required, that a secret is never returned — is enforced by the
 *  server. This client only asks. */

import { call } from '../../api';
import type {
  AccessHistoryPage,
  AccountDetail,
  AccountKind,
  AccountPage,
  ChangeResult,
  CreateStaffResult,
  IntegrationGroup,
  IntegrationTest,
  ResetPasswordResult,
  SystemHealth,
} from './types';

const M = 'gdb_bank.platform_admin';

export const listAccounts = (kind: AccountKind, search: string, start = 0) =>
  call<AccountPage>(`${M}.list_users`, { kind, search: search || undefined, start, page_length: 50 });

export const getAccount = (user: string) => call<AccountDetail>(`${M}.get_user`, { user });

export const createStaffAccount = (args: {
  full_name: string;
  email: string;
  eid?: string;
  region?: string;
  roles: string[];
  reason: string;
}) => call<CreateStaffResult>(`${M}.create_staff_user`, args);

export const setAccountRegion = (user: string, region: string, reason: string) =>
  call<ChangeResult>(`${M}.set_user_region`, { user, region, reason });

export const setAccountRoles = (user: string, roles: string[], reason: string) =>
  call<ChangeResult>(`${M}.set_user_roles`, { user, roles, reason });

export const setAccountEnabled = (user: string, enabled: boolean, reason: string) =>
  call<ChangeResult>(`${M}.set_user_enabled`, { user, enabled: enabled ? 1 : 0, reason });

export const resetPassword = (user: string, reason: string) =>
  call<ResetPasswordResult>(`${M}.reset_password`, { user, reason });

export const accessHistory = (start = 0, user?: string) =>
  call<AccessHistoryPage>(`${M}.access_history`, { start, page_length: 50, user });

export const systemHealth = () => call<SystemHealth>(`${M}.system_health`);

export const integrationSettings = () => call<IntegrationGroup[]>(`${M}.integration_settings`);

export const saveIntegrationSettings = (group: string, values: Record<string, string>, reason: string) =>
  call<IntegrationGroup[]>(`${M}.save_integration_settings`, { group, values, reason });

export const testIntegration = (group: string, values?: Record<string, string>) =>
  call<IntegrationTest>(`${M}.test_integration`, { group, values });
