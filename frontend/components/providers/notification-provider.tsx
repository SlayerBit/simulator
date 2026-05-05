'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';
import type { UiNotification } from '@/types';
import { useAuth } from '@/hooks/useAuth';

type Ctx = {
  notifications: UiNotification[];
  unread: number;
  markAllRead: () => void;
};

const NotificationContext = createContext<Ctx>({
  notifications: [],
  unread: 0,
  markAllRead: () => {},
});

function routeFor(n: UiNotification): string | null {
  if (n.type === 'agent1_triggered' && n.simulation_id) return `/simulations/${n.simulation_id}`;
  if ((n.type === 'runbook_generated' || n.type === 'runbook_sent_redis') && n.runbook_id) return `/runbooks/${n.runbook_id}`;
  if (n.type === 'agent2_runbook_received' || n.type === 'agent2_executed') return '/agent-activity';
  if (n.type === 'recovery_successful' && n.simulation_id) return `/simulations/${n.simulation_id}`;
  return null;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<UiNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<UiNotification[]>([]);
  const known = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getNotifications(token);
        if (!alive) return;
        const rows = (res.notifications ?? []) as UiNotification[];
        setNotifications(rows);
        const fresh = rows.filter((n) => !known.current.has(n.id)).slice(0, 4);
        if (fresh.length > 0) {
          setToasts((prev) => [...fresh, ...prev].slice(0, 5));
          for (const n of fresh) {
            known.current.add(n.id);
            setTimeout(() => {
              setToasts((prev) => prev.filter((x) => x.id !== n.id));
            }, 5000);
          }
        }
      } catch {}
    };
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  const unread = useMemo(() => notifications.filter((n) => !readIds.has(n.id)).length, [notifications, readIds]);

  const markAllRead = () => setReadIds(new Set(notifications.map((n) => n.id)));

  const badgeClass = (status: UiNotification['status']) =>
    status === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10'
      : status === 'error'
        ? 'border-red-500/40 bg-red-500/10'
        : status === 'warning'
          ? 'border-yellow-500/40 bg-yellow-500/10'
          : 'border-sky-500/40 bg-sky-500/10';

  return (
    <NotificationContext.Provider value={{ notifications, unread, markAllRead }}>
      {children}
      <div className="fixed right-4 top-20 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              const to = routeFor(n);
              if (to) router.push(to);
              setToasts((prev) => prev.filter((x) => x.id !== n.id));
            }}
            className={`w-full rounded-lg border p-3 text-left backdrop-blur-sm transition hover:brightness-110 ${badgeClass(n.status)}`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{n.title}</p>
              <span className="text-[11px] text-muted-foreground">{new Date(n.timestamp).toLocaleTimeString()}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              sim: {n.simulation_id ?? 'n/a'} {n.runbook_id ? `| runbook: ${n.runbook_id}` : ''}
            </p>
          </button>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}

