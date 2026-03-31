'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, Zap } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

const failureTypes = [
  'pod_crash',
  'service_unavailability',
  'database_connection_failure',
  'cache_unavailability',
  'network_latency',
  'packet_loss',
  'cpu_saturation',
  'memory_pressure',
  'disk_pressure',
  'deployment_misconfiguration',
  'autoscaling_failure',
  'failing_health_probes',
  'ingress_misrouting',
] as const;

export default function NewSimulationPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [name, setName] = useState('');
  const [failureType, setFailureType] = useState<(typeof failureTypes)[number]>('pod_crash');
  const [method, setMethod] = useState('delete-pods');
  const [namespace, setNamespace] = useState('simulator');
  const [deploymentName, setDeploymentName] = useState('');
  const [labelSelector, setLabelSelector] = useState('app=backend');
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [intensityPercent, setIntensityPercent] = useState<number | undefined>(undefined);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);
  const [packetLossPercent, setPacketLossPercent] = useState<number | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  const preview = useMemo(() => {
    const target: any = { namespace };
    if (deploymentName) target.deploymentName = deploymentName;
    if (labelSelector) target.labelSelector = labelSelector;
    const risk = dryRun ? 'low' : durationSeconds > 300 || (intensityPercent ?? 0) > 75 ? 'high' : 'medium';
    return { failureType, method, target, durationSeconds, intensityPercent, latencyMs, packetLossPercent, risk, dryRun };
  }, [namespace, deploymentName, labelSelector, failureType, method, durationSeconds, intensityPercent, latencyMs, packetLossPercent, dryRun]);

  const methodsByType: Record<(typeof failureTypes)[number], string[]> = {
    pod_crash: ['delete-pods', 'scale-to-zero', 'crashloop-env', 'invalid-command'],
    service_unavailability: ['scale-to-zero', 'deny-ingress-netpol', 'deny-egress-netpol', 'restart-pods'],
    database_connection_failure: ['bad-db-env', 'deny-egress', 'poison-dns-hostalias', 'restart-pods'],
    cache_unavailability: ['kill-cache-pods', 'deny-egress', 'latency-env', 'bad-cache-env'],
    network_latency: ['inject-latency-env', 'restart-pods', 'deny-egress', 'scale-down'],
    packet_loss: ['inject-loss-env', 'deny-egress', 'restart-pods', 'scale-down'],
    cpu_saturation: ['cpu-hog-env', 'restart-pods', 'scale-down', 'tight-loop-command'],
    memory_pressure: ['memory-leak-env', 'reduce-memory-limits', 'restart-pods', 'allocate-memory-loop'],
    disk_pressure: ['disk-fill-env', 'log-explosion-env', 'reduce-ephemeral', 'restart-pods'],
    deployment_misconfiguration: ['bad-env', 'bad-port', 'remove-env', 'restart-pods'],
    autoscaling_failure: ['scale-to-zero', 'scale-down', 'restart-pods', 'disable-scaling-env'],
    failing_health_probes: ['fail-readiness', 'fail-liveness', 'delay-probes', 'invalid-probe-endpoint'],
    ingress_misrouting: ['misroute-env', 'scale-to-zero', 'deny-ingress', 'restart-pods'],
  };

  useEffect(() => {
    if (!methodsByType[failureType].includes(method)) {
      const first = methodsByType[failureType][0];
      if (first) setMethod(first);
    }
  }, [failureType, method]);

  const canCreate = user?.role === 'admin' || user?.role === 'engineer';

  async function submitSimulation() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: any = {
        ...(name ? { name } : {}),
        failureType,
        method,
        target: {
          namespace,
          ...(deploymentName ? { deploymentName } : {}),
          ...(labelSelector ? { labelSelector } : {}),
        },
        durationSeconds,
        ...(typeof intensityPercent === 'number' ? { intensityPercent } : {}),
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
        ...(typeof packetLossPercent === 'number' ? { packetLossPercent } : {}),
        dryRun,
      };

      if (saveAsTemplate) {
        await api.createTemplate(token, {
          name: templateName || name || `${failureType} template`,
          failureType,
          defaultNamespace: namespace,
          defaultDurationSeconds: durationSeconds,
          config: body,
        });
      }

      const res = await api.createSimulation(token, body);
      router.push(`/simulations/${res.simulation.id}`);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create simulation');
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  const riskColor = preview.risk === 'high' ? 'text-red-400' : preview.risk === 'medium' ? 'text-amber-400' : 'text-emerald-400';
  const riskVariant = preview.risk === 'high' ? 'error' : preview.risk === 'medium' ? 'warning' : 'success';

  const selectClasses = 'h-10 w-full rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 text-sm text-slate-100 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-500/40 appearance-none cursor-pointer';

  return (
    <AppShell header={<AppHeader title="Simulation Builder" subtitle="Configure a safe, reversible experiment." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={false} />}>
      <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div>
                <CardTitle>Parameters</CardTitle>
                <CardDescription>Everything is validated server-side and constrained by safety limits.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-300">Name (optional)</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DB Down – 60s" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">Failure type</label>
                <div className="relative">
                  <select className={selectClasses} value={failureType} onChange={(e) => setFailureType(e.target.value as any)}>
                    {failureTypes.map((t) => (<option key={t} value={t}>{t.replaceAll('_', ' ')}</option>))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">Method</label>
                <div className="relative">
                  <select className={selectClasses} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {methodsByType[failureType].map((m) => (<option key={m} value={m}>{m}</option>))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">Target namespace</label>
                <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">Target deployment (optional)</label>
                <Input value={deploymentName} onChange={(e) => setDeploymentName(e.target.value)} placeholder="backend-deployment" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-300">Label selector (optional but recommended)</label>
              <Input value={labelSelector} onChange={(e) => setLabelSelector(e.target.value)} placeholder="app=backend" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-slate-300">Duration (seconds)</label>
                <input type="range" min={5} max={3600} value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} className="w-full accent-indigo-500" />
                <div className="text-[12px] text-slate-500 font-mono">{durationSeconds}s</div>
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-slate-300">Intensity % (optional)</label>
                <input type="range" min={1} max={100} value={intensityPercent ?? 30} onChange={(e) => setIntensityPercent(Number(e.target.value))} className="w-full accent-indigo-500" />
                <div className="text-[12px] text-slate-500 font-mono">{intensityPercent ?? 30}%</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">Latency ms (optional)</label>
                <Input type="number" value={latencyMs ?? ''} onChange={(e) => setLatencyMs(e.target.value ? Number(e.target.value) : undefined)} min={10} max={60000} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-300">Packet loss % (optional)</label>
              <Input type="number" value={packetLossPercent ?? ''} onChange={(e) => setPacketLossPercent(e.target.value ? Number(e.target.value) : undefined)} min={1} max={100} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 rounded-lg bg-slate-800/30 border border-slate-800/40 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-800/50">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-indigo-500 h-4 w-4" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Dry-run mode</div>
                  <div className="text-[12px] text-slate-500">Recommended for first execution in a namespace</div>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-lg bg-slate-800/30 border border-slate-800/40 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-800/50">
                <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} className="accent-indigo-500 h-4 w-4" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Save as Template</div>
                  <div className="text-[12px] text-slate-500">Persist this config for one-click reuse</div>
                </div>
              </label>
            </div>

            {saveAsTemplate && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <label className="text-[13px] font-medium text-slate-300">Template name</label>
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Standard Redis Latency Test" required />
              </div>
            )}

            {/* Preview */}
            <Card className="border-slate-700/40 bg-slate-800/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Impact Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-slate-500">Target</div>
                  <div className="text-slate-200">{preview.target.namespace} / {preview.target.deploymentName ?? preview.target.labelSelector ?? 'n/a'}</div>
                  <div className="text-slate-500">Impact</div>
                  <div className="text-slate-200">{failureType.replaceAll('_', ' ')}</div>
                  <div className="text-slate-500">Risk level</div>
                  <div><Badge variant={riskVariant as any}>{preview.risk}</Badge></div>
                  <div className="text-slate-500">Duration</div>
                  <div className="text-slate-200 font-mono">{durationSeconds}s</div>
                </div>
              </CardContent>
            </Card>

            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            ) : null}

            <div className="flex gap-2 pt-2">
              <Dialog open={confirmOpen} onOpenChange={(v: boolean) => setConfirmOpen(v)}>
                <DialogTrigger asChild>
                  <Button disabled={submitting || !token || !canCreate} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0 hover:from-indigo-400 hover:to-violet-500 shadow-md shadow-indigo-500/20">
                    {submitting ? 'Starting…' : 'Start simulation'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-950 border-slate-800">
                  <DialogHeader>
                    <DialogTitle>Confirm simulation run</DialogTitle>
                    <DialogDescription>Dry-run is safest for first execution in a namespace.</DialogDescription>
                  </DialogHeader>
                  {!dryRun ? (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> Live mutation mode enabled
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-2 p-4">
                    <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                    <Button disabled={submitting} onClick={() => void submitSimulation()} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0">Confirm</Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Button variant="outline" onClick={() => router.push('/dashboard')}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
