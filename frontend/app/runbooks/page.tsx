'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpenText } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import type { Runbook } from '@/types';

function severityVariant(severity: string) {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return 'error';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'success';
  return 'neutral';
}

export default function RunbooksPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !token) router.push('/login');
  }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    setBusy(true);
    api
      .listRunbooks(token)
      .then((r) => {
        setRunbooks(r.runbooks);
        setErr(null);
      })
      .catch((e) => {
        setErr(e?.message ?? 'Failed to load runbooks');
      })
      .finally(() => setBusy(false));
  }, [token]);

  return (
    <AppShell
      header={
        <AppHeader
          title="Generated Runbooks"
          subtitle="Agent 1 live analysis outputs from simulations."
          userLabel={user?.role ?? 'user'}
          onLogout={logout}
          canCreate={user?.role !== 'viewer'}
        />
      }
    >
      <div className="mx-auto max-w-7xl animate-fade-in px-6">
        {err ? (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">{err}</div>
        ) : null}
        {busy ? (
          <Skeleton className="h-64 w-full" />
        ) : runbooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <BookOpenText className="mb-4 h-10 w-10 text-slate-600" />
            <p className="text-sm font-medium text-slate-400">No runbooks yet</p>
            <p className="mt-1 text-[13px] text-slate-500">Start a simulation and Agent 1 analysis will populate this view.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Simulation</TableHead>
                <TableHead>Incident Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runbooks.map((rb) => (
                <TableRow key={rb.id}>
                  <TableCell className="text-slate-400">{new Date(rb.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{rb.simulation?.name ?? rb.simulationId}</TableCell>
                  <TableCell>{rb.incidentType}</TableCell>
                  <TableCell>
                    <Badge variant={severityVariant(rb.severity) as any}>{rb.severity}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => router.push(`/runbooks/${rb.id}`)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AppShell>
  );
}
