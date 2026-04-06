'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Clock, Play, Square, AlertTriangle, CheckCircle2, RotateCcw,
  ListTree, Code2, Layers, Info, Timer, ShieldAlert, ShieldCheck, Loader2,
} from 'lucide-react';
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

// ─── State icon map ──────────────────────────────────────────────────────────
const stateIcon: Record<string, React.ReactNode> = {
  running: <Play className="h-4 w-4 text-indigo-400 animate-pulse" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  failed: <AlertTriangle className="h-4 w-4 text-red-400" />,
  rolled_back: <RotateCcw className="h-4 w-4 text-amber-400" />,
  cancelled: <Square className="h-4 w-4 text-slate-400" />,
  pending: <Clock className="h-4 w-4 text-slate-400 animate-pulse" />,
  rollback_pending: <Clock className="h-4 w-4 text-amber-400 animate-pulse" />,
  rolling_back: <RotateCcw className="h-4 w-4 text-amber-400 animate-spin" />,
  rollback_failed: <AlertTriangle className="h-4 w-4 text-red-400" />,
  partial_rollback: <ShieldAlert className="h-4 w-4 text-amber-400" />,
};

// ─── Step type display config ────────────────────────────────────────────────
const stepTypeConfig: Record<string, { dot: string; badge: string; label: string }> = {
  validation: { dot: 'bg-sky-500', badge: 'bg-sky-900/60 text-sky-300', label: 'Validation' },
  execution:  { dot: 'bg-indigo-500', badge: 'bg-indigo-900/60 text-indigo-300', label: 'Execution' },
  rollback:   { dot: 'bg-amber-500', badge: 'bg-amber-900/60 text-amber-300', label: 'Rollback' },
};

