'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export default function AuditPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => { if (!loading && !token) router.push('/login'); }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    api.audit(token).then((r) => setEvents(r.events)).catch(() => {}).finally(() => setBusy(false));
  }, [token]);

  const actionColor = (a: string) => a.includes('failed') ? 'error' : a.includes('stop') ? 'warning' : a.includes('created') ? 'success' : 'neutral';

  return (
    <AppShell header={<AppHeader title="Audit Log" subtitle="Complete record of all simulation lifecycle events." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-7xl animate-fade-in">
        {busy ? <Skeleton className="h-64 w-full" /> : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <FileText className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No audit events</p>
            <p className="text-[13px] text-slate-500 mt-1">Events appear here after simulations are created or modified.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Simulation</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell><Badge variant={actionColor(ev.action) as any}>{ev.action}</Badge></TableCell>
                  <TableCell className="text-slate-400 font-mono text-[13px]">{ev.simulationId ? ev.simulationId.slice(0, 12) + '…' : '—'}</TableCell>
                  <TableCell className="text-slate-400">{ev.userId?.slice(0, 8) ?? '—'}</TableCell>
                  <TableCell className="text-slate-500 text-[13px]">{new Date(ev.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AppShell>
  );
}
