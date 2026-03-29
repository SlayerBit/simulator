'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export default function SchedulesPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => { if (!loading && !token) router.push('/login'); }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    api.schedules(token).then((r) => setSchedules(r.schedules)).catch(() => {}).finally(() => setBusy(false));
  }, [token]);

  return (
    <AppShell header={<AppHeader title="Schedules" subtitle="Cron-based recurring failure experiments." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-7xl animate-fade-in">
        {busy ? <Skeleton className="h-48 w-full" /> : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <CalendarClock className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No schedules configured</p>
            <p className="text-[13px] text-slate-500 mt-1">Schedule recurring simulations via cron expressions linked to templates.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Cron</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-[13px] text-slate-400">{s.cronExpression}</TableCell>
                  <TableCell className="text-slate-400">{s.templateId?.slice(0, 12) ?? '—'}</TableCell>
                  <TableCell>
                    {s.enabled ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Disabled</Badge>}
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
