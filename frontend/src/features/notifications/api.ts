/** The portal inbox, on Frappe's own Notification Log.
 *
 *  Reads go through Frappe's REST surface, which scopes rows to the reader
 *  (for_user); read-marking uses Frappe's own whitelisted methods. The server
 *  writes only type "Alert", with `link` set to the portal route to open.
 */

import { call, getList } from '../../api';

export interface AppNotification {
  name: string;
  subject: string;
  link: string | null;
  read: 0 | 1;
  creation: string;
}

const LOG = 'frappe.desk.doctype.notification_log.notification_log';

export const listNotifications = () =>
  getList<AppNotification>('Notification Log', {
    fields: ['name', 'subject', 'link', 'read', 'creation'],
    filters: [['type', '=', 'Alert']],
    orderBy: 'creation desc',
    limit: 20,
  });

export const markRead = (name: string) => call(`${LOG}.mark_as_read`, { docname: name });

export const markAllRead = () => call(`${LOG}.mark_all_as_read`);
