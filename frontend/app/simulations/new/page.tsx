'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, Zap, Info } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

/** Production allowlist: five categories, ten methods total (see backend allowlist). */
const failureTypes = [
  'pod_crash',
  'service_unavailability',
  'network_failure',
  'resource_pressure',
  'rollout_failure',
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
  const [manualRollback, setManualRollback] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [methodsMeta, setMethodsMeta] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    api.getMethodsMeta(token).then(data => setMethodsMeta(data.methods)).catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  // ── Derived: active method spec ─────────────────────────────────────────
  const activeMethod = methodsMeta.find(m => m.supports === failureType && m.id === method);
  const reqs = activeMethod?.requirements ?? {};
  const safeDefaults = reqs.safeDefaults ?? {};

  // When the method changes, pre-fill optional numeric fields whose current
  // value is undefined with the method's safe default (if one exists).
  useEffect(() => {
    if (!activeMethod) return;
    const d = activeMethod.requirements?.safeDefaults ?? {};
    if (d.latencyMs !== undefined && !reqs.requiresLatencyMs && latencyMs === undefined) {
      setLatencyMs(d.latencyMs);
    }
    if (d.packetLossPercent !== undefined && !reqs.requiresPacketLossPercent && packetLossPercent === undefined) {
      setPacketLossPercent(d.packetLossPercent);
    }
    if (d.intensityPercent !== undefined && !reqs.requiresIntensityPercent && intensityPercent === undefined) {
      setIntensityPercent(d.intensityPercent);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, failureType]);

  const methodsByType = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const t of failureTypes) map[t] = [];
    for (const m of methodsMeta) {
      if (!map[m.supports]) map[m.supports] = [];
      (map[m.supports] as string[]).push(m.id);
    }
    if (methodsMeta.length === 0) {
      map.pod_crash = ['delete-pods'];
      return map;
    }
    return map;
  }, [methodsMeta]);

  // Reset method when failure type changes
  useEffect(() => {
    if (methodsByType[failureType] && methodsByType[failureType].length > 0 && !methodsByType[failureType].includes(method)) {
      const first = methodsByType[failureType][0];
      if (first) setMethod(first);
    }
  }, [failureType, method, methodsByType]);

  // ── Validation – required field checks ──────────────────────────────────
  const isNamespaceValid = !!namespace;
  const isDeploymentValid = !reqs.requiresDeployment || !!deploymentName;
  const isServiceValid = !reqs.requiresService || !!deploymentName;
  const isSelectorValid = !reqs.requiresLabelSelector || !!labelSelector;
  const isDurationValid = !reqs.requiresDuration || durationSeconds > 0;
  const isLatencyValid = !reqs.requiresLatencyMs || (typeof latencyMs === 'number' && latencyMs >= 10);
  const isIntensityValid = !reqs.requiresIntensityPercent || (typeof intensityPercent === 'number' && intensityPercent >= 1);
  const isPacketLossValid = !reqs.requiresPacketLossPercent || (typeof packetLossPercent === 'number' && packetLossPercent >= 1);

  const canSubmitAction =
    isNamespaceValid &&
    isDeploymentValid &&
    isServiceValid &&
    isSelectorValid &&
    isDurationValid &&
    isLatencyValid &&
    isIntensityValid &&
    isPacketLossValid;

  const canCreate = user?.role === 'admin' || user?.role === 'engineer';

  // ── Submission ───────────────────────────────────────────────────────────
  async function submitSimulation() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      // Build target: include service vs deployment based on flags
      const target: any = { namespace };
      if (reqs.requiresService) {
        target.serviceName = deploymentName;
      } else if (reqs.requiresDeployment || deploymentName) {
        target.deploymentName = deploymentName;
      }
      if (reqs.requiresLabelSelector || labelSelector) {
        target.labelSelector = labelSelector;
      }

      // Build body — always include required numeric params with their
      // resolved value (user-provided or safe default).
      const resolvedLatencyMs = latencyMs ?? safeDefaults.latencyMs;
      const resolvedIntensityPercent = intensityPercent ?? safeDefaults.intensityPercent;
      const resolvedPacketLossPercent = packetLossPercent ?? safeDefaults.packetLossPercent;

      const body: any = {
        ...(name ? { name } : {}),
        failureType,
        method,
        target,
        durationSeconds,
        dryRun,
        manualRollback,
      };

      // Only include each numeric param when there's a real value to send
      if (typeof resolvedLatencyMs === 'number') body.latencyMs = resolvedLatencyMs;
      if (typeof resolvedIntensityPercent === 'number') body.intensityPercent = resolvedIntensityPercent;
      if (typeof resolvedPacketLossPercent === 'number') body.packetLossPercent = resolvedPacketLossPercent;

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

  // ── Risk preview ─────────────────────────────────────────────────────────
  const preview = useMemo(() => {
    const target: any = { namespace };
    if (deploymentName) target.deploymentName = deploymentName;
    if (labelSelector) target.labelSelector = labelSelector;
    const risk = dryRun ? 'low' : durationSeconds > 300 || (intensityPercent ?? 0) > 75 ? 'high' : 'medium';
    return { failureType, method, target, durationSeconds, intensityPercent, latencyMs, packetLossPercent, risk, dryRun };
  }, [namespace, deploymentName, labelSelector, failureType, method, durationSeconds, intensityPercent, latencyMs, packetLossPercent, dryRun]);

  const riskColor = preview.risk === 'high' ? 'text-red-400' : preview.risk === 'medium' ? 'text-amber-400' : 'text-emerald-400';
  const riskVariant = preview.risk === 'high' ? 'error' : preview.risk === 'medium' ? 'warning' : 'success';

  const selectClasses = 'h-10 w-full rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 text-sm text-slate-100 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-500/40 appearance-none cursor-pointer';
  const fieldError = 'text-xs text-red-400 mt-1';

  // ── Render ────────────────────────────────────────────────────────────────
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
                <CardDescription>Required fields are enforced both here and server-side.</CardDescription>
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
                    {(methodsByType[failureType] || []).map((m: string) => {
                      const meta = methodsMeta.find(x => x.supports === failureType && x.id === m);
                      return <option key={m} value={m}>{meta?.title || m}</option>;
                    })}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                </div>
                {activeMethod?.title && (
                  <p className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Info className="h-3 w-3" /> {activeMethod.title}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">
                  Target namespace <span className="text-red-400">*</span>
                </label>
                <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} className={!isNamespaceValid ? 'border-red-500' : ''} />
                {!isNamespaceValid && <p className={fieldError}>Namespace is required.</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">
                  {reqs.requiresService ? 'Target Service Name' : 'Target Deployment'}{' '}
                  {reqs.requiresService || reqs.requiresDeployment
                    ? <span className="text-red-400">*</span>
                    : <span className="text-slate-600">(optional)</span>}
                </label>
                <Input
                  value={deploymentName}
                  onChange={(e) => setDeploymentName(e.target.value)}
                  placeholder="e.g. backend"
                  className={(!isDeploymentValid || !isServiceValid) ? 'border-red-500' : ''}
                />
                {(!isDeploymentValid || !isServiceValid) && (
                  <p className={fieldError}>
                    {reqs.requiresService ? 'Service name' : 'Deployment name'} is required for this method.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-300">
                Label selector{' '}
                {reqs.requiresLabelSelector
                  ? <span className="text-red-400">*</span>
                  : <span className="text-slate-600">(optional)</span>}
              </label>
              <Input
                value={labelSelector}
                onChange={(e) => setLabelSelector(e.target.value)}
                placeholder="app=backend"
                className={!isSelectorValid ? 'border-red-500' : ''}
              />
              {!isSelectorValid && (
                <p className={fieldError}>A label selector is required for this failure method.</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-slate-300">Duration (seconds)</label>
                <input type="range" min={5} max={3600} value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} className="w-full accent-indigo-500" />
                <div className="text-[12px] text-slate-500 font-mono">{durationSeconds}s</div>
              </div>

              {/* Intensity % — required or optional based on method spec */}
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-slate-300">
                  Intensity %{' '}
                  {reqs.requiresIntensityPercent
                    ? <span className="text-red-400">*</span>
                    : <span className="text-slate-600">(optional)</span>}
                </label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={intensityPercent ?? safeDefaults.intensityPercent ?? 30}
                  onChange={(e) => setIntensityPercent(Number(e.target.value))}
                  className={`w-full accent-indigo-500 ${!isIntensityValid ? 'outline outline-1 outline-red-500 rounded' : ''}`}
                />
                <div className={`text-[12px] font-mono ${!isIntensityValid ? 'text-red-400' : 'text-slate-500'}`}>
                  {intensityPercent ?? safeDefaults.intensityPercent ?? 30}%
                  {reqs.requiresIntensityPercent && intensityPercent === undefined && safeDefaults.intensityPercent !== undefined && (
                    <span className="ml-1 text-slate-600">(default)</span>
                  )}
                </div>
                {!isIntensityValid && <p className={fieldError}>Intensity % is required for this method (min 1).</p>}
              </div>

              {/* Latency ms — required or optional based on method spec */}
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-slate-300">
                  Latency ms{' '}
                  {reqs.requiresLatencyMs
                    ? <span className="text-red-400">*</span>
                    : <span className="text-slate-600">(optional)</span>}
                </label>
                <Input
                  type="number"
                  value={latencyMs ?? (reqs.requiresLatencyMs ? '' : '')}
                  onChange={(e) => setLatencyMs(e.target.value ? Number(e.target.value) : undefined)}
                  min={10}
                  max={60000}
                  placeholder={safeDefaults.latencyMs ? String(safeDefaults.latencyMs) : '500'}
                  className={!isLatencyValid ? 'border-red-500' : ''}
                />
                {!isLatencyValid && <p className={fieldError}>Latency (ms) is required for this method (min 10ms).</p>}
              </div>
            </div>

            {/* Packet loss % — required or optional based on method spec */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-300">
                Packet loss %{' '}
                {reqs.requiresPacketLossPercent
                  ? <span className="text-red-400">*</span>
                  : <span className="text-slate-600">(optional)</span>}
              </label>
              <Input
                type="number"
                value={packetLossPercent ?? ''}
                onChange={(e) => setPacketLossPercent(e.target.value ? Number(e.target.value) : undefined)}
                min={1}
                max={100}
                placeholder={safeDefaults.packetLossPercent ? String(safeDefaults.packetLossPercent) : '10'}
                className={!isPacketLossValid ? 'border-red-500' : ''}
              />
              {!isPacketLossValid && <p className={fieldError}>Packet loss % is required for this method (min 1).</p>}
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
                <input type="checkbox" checked={manualRollback} onChange={(e) => setManualRollback(e.target.checked)} className="accent-indigo-500 h-4 w-4" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Manual Recovery</div>
                  <div className="text-[12px] text-slate-500">Failure persists until you click "Rollback" manually.</div>
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

            {/* Requirement summary hint */}
            {activeMethod && (
              <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Method Requirements</p>
                <div className="flex flex-wrap gap-2">
                  {reqs.requiresDeployment && <Badge variant="neutral" className="text-[10px]">Deployment name</Badge>}
                  {reqs.requiresService && <Badge variant="neutral" className="text-[10px]">Service name</Badge>}
                  {reqs.requiresLabelSelector && <Badge variant="neutral" className="text-[10px]">Label selector</Badge>}
                  {reqs.requiresLatencyMs && <Badge variant="neutral" className="text-[10px]">Latency ms</Badge>}
                  {reqs.requiresIntensityPercent && <Badge variant="neutral" className="text-[10px]">Intensity %</Badge>}
                  {reqs.requiresPacketLossPercent && <Badge variant="neutral" className="text-[10px]">Packet loss %</Badge>}
                  {Object.keys(reqs).filter(k => k.startsWith('requires') && (reqs as any)[k]).length === 0 && (
                    <span className="text-[11px] text-slate-600">namespace only</span>
                  )}
                </div>
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
                  <Button
                    disabled={submitting || !token || !canCreate || !canSubmitAction}
                    className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0 hover:from-indigo-400 hover:to-violet-500 shadow-md shadow-indigo-500/20"
                  >
                    {submitting ? 'Starting…' : !canSubmitAction ? 'Fill Required Fields' : 'Start simulation'}
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
