/** Thin client for the Frappe/ERPNext REST surface.
 *
 * Every call is POST /api/method/<dotted.path> with a JSON body; auth is the
 * Frappe session cookie set by /api/method/login. Frappe wraps results in
 * { message: ... } and errors in _server_messages / exception.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    if (typeof d._server_messages === 'string') {
      try {
        const messages = JSON.parse(d._server_messages) as string[];
        const first = messages[0] ? (JSON.parse(messages[0]) as { message?: string }) : null;
        if (first?.message) return first.message.replace(/<[^>]+>/g, '');
      } catch {
        /* fall through */
      }
    }
    if (typeof d.message === 'string' && d.message) return d.message;
    if (typeof d.exception === 'string' && d.exception) {
      return d.exception.split(':').slice(1).join(':').trim() || d.exception;
    }
  }
  return fallback;
}

export async function call<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/method/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, `Request failed (${res.status})`), res.status);
  }
  // Frappe omits `message` entirely when a whitelisted method returns None
  if (data && typeof data === 'object' && !('message' in data)) return null as T;
  const d = data as { message?: T };
  return (d?.message ?? (data as T)) as T;
}

export const login = (usr: string, pwd: string) => call<unknown>('login', { usr, pwd });
export const logout = () => call<unknown>('logout');
