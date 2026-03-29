'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Clock, Play, Square, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

const stateIcon: Record<string, React.ReactNode> = {
  running: <Play className="h-4 w-4 text-indigo-400 animate-pulse-soft" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  failed: <AlertTriangle className="h-4 w-4 text-red-400" />,
  rolled_back: <RotateCcw className="h-4 w-4 text-amber-400" />,
  cancelled: <Square className="h-4 w-4 text-slate-400" />,
  pending: <Clock className="h-4 w-4 text-slate-400 animate-pulse-soft" />,
};

export default function SimulationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params.id);
  const { token, loading, user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        setBusy(true);
        const d = await api.getSimulation(token, id);
        setData(d);
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load');
      } finally {
        setBusy(false);
      }
    };
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [token, id]);

  const state = data?.simulation?.state ?? 'unknown';
  const stateVariant = state === 'completed' ? 'success' : state === 'failed' ? 'error' : state === 'rolled_back' ? 'warning' : state === 'running' ? 'default' : 'neutral';
  const canStop = user?.role === 'admin' || (user?.role === 'engineer' && data?.simulation?.createdById === user?.id);

  return (
    <AppShell header={<AppHeader title="Simulation Detail" subtitle={id.slice(0, 16) + '…'} userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
        {err ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {err}
          </div>
        ) : null}

        {/* State bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {stateIcon[state] ?? null}
            <Badge variant={stateVariant as any} className="text-sm py-1 px-3">{state}</Badge>
            {state === 'running' && <span className="text-[12px] text-slate-500">Refreshes every 4s</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')} className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
            </Button>
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={!canStop || ['completed', 'failed', 'cancelled', 'rolled_back'].includes(state)}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel simulation</DialogTitle>
                  <DialogDescription>This will stop the active run, trigger rollback, and move state to cancelled.</DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (!token) return;
                      await api.stopSimulation(token, id);
                      setData((prev: any) => ({ ...prev, simulation: { ...prev?.simulation, state: 'cancelled' } }));
                      setCancelOpen(false);
                    }}
                  >
                    Confirm stop
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Main details */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Live state and simulation parameters.</CardDescription>
            </CardHeader>
            <CardContent>
              {busy ? <Skeleton className="h-40 w-full" /> : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-slate-500">Name</div>
                  <div className="text-slate-200 font-medium">{data?.simulation?.name}</div>
                  <div className="text-slate-500">Failure type</div>
                  <div className="text-slate-200">{data?.simulation?.failureType?.replaceAll?.('_', ' ')}</div>
                  <div className="text-slate-500">Namespace</div>
                  <div className="font-mono text-[13px] text-slate-300">{data?.simulation?.namespace}</div>
                  <div className="text-slate-500">Duration</div>
                  <div className="font-mono text-[13px] text-slate-300">{data?.simulation?.durationSeconds}s</div>
                  <div className="text-slate-500">Dry run</div>
                  <div>{data?.simulation?.dryRun ? <Badge variant="default">Yes</Badge> : <Badge variant="warning">No</Badge>}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>Failure + recovery records stored by the backend.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="text-[13px] font-medium text-slate-300 mb-2">Failure Events</div>
                {busy ? <Skeleton className="h-20 w-full" /> : (data?.failureEvents ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800/60 py-4 text-center text-[13px] text-slate-500">No events recorded</div>
                ) : (
                  <div className="space-y-2">
                    {(data?.failureEvents ?? []).map((e: any) => (
                      <div key={e.id} className="rounded-lg border border-slate-800/40 bg-slate-800/20 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-200">{e.method}</span>
                          <Badge variant={e.state === 'completed' ? 'success' : e.state === 'failed' ? 'error' : 'neutral'} >{e.state}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[13px] font-medium text-slate-300 mb-2">Recovery Actions</div>
                {busy ? <Skeleton className="h-20 w-full" /> : (data?.recoveryActions ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800/60 py-4 text-center text-[13px] text-slate-500">No recovery actions</div>
                ) : (
                  <div className="space-y-2">
                    {(data?.recoveryActions ?? []).map((a: any) => (
                      <div key={a.id} className="rounded-lg border border-slate-800/40 bg-slate-800/20 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-200">{a.description}</span>
                          <Badge variant={a.success ? 'success' : 'error'}>{a.success ? 'Success' : 'Failed'}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Report</CardTitle>
              <CardDescription>Generated after completion/rollback.</CardDescription>
            </CardHeader>
            <CardContent>
              {busy ? <Skeleton className="h-20 w-full" /> : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-slate-500">Result</div>
                  <div className="text-slate-200 font-medium">{data?.report?.result ?? '—'}</div>
                  <div className="text-slate-500">Recovery time</div>
                  <div className="font-mono text-[13px] text-slate-300">{data?.report?.recoveryTimeSeconds ?? 0}s</div>
                  <div className="text-slate-500">Errors</div>
                  <div className="text-slate-400 text-[13px]">{data?.report?.errors ?? 'none'}</div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Observability</CardTitle>
              <CardDescription>Live references for debugging and monitoring.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="rounded-lg border border-slate-800/40 bg-slate-800/20 p-3 text-slate-400">
                Logs panel available in Grafana/Loki.
              </div>
              <div className="rounded-lg border border-slate-800/40 bg-slate-800/20 p-3 text-slate-400">
                Metrics panel available in Prometheus/Grafana.
              </div>
              {state === 'cancelled' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200 text-[13px]">
                  This simulation has been cancelled.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
