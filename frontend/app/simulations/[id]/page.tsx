'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Clock, Play, Square, AlertTriangle, CheckCircle2, RotateCcw, ListTree, Code2, Layers, Info, Timer } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

const stateIcon: Record<string, React.ReactNode> = {
  running: <Play className="h-4 w-4 text-indigo-400 animate-pulse" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  failed: <AlertTriangle className="h-4 w-4 text-red-400" />,
  rolled_back: <RotateCcw className="h-4 w-4 text-amber-400" />,
  cancelled: <Square className="h-4 w-4 text-slate-400" />,
  pending: <Clock className="h-4 w-4 text-slate-400 animate-pulse" />,
};

type TabId = 'overview' | 'logs' | 'commands' | 'resources';

export default function SimulationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params.id);
  const { token, loading, user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    let t: NodeJS.Timeout;
    const terminalStates = ['completed', 'failed', 'cancelled', 'rolled_back'];

    const load = async () => {
      try {
        const d = await api.getSimulation(token, id);
        setData(d);
        // If the simulation reached a terminal state, stop polling
        if (d?.simulation && terminalStates.includes(d.simulation.state)) {
          console.log(`[Frontend] Simulation ${id} reached terminal state "${d.simulation.state}". Stopping poll.`);
          clearInterval(t);
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load');
      } finally {
        setBusy(false);
      }
    };
    void load();
    t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [token, id]);

  const sim = data?.simulation;
  const steps = data?.steps ?? [];
  const state = sim?.state ?? 'unknown';
  const stateVariant = state === 'completed' ? 'success' : state === 'failed' ? 'error' : state === 'rolled_back' ? 'warning' : state === 'running' ? 'default' : 'neutral';
  const canStop = user?.role === 'admin' || (user?.role === 'engineer' && sim?.createdById === user?.id);

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: Info },
    { id: 'logs', label: 'Execution Logs', icon: ListTree },
    { id: 'commands', label: 'Commands', icon: Code2 },
    { id: 'resources', label: 'Resources Affected', icon: Layers },
  ];

  if (busy && !data) {
    return (
      <AppShell header={<AppHeader title="Simulation Detail" subtitle="Loading..." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={true} />}>
        <div className="mx-auto max-w-6xl p-6"><Skeleton className="h-96 w-full" /></div>
      </AppShell>
    );
  }

  return (
    <AppShell header={<AppHeader title="Simulation Detail" subtitle={sim?.name ?? id.slice(0, 8)} userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={true} />}>
      <div className="mx-auto max-w-6xl space-y-6 animate-fade-in px-6 pb-12">
        {err ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {err}
          </div>
        ) : null}

        {/* State bar */}
        <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 p-4 rounded-xl shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 border border-slate-800">
               {stateIcon[state] ?? null}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-200">Simulation Status</h2>
                <Badge variant={stateVariant as any} className="text-[10px] uppercase font-bold py-0 h-4">{state}</Badge>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">Created {new Date(sim?.createdAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')} className="gap-1.5 border-slate-700 bg-slate-900/50">
              <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
            </Button>
            
            {sim?.manualRollback && sim?.isRollbackable && (
              <Button 
                variant="default" 
                size="sm" 
                disabled={rollingBack || state !== 'running'} 
                onClick={async () => {
                  if (!token) return;
                  setRollingBack(true);
                  try {
                    await api.rollbackSimulation(token, id);
                    // Reload data will be handled by the poll
                  } catch (e: any) {
                    setErr(e.message ?? 'Rollback failed');
                  } finally {
                    setRollingBack(false);
                  }
                }}
                className="gap-1.5 bg-amber-600 hover:bg-amber-500 border-0 text-white"
              >
                <RotateCcw className={cn("h-3.5 w-3.5", rollingBack && "animate-spin")} /> 
                {rollingBack ? 'Rolling back...' : 'Rollback'}
              </Button>
            )}

            <Dialog open={cancelOpen} onOpenChange={(v: boolean) => setCancelOpen(v)}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={!canStop || ['completed', 'failed', 'cancelled', 'rolled_back'].includes(state)} className="gap-1.5">
                  <Square className="h-3.5 w-3.5" /> Stop Run
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-950 border-slate-800">
                <form>
                  <DialogHeader>
                    <DialogTitle>Cancel active simulation?</DialogTitle>
                    <DialogDescription>This will immediately stop the work, execute any pending rollbacks, and record a partial failure state.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="mt-4">
                    <Button variant="outline" type="button" onClick={() => setCancelOpen(false)}>Continue running</Button>
                    <Button
                      variant="destructive"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        await api.stopSimulation(token, id);
                        setCancelOpen(false);
                      }}
                    >
                      Confirm Stop
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Custom Tabs */}
        <div className="flex border-b border-slate-800 gap-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 pb-3 text-sm font-medium transition-colors border-b-2 hover:text-slate-200",
                  active ? "border-primary text-primary" : "border-transparent text-slate-500"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="mt-4 min-h-[400px]">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="md:col-span-2 bg-slate-900/20 border-slate-800/60">
                <CardHeader>
                  <CardTitle className="text-base">Parameters & Target</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-y-4 text-sm">
                  <div className="text-slate-500">Failure Type</div>
                  <div className="text-slate-200 font-medium capitalize">{sim?.failureType?.replaceAll('_', ' ')}</div>
                  <div className="text-slate-500">Method</div>
                  <div className="text-slate-200 font-mono text-xs bg-slate-950/50 px-2 py-0.5 rounded w-fit">{data?.failureEvents?.[0]?.method ?? 'unknown'}</div>
                  <div className="text-slate-500">Namespace</div>
                  <div className="text-slate-200">{sim?.namespace}</div>
                  <div className="text-slate-500">Intensity / Duration</div>
                  <div className="text-slate-200 font-mono">{sim?.intensity ?? '30%'} / {sim?.durationSeconds}s</div>
                  <div className="text-slate-500">Safe Dry-Run</div>
                  <Badge variant={sim?.dryRun ? 'success' : 'warning'}>{sim?.dryRun ? 'Yes' : 'No'}</Badge>
                </CardContent>
              </Card>
              <Card className="bg-slate-900/20 border-slate-800/60">
                 <CardHeader>
                    <CardTitle className="text-base">Summary Report</CardTitle>
                 </CardHeader>
                 <CardContent className="space-y-4">
                    {!data?.report ? (
                       <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-950/30 rounded-lg border border-slate-800/40">
                          <Timer className="h-6 w-6 text-slate-700 mb-2" />
                          <p className="text-[11px] text-slate-500">Awaiting completion to generate report.</p>
                       </div>
                    ) : (
                       <div className="space-y-4">
                          <div className="flex justify-between items-end">
                             <span className="text-xs text-slate-500">Recovery Time</span>
                             <span className="text-lg font-bold text-indigo-400 font-mono">{data.report.recoveryTimeSeconds}s</span>
                          </div>
                          <div>
                             <span className="text-xs text-slate-500 mb-1 block">Final Result</span>
                             <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">
                                {data.report.result}
                             </div>
                          </div>
                       </div>
                    )}
                 </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
               {steps.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-20 bg-slate-900/10 rounded-xl border border-dashed border-slate-800">
                    <ListTree className="h-8 w-8 text-slate-700 mb-3" />
                    <p className="text-sm text-slate-500 font-medium">No execution steps logged yet.</p>
                 </div>
               ) : (
                 <div className="relative pl-8 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                    {steps.map((step: any, i: number) => (
                      <div key={step.id} className="relative">
                        <div className={cn(
                          "absolute -left-10 mt-1.5 h-6 w-6 rounded-full border-4 border-slate-950 bg-slate-800 flex items-center justify-center",
                          step.status === 'success' ? "bg-emerald-500" : step.status === 'failed' ? "bg-red-500" : "bg-indigo-500"
                        )}>
                          <div className="h-1.5 w-1.5 rounded-full bg-white" />
                        </div>
                        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-colors">
                           <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                 <Badge variant="default" className="bg-slate-800 text-[9px] uppercase tracking-tighter px-1.5">{step.stepType}</Badge>
                                 <h4 className="text-sm font-semibold text-slate-200">{step.name}</h4>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">{new Date(step.timestamp).toLocaleTimeString()} (+{step.durationMs || 0}ms)</span>
                           </div>
                           <p className="text-xs text-slate-400 mb-3">{step.message}</p>
                           {step.error && (
                             <div className="mt-2 text-[10px] font-mono text-red-400 bg-red-950/20 border border-red-900/30 p-2 rounded">
                                Error: {step.error}
                             </div>
                           )}
                           {step.command && (
                             <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-slate-500 bg-slate-950/50 p-1.5 rounded select-all cursor-copy">
                               <Code2 className="h-3 w-3" /> {step.command}
                             </div>
                           )}
                        </div>
                      </div>
                    ))}
                 </div>
               )}
            </div>
          )}

          {activeTab === 'commands' && (
            <Card className="bg-slate-900/20 border-slate-800/60">
               <CardHeader className="border-b border-slate-800 p-4">
                  <CardTitle className="text-sm">Command Audit Log</CardTitle>
                  <CardDescription className="text-xs text-slate-500 underline">Kubectl-equivalent instructions dispatched by the control plane.</CardDescription>
               </CardHeader>
               <CardContent className="p-0">
                  <div className="bg-slate-950/80 p-6 font-mono text-xs space-y-3 max-h-[600px] overflow-y-auto">
                    {steps.filter((s:any) => s.command).map((s:any, i:number) => (
                      <div key={s.id} className="flex gap-4 group">
                        <span className="text-slate-700 w-4 shrink-0">{i+1}</span>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                             <span className="text-slate-600"># {s.name} ({s.status})</span>
                             <span className="text-[10px] text-slate-800 opacity-0 group-hover:opacity-100 transition-opacity">{new Date(s.timestamp).toISOString()}</span>
                          </div>
                          <span className="text-emerald-500/80">$ {s.command}</span>
                        </div>
                      </div>
                    ))}
                    {steps.filter((s:any) => s.command).length === 0 && (
                       <div className="text-slate-600 italic">No low-level commands recorded for this execution.</div>
                    )}
                  </div>
               </CardContent>
            </Card>
          )}

          {activeTab === 'resources' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <Card className="bg-slate-900/20 border-slate-800/60">
                 <CardHeader>
                   <CardTitle className="text-sm">Identified Targets</CardTitle>
                   <CardDescription className="text-xs">Cluster resources directly mutated by this simulation.</CardDescription>
                 </CardHeader>
                 <CardContent>
                    <div className="space-y-2">
                       {Array.from(new Set(steps.map((s:any) => s.resourceName).filter(Boolean))).map((name: any) => {
                          const step = steps.find((s:any) => s.resourceName === name);
                          return (
                            <div key={name} className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-950/20">
                               <div className="flex flex-col">
                                  <span className="text-xs font-bold text-slate-300">{name}</span>
                                  <span className="text-[10px] text-slate-600 uppercase tracking-tight">{step.resourceType} in {step.namespace}</span>
                               </div>
                               <Badge variant="default" className="bg-slate-800 text-[9px]">Affected</Badge>
                            </div>
                          )
                       })}
                       {steps.filter((s:any) => s.resourceName).length === 0 && (
                          <p className="text-xs text-slate-500 italic text-center py-4">No specific resources recorded.</p>
                       )}
                    </div>
                 </CardContent>
               </Card>

               <Card className="bg-slate-900/20 border-slate-800/60">
                 <CardHeader>
                   <CardTitle className="text-sm">Propagation Data</CardTitle>
                   <CardDescription className="text-xs">Based on dependency graph analysis.</CardDescription>
                 </CardHeader>
                 <CardContent>
                    <div className="rounded-xl border border-indigo-500/10 bg-indigo-500/5 p-4 flex gap-4">
                       <Info className="h-5 w-5 text-indigo-400 shrink-0" />
                       <div className="space-y-1">
                          <p className="text-[12px] text-slate-400 leading-relaxed font-medium">
                             The simulator predicts that failing <span className="text-indigo-300">"{sim?.namespace}"</span> services may impact upstream consumers identified in your dependency map.
                          </p>
                          <p className="text-[11px] text-slate-500">Check the <button onClick={() => router.push('/dependencies')} className="text-indigo-400 underline">Dependencies</button> page for full architectural visibility.</p>
                       </div>
                    </div>
                 </CardContent>
               </Card>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