// ─── Rollback status helpers ─────────────────────────────────────────────────
function deriveRollbackStatus(recoveryActions: any[], sim: any): { label: string; variant: string; icon: React.ReactNode } {
  if (!recoveryActions?.length) {
    if (sim?.manualRollback && ['running', 'failure_active'].includes(sim?.state)) {
      return { label: 'Pending (manual)', variant: 'warning', icon: <Clock className="h-3.5 w-3.5" /> };
    }
    return { label: 'Not started', variant: 'neutral', icon: <Clock className="h-3.5 w-3.5" /> };
  }
  const latest = recoveryActions[recoveryActions.length - 1];
  if (!latest.completedAt) return { label: 'In progress', variant: 'default', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> };
  if (latest.success) return { label: 'Completed', variant: 'success', icon: <ShieldCheck className="h-3.5 w-3.5" /> };
  return { label: 'Failed', variant: 'error', icon: <ShieldAlert className="h-3.5 w-3.5" /> };
}

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
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    let t: NodeJS.Timeout;
    const terminalStates = ['completed', 'failed', 'cancelled', 'rolled_back', 'rollback_failed'];

    const load = async () => {
      try {
        const d = await api.getSimulation(token, id);
        setData(d);
        if (d?.simulation && terminalStates.includes(d.simulation.state)) {
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
  const steps: any[] = data?.steps ?? [];
  const recoveryActions: any[] = data?.recoveryActions ?? [];
  const state = sim?.state ?? 'unknown';
  const stateVariant = state === 'completed' ? 'success'
    : state === 'failed' || state === 'rollback_failed' ? 'error'
    : ['rolled_back', 'partial_rollback', 'rolling_back', 'rollback_pending'].includes(state) ? 'warning'
    : state === 'running' ? 'default'
    : 'neutral';
  const canStop = user?.role === 'admin' || (user?.role === 'engineer' && sim?.createdById === user?.id);
  const rbStatus = deriveRollbackStatus(recoveryActions, sim);

  // Partition steps
  const executionSteps = steps.filter((s: any) => s.stepType !== 'rollback');
  const rollbackSteps = steps.filter((s: any) => s.stepType === 'rollback');

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
                {sim?.manualRollback && (
                  <Badge variant="neutral" className="text-[10px] uppercase font-bold py-0 h-4 border-amber-500/30 text-amber-400 bg-amber-400/5">Manual Recovery</Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">Created {new Date(sim?.createdAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')} className="gap-1.5 border-slate-700 bg-slate-900/50">
              <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
            </Button>

            {sim?.isRollbackable && (
              <Button
                variant="default"
                size="sm"
                disabled={rollingBack}
                onClick={async () => {
                  if (!token) return;
                  setRollingBack(true);
                  setErr(null);
                  try {
                    await api.rollbackSimulation(token, id);
                  } catch (e: any) {
                    setErr(e.message ?? 'Rollback failed');
                  } finally {
                    setRollingBack(false);
                  }
                }}
                className="gap-1.5 bg-amber-600 hover:bg-amber-500 border-0 text-white"
              >
                <RotateCcw className={cn("h-3.5 w-3.5", rollingBack && "animate-spin")} />
                {rollingBack ? 'Rolling back...' : 'Manual Rollback'}
              </Button>
            )}

            <Dialog open={cancelOpen} onOpenChange={(v: boolean) => setCancelOpen(v)}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={!canStop || stopping || ['completed', 'failed', 'cancelled', 'rolled_back'].includes(state)} className="gap-1.5 border-red-500/30 hover:bg-red-500/20 bg-transparent text-red-400">
                  <Square className={cn("h-3.5 w-3.5", stopping && "animate-pulse")} /> {stopping ? 'Stopping...' : 'Stop Run'}
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
                      disabled={stopping}
                      onClick={async () => {
                        if (!token) return;
                        setStopping(true);
                        try {
                          await api.stopSimulation(token, id);
                          setData((prev: any) => ({ ...prev, simulation: { ...prev.simulation, state: 'cancelled' } }));
                          setCancelOpen(false);
                        } catch (e: any) {
                          setErr(e.message ?? 'Failed to stop');
                        } finally {
                          setStopping(false);
                        }
                      }}
                      className="gap-2"
                    >
                      {stopping ? <RotateCcw className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                      {stopping ? 'Stopping...' : 'Confirm Stop'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Tabs */}
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
                {tab.id === 'logs' && steps.length > 0 && (
                  <span className="ml-1 rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400">{steps.length}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="mt-4 min-h-[400px]">

          {/* ── Overview ──────────────────────────────────────────────── */}
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
                  {sim?.targetDeployment && (<><div className="text-slate-500">Deployment</div><div className="text-slate-200 font-mono text-xs">{sim.targetDeployment}</div></>)}
                  {sim?.targetService && (<><div className="text-slate-500">Service</div><div className="text-slate-200 font-mono text-xs">{sim.targetService}</div></>)}
                  {sim?.labelSelector && (<><div className="text-slate-500">Selector</div><div className="text-slate-200 font-mono text-xs">{sim.labelSelector}</div></>)}
                  <div className="text-slate-500">Intensity / Duration</div>
                  <div className="text-slate-200 font-mono">{sim?.intensity ?? '—'} / {sim?.durationSeconds}s</div>
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
                        <span className="text-lg font-bold text-indigo-400 font-mono">{data.report.recoveryTimeSeconds ?? 0}s</span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 mb-1 block">Final Result</span>
                        <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">{data.report.result}</div>
                      </div>
                      {data.report.errors && (
                        <div>
                          <span className="text-xs text-red-400 mb-1 block">Report Errors</span>
                          <div className="rounded border border-red-900/30 bg-red-950/20 p-2 text-xs font-mono text-red-300 break-all">{data.report.errors}</div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Rollback Status Panel */}
              <Card className="md:col-span-3 bg-slate-900/20 border-slate-800/60">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-slate-500" />
                    Rollback Status
                    <Badge variant={rbStatus.variant as any} className="ml-auto text-[10px] gap-1 flex items-center">
                      {rbStatus.icon} {rbStatus.label}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recoveryActions.length === 0 ? (
                    <p className="text-xs text-slate-500 italic text-center py-4">
                      {sim?.manualRollback
                        ? 'Manual rollback mode — waiting for user action.'
                        : 'No rollback actions recorded yet.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {recoveryActions.map((action: any) => (
                        <div key={action.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/20 text-sm">
                          <div className="text-slate-300 text-xs">{action.description}</div>
                          <div className="flex items-center gap-2">
                            {action.completedAt ? (
                              action.success
                                ? <Badge variant="success" className="text-[10px]">Completed</Badge>
                                : <Badge variant="error" className="text-[10px]">Failed</Badge>
                            ) : (
                              <Badge variant="default" className="text-[10px]">In progress</Badge>
                            )}
                            {action.errorMessage && (
                              <span className="text-[10px] text-red-400 font-mono truncate max-w-[200px]" title={action.errorMessage}>{action.errorMessage}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Rollback step count summary */}
                  {rollbackSteps.length > 0 && (
                    <p className="text-[11px] text-slate-600">
                      {rollbackSteps.filter((s: any) => s.status === 'success').length}/{rollbackSteps.length} rollback step(s) succeeded.{' '}
                      <button className="underline text-indigo-500" onClick={() => setActiveTab('logs')}>View in Logs</button>
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Debug / Parameter Resolution panel */}
              <Card className="md:col-span-3 bg-slate-900/20 border-slate-800/60">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-slate-500" /> Debug & Parameter Resolution
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                    {/* Submitted / Resolved params */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <span className="text-slate-400 font-medium">Input Source</span>
                        <span className="text-slate-400 font-medium text-right">Resolved Value</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Method ID</span>
                        <span className="text-slate-200 font-mono text-xs">{data?.failureEvents?.[0]?.method ?? 'unknown'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Duration</span>
                        <span className="text-slate-200 font-mono text-xs">{sim?.durationSeconds}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Intensity Context</span>
                        <span className="text-slate-200 font-mono text-xs">
                          {sim?.intensity ? (
                            <Badge variant="neutral" className="bg-slate-800 text-slate-300 font-mono text-[10px]">{sim.intensity}</Badge>
                          ) : <span className="text-slate-600">null</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Dry Run</span>
                        <span className="text-slate-200 font-mono text-xs">{String(sim?.dryRun)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Manual Rollback</span>
                        <span className="text-slate-200 font-mono text-xs">{String(sim?.manualRollback)}</span>
                      </div>
                    </div>

                    {/* Target resolution */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <span className="text-slate-400 font-medium">Target Context</span>
                        <span className="text-slate-400 font-medium text-right">State</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Namespace</span>
                        <span className="text-slate-200 font-mono text-xs max-w-[200px] truncate">{sim?.namespace}</span>
                      </div>
                      {sim?.targetDeployment && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Deployment</span>
                          <span className="text-slate-200 font-mono text-xs max-w-[200px] truncate">{sim.targetDeployment}</span>
                        </div>
                      )}
                      {sim?.targetService && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Service</span>
                          <span className="text-slate-200 font-mono text-xs max-w-[200px] truncate">{sim.targetService}</span>
                        </div>
                      )}
                      {sim?.labelSelector && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Selector</span>
                          <span className="text-slate-200 font-mono text-xs max-w-[200px] truncate">{sim.labelSelector}</span>
                        </div>
                      )}
                      {/* Validation result derived from steps */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                        <span className="text-slate-500">Validation Result</span>
                        {steps.some((s: any) => s.stepType === 'validation' && s.status === 'failed') ? (
                          <Badge variant="error" className="text-[10px] gap-1"><AlertTriangle className="h-2.5 w-2.5" />Failed</Badge>
                        ) : steps.some((s: any) => s.stepType === 'validation' && s.status === 'success') ? (
                          <Badge variant="success" className="text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Passed</Badge>
                        ) : (
                          <Badge variant="neutral" className="text-[10px]">Pending</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Normalization defaults applied (from step messages) */}
                  {(() => {
                    const normStep = steps.find((s: any) => s.name === 'Parameters Normalized');
                    return normStep ? (
                      <div className="rounded-lg border border-slate-700/30 bg-slate-950/30 p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Normalization Details</p>
                        <p className="text-[11px] font-mono text-slate-400">{normStep.message}</p>
                      </div>
                    ) : null;
                  })()}

                  {/* Error panel */}
                  {(steps.some((s: any) => s.error) || data?.failureEvents?.some((e: any) => e.errorMessage)) && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                      <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3" /> Execution / Validation / Rollback Errors
                      </h4>
                      <ul className="list-disc pl-4 space-y-1">
                        {steps.filter((s: any) => s.error).map((s: any) => (
                          <li key={s.id} className="text-[11px] font-mono text-red-300">
                            <span className="text-slate-500">[{s.stepType}:{s.name}]</span> {s.error}
                          </li>
                        ))}
                        {data?.failureEvents?.filter((e: any) => e.errorMessage).map((e: any) => (
                          <li key={e.id} className="text-[11px] font-mono text-red-300">
                            <span className="text-slate-500">[Engine]</span> {e.errorMessage}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Execution Logs ────────────────────────────────────────── */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-slate-900/10 rounded-xl border border-dashed border-slate-800">
                  <ListTree className="h-8 w-8 text-slate-700 mb-3" />
                  <p className="text-sm text-slate-500 font-medium">No execution steps logged yet.</p>
                </div>
              ) : (
                <div className="relative pl-8 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                  {steps.map((step: any) => {
                    const tc = stepTypeConfig[step.stepType] ?? stepTypeConfig.execution;
                    const isFailed = step.status === 'failed';
                    const isSuccess = step.status === 'success';
                    return (
                      <div key={step.id} className="relative">
                        <div className={cn(
                          "absolute -left-10 mt-1.5 h-6 w-6 rounded-full border-4 border-slate-950 flex items-center justify-center",
                          isFailed ? 'bg-red-500' : isSuccess ? tc.dot : 'bg-slate-700'
                        )}>
                          <div className="h-1.5 w-1.5 rounded-full bg-white" />
                        </div>
                        <div className={cn(
                          "bg-slate-900/40 border rounded-xl p-4 shadow-sm hover:border-slate-700 transition-colors",
                          step.stepType === 'rollback' ? 'border-amber-900/40' : 'border-slate-800/60'
                        )}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", tc.badge)}>
                                {tc.label}
                              </span>
                              <h4 className="text-sm font-semibold text-slate-200">{step.name}</h4>
                              {isFailed && <Badge variant="error" className="text-[9px] py-0 h-4">Failed</Badge>}
                              {isSuccess && step.stepType === 'rollback' && <Badge variant="warning" className="text-[9px] py-0 h-4">Rolled Back</Badge>}
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">{new Date(step.timestamp).toLocaleTimeString()} (+{step.durationMs || 0}ms)</span>
                          </div>
                          {step.message && <p className="text-xs text-slate-400 mb-2">{step.message}</p>}
                          {step.error && (
                            <div className="mt-2 text-[10px] font-mono text-red-400 bg-red-950/20 border border-red-900/30 p-2 rounded break-all">
                              Error: {step.error}
                            </div>
                          )}
                          {step.command && (
                            <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-slate-500 bg-slate-950/50 p-1.5 rounded select-all cursor-copy">
                              <Code2 className="h-3 w-3 shrink-0" /> {step.command}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Commands ──────────────────────────────────────────────── */}
          {activeTab === 'commands' && (
            <Card className="bg-slate-900/20 border-slate-800/60">
              <CardHeader className="border-b border-slate-800 p-4">
                <CardTitle className="text-sm">Command Audit Log</CardTitle>
                <CardDescription className="text-xs text-slate-500">kubectl-equivalent instructions dispatched by the control plane, in execution order.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="bg-slate-950/80 p-6 font-mono text-xs space-y-6 max-h-[600px] overflow-y-auto">
                  {/* Execution commands */}
                  {executionSteps.filter((s: any) => s.command).length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-indigo-500 mb-3 flex items-center gap-2">
                        <Play className="h-3 w-3" /> Execution
                      </div>
                      <div className="space-y-3">
                        {executionSteps.filter((s: any) => s.command).map((s: any, i: number) => (
                          <div key={s.id} className="flex gap-4 group">
                            <span className="text-slate-700 w-4 shrink-0">{i + 1}</span>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-600"># {s.name} ({s.status})</span>
                                <span className="text-[10px] text-slate-800 opacity-0 group-hover:opacity-100 transition-opacity">{new Date(s.timestamp).toISOString()}</span>
                              </div>
                              <span className="text-emerald-500/80">$ {s.command}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rollback commands */}
                  {rollbackSteps.filter((s: any) => s.command).length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-amber-500 mb-3 flex items-center gap-2">
                        <RotateCcw className="h-3 w-3" /> Rollback
                      </div>
                      <div className="space-y-3">
                        {rollbackSteps.filter((s: any) => s.command).map((s: any, i: number) => (
                          <div key={s.id} className="flex gap-4 group">
                            <span className="text-slate-700 w-4 shrink-0">{i + 1}</span>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-amber-900"># {s.name} ({s.status})</span>
                              </div>
                              <span className="text-amber-500/80">$ {s.command}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {executionSteps.filter((s: any) => s.command).length === 0 && rollbackSteps.filter((s: any) => s.command).length === 0 && (
                    <div className="text-slate-600 italic">No low-level commands recorded for this execution.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Resources Affected ────────────────────────────────────── */}
          {activeTab === 'resources' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-slate-900/20 border-slate-800/60">
                <CardHeader>
                  <CardTitle className="text-sm">Identified Targets</CardTitle>
                  <CardDescription className="text-xs">Cluster resources directly mutated by this simulation.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Array.from(new Set(steps.map((s: any) => s.resourceName).filter(Boolean))).map((name: any) => {
                      const step = steps.find((s: any) => s.resourceName === name);
                      const isRollback = step?.stepType === 'rollback';
                      return (
                        <div key={name} className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-950/20">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-300">{name}</span>
                            <span className="text-[10px] text-slate-600 uppercase tracking-tight">{step?.resourceType} in {step?.namespace}</span>
                          </div>
                          <Badge variant={isRollback ? 'warning' : 'default'} className="bg-slate-800 text-[9px]">
                            {isRollback ? 'Rolled Back' : 'Affected'}
                          </Badge>
                        </div>
                      );
                    })}
                    {steps.filter((s: any) => s.resourceName).length === 0 && (
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
