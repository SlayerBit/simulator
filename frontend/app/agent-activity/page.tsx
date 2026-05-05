'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Code2, RefreshCcw, ActivitySquare } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { Agent2LogEntry } from '@/types';

function statusVariant(status: string) {
  const s = status.toLowerCase();
  if (s === 'success') return 'success';
  if (s === 'failed') return 'error';
  return 'neutral';
}

function eventLabel(e: string) {
  const map: Record<string, string> = {
    runbook_received: 'Runbook Received',
    runbook_parsed: 'Parsed Commands',
    command_execution_started: 'Executing Command',
    command_execution_success: 'Command Executed',
    command_execution_failed: 'Command Failed',
    runbook_completed: 'Execution Result',
  };
  return map[e] ?? e.replaceAll('_', ' ');
}

export default function AgentActivityPage() {
  const { token, loading, user, logout } = useAuth();
  const [logs, setLogs] = useState<Agent2LogEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const grouped = useMemo(() => {
    // Already newest-first from the API; keep as-is.
    return logs;
  }, [logs]);

  async function load() {
    if (!token) return;
    try {
      const res = await api.getAgent2Logs(token);
      setLogs((res.logs ?? []) as any);
      setErr(res.warning ? `Warning: ${res.warning}` : null);
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to fetch Agent 2 logs');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!loading && !token) {
    // useAuth already redirects on most pages; keep a safe blank shell here.
    return null;
  }

  return (
    <AppShell
      header={
        <AppHeader
          title="Agent Activity"
          subtitle="Real-time execution timeline from Agent 2."
          userLabel={user?.role ?? 'user'}
          onLogout={logout}
          canCreate={user?.role !== 'viewer'}
        />
      }
    >
      <div className="mx-auto max-w-7xl space-y-4 animate-fade-in px-6 pb-12">
        <Card className="bg-slate-900/20 border-slate-800/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <ActivitySquare className="h-4 w-4 text-slate-400" />
              <CardTitle className="text-base">Execution Timeline</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] text-slate-500">
                {lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : '—'}
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5">
                <RefreshCcw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {err ? (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {err}
              </div>
            ) : null}

            {busy ? (
              <Skeleton className="h-64 w-full" />
            ) : grouped.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
                <p className="text-sm font-medium text-slate-400">No Agent 2 activity yet</p>
                <p className="mt-1 text-[13px] text-slate-500">
                  When a runbook is received or a command executes, it will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="relative pl-8 space-y-5 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {grouped.map((l, idx) => {
                  const isFailed = l.status === 'failed';
                  const dot = isFailed ? 'bg-red-500' : l.status === 'success' ? 'bg-emerald-500' : 'bg-slate-600';
                  return (
                    <div key={`${l.timestamp}-${idx}`} className="relative">
                      <div
                        className={cn(
                          'absolute -left-10 mt-1.5 h-6 w-6 rounded-full border-4 border-slate-950 flex items-center justify-center',
                          dot
                        )}
                      >
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>

                      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 hover:border-slate-700 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="neutral" className="text-[10px] uppercase font-bold py-0 h-4">
                                {eventLabel(l.event)}
                              </Badge>
                              <Badge variant={statusVariant(l.status) as any} className="text-[10px] uppercase font-bold py-0 h-4">
                                {l.status}
                              </Badge>
                              <span className="text-[11px] text-slate-500">
                                Runbook <span className="font-mono text-slate-300">{l.runbook_id}</span>
                              </span>
                              <span className="text-[11px] text-slate-600">·</span>
                              <span className="text-[11px] text-slate-500">
                                Incident <span className="text-slate-300">{l.incident_type}</span>
                              </span>
                              {l.action ? (
                                <>
                                  <span className="text-[11px] text-slate-600">·</span>
                                  <span className="text-[11px] text-slate-500">
                                    Action <span className="font-mono text-slate-300">{l.action}</span>
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="shrink-0 text-[10px] text-slate-500 font-mono">
                            {new Date(l.timestamp).toLocaleTimeString()}
                          </div>
                        </div>

                        {/* Parsed / executed kubectl command highlight */}
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-[11px] font-mono text-slate-200">
                          <Code2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                          <div className="break-all select-all">{l.command}</div>
                        </div>

                        {l.error ? (
                          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[11px] font-mono text-red-300 break-all">
                            {l.error}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

