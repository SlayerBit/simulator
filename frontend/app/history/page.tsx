'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileClock } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import type { Simulation } from '@/types';

export default function HistoryPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [sims, setSims] = useState<Simulation[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!loading && !token) router.push('/login'); }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    setBusy(true);
    api.listSimulations(token)
      .then((r) => {
        setSims(r.simulations);
        setErr(null);
      })
      .catch((e) => {
        setErr(e?.message ?? 'Failed to load simulations');
      })
      .finally(() => setBusy(false));
  }, [token]);

  const variant = (s: string) => s === 'completed' ? 'success' : s === 'failed' ? 'error' : s === 'rolled_back' ? 'warning' : 'neutral';

  return (
    <AppShell header={<AppHeader title="Simulation History" subtitle="Past and present experiments." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-7xl animate-fade-in px-6">
        {err ? (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {err}
          </div>
        ) : null}
        {busy ? <Skeleton className="h-64 w-full" /> : sims.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <FileClock className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No simulations found</p>
            <p className="text-[13px] text-slate-500 mt-1">Create a simulation to begin building your resilience history.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Failure Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Namespace</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Dry Run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sims.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-slate-400">{s.failureType.replaceAll('_', ' ')}</TableCell>
                  <TableCell><Badge variant={variant(s.state) as any}>{s.state}</Badge></TableCell>
                  <TableCell className="text-slate-400">{s.namespace}</TableCell>
                  <TableCell className="text-slate-400">{s.durationSeconds}s</TableCell>
                  <TableCell>{s.dryRun ? <Badge variant="default">Yes</Badge> : <Badge variant="neutral">No</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => router.push(`/simulations/${s.id}`)}>View</Button>
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
