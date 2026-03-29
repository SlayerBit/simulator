'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitBranch, ArrowRight } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export default function DependenciesPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => { if (!loading && !token) router.push('/login'); }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    api.dependencies(token).then((r) => setData(r)).catch(() => {}).finally(() => setBusy(false));
  }, [token]);

  return (
    <AppShell header={<AppHeader title="Service Dependencies" subtitle="Directed graph of service relationships." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-7xl animate-fade-in">
        {busy ? <Skeleton className="h-48 w-full" /> : !data?.edges?.length ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <GitBranch className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No dependency edges</p>
            <p className="text-[13px] text-slate-500 mt-1">DependencyEdge records model service-to-service relationships.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Services ({(data.services ?? []).length})</CardTitle>
                <CardDescription>All unique services discovered from dependency edges.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(data.services ?? []).map((s: string) => (
                    <div key={s} className="rounded-lg bg-slate-800/50 border border-slate-700/30 px-3 py-1.5 text-[13px] font-medium text-slate-200">
                      {s}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Edges ({(data.edges ?? []).length})</CardTitle>
                <CardDescription>Directed relationships between services.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(data.edges ?? []).map((e: any) => (
                    <div key={e.id} className="flex items-center gap-3 rounded-lg bg-slate-800/30 border border-slate-800/40 p-3 text-sm">
                      <span className="font-medium text-slate-200">{e.fromService}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                      <span className="font-medium text-slate-200">{e.toService}</span>
                      {e.protocol && <span className="ml-auto text-[12px] text-slate-500 uppercase tracking-wide">{e.protocol}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
