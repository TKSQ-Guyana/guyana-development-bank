import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon } from '../../components/ui/icons';
import { formatDate } from '../../utils';
import { listNotifications, markAllRead, markRead, type AppNotification } from './api';

// Slow on purpose: the inbox changes when somebody acts, not every second.
const POLL_MS = 60_000;

/** Header bell: unread count, and a panel that opens what each alert is about. */
export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    listNotifications()
      .then((rows) => {
        setItems(rows);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  // Refresh while the tab is visible, and whenever the window regains focus.
  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  // Close on a click outside, or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  const openItem = (n: AppNotification) => {
    setOpen(false);
    if (!n.read) {
      setItems((all) => all.map((x) => (x.name === n.name ? { ...x, read: 1 } : x)));
      markRead(n.name).catch(load);
    }
    if (n.link) navigate(n.link);
  };

  const readAll = () => {
    setItems((all) => all.map((x) => ({ ...x, read: 1 })));
    markAllRead().catch(load);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={readAll}
                className="text-xs font-semibold text-brand hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {failed ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              Could not load notifications.{' '}
              <button type="button" onClick={load} className="font-semibold text-brand hover:underline">
                Retry
              </button>
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.name}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 flex-none rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm ${n.read ? 'text-slate-600' : 'font-semibold text-slate-900'}`}>
                        {n.subject}
                      </span>
                      <span className="block text-xs text-slate-400">{formatDate(n.creation)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
