'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, TerminalSquare } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import type { Runbook } from '@/types';

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function severityVariant(severity: string) {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return 'error';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'success';
  return 'neutral';
}

export default function RunbookDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id);
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [runbook, setRunbook] = useState<Runbook | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    setBusy(true);
    api
      .getRunbook(token, id)
      .then((r) => {
        setRunbook(r.runbook);
        setErr(null);
      })
      .catch((e) => setErr(e?.message ?? 'Failed to load runbook'))
      .finally(() => setBusy(false));
  }, [token, id]);

  const payload = runbook?.payload ?? {};
  const steps = asArray(payload.steps);
  const commands = asArray(payload.commands);
  const evidence = payload.evidence ?? {};
  const confidence = payload.confidence;
  const decisionPath = payload.decision_path ?? payload.decisionPath ?? 'unknown';
  const summary = payload.summary ?? payload.incident_summary ?? payload.probable_cause ?? 'No summary available';

  const evidenceEntries = useMemo(() => Object.entries(evidence || {}), [evidence]);

  if (busy && !runbook) {
    return (
      <AppShell header={<AppHeader title="Runbook Detail" subtitle="Loading..." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={true} />}>
        <div className="mx-auto max-w-6xl p-6">
          <Skeleton className="h-96 w-full" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      header={<AppHeader title="Runbook Detail" subtitle={runbook?.incidentType ?? id} userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={true} />}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-6 pb-12">
        {err ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">{err}</div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push('/runbooks')}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
          {runbook?.simulationId ? (
            <Button variant="outline" size="sm" onClick={() => router.push(`/simulations/${runbook.simulationId}`)}>
              Open Simulation
            </Button>
          ) : null}
        </div>

        {runbook ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  {runbook.incidentType}
                  <Badge variant={severityVariant(runbook.severity) as any}>{runbook.severity}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div>
                  <span className="text-slate-500">Summary:</span> <span>{summary}</span>
                </div>
                <div>
                  <span className="text-slate-500">Confidence:</span> <span>{typeof confidence === 'number' ? confidence.toFixed(3) : String(confidence ?? 'n/a')}</span>
                </div>
                <div>
                  <span className="text-slate-500">Decision Path:</span> <span>{decisionPath}</span>
                </div>
                <div>
                  <span className="text-slate-500">Generated At:</span> <span>{new Date(runbook.createdAt).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Runbook Steps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {steps.length === 0 ? (
                  <p className="text-sm text-slate-500">No steps present in payload.</p>
                ) : (
                  steps.map((step, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-800 p-3 text-sm">
                      {typeof step === 'string' ? step : step.action ?? JSON.stringify(step)}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {evidenceEntries.length === 0 ? (
                  <p className="text-sm text-slate-500">No evidence fields present.</p>
                ) : (
                  evidenceEntries.map(([key, value]) => (
                    <div key={key} className="rounded border border-slate-800 bg-slate-950/30 p-2">
                      <div className="font-medium text-slate-400">{key}</div>
                      <div className="font-mono text-slate-300 break-all">{typeof value === 'string' ? value : JSON.stringify(value)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TerminalSquare className="h-4 w-4" />
                  Commands
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {commands.length === 0 ? (
                  <p className="text-sm text-slate-500">No commands present in payload.</p>
                ) : (
                  commands.map((cmd, idx) => (
                    <pre key={idx} className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
                      {typeof cmd === 'string' ? cmd : JSON.stringify(cmd)}
                    </pre>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
