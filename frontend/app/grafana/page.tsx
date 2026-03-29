'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Shield } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export default function GrafanaPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();

  useEffect(() => { if (!loading && !token) router.push('/login'); }, [loading, token, router]);

  const grafanaUrl = process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3001';

  return (
    <AppShell header={<AppHeader title="Observability" subtitle="Grafana, Prometheus, and Loki integrations." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-4xl animate-fade-in">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle>Grafana Dashboard</CardTitle>
                <CardDescription>View metrics, logs, and simulation annotations.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl bg-slate-800/30 border border-slate-800/50 p-6">
              <div className="grid gap-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Grafana URL</span>
                  <code className="rounded bg-slate-800/60 px-2 py-1 text-[13px] text-slate-300">{grafanaUrl}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Default Credentials</span>
                  <code className="rounded bg-slate-800/60 px-2 py-1 text-[13px] text-slate-300">admin / admin</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Prometheus</span>
                  <code className="rounded bg-slate-800/60 px-2 py-1 text-[13px] text-slate-300">http://localhost:9090</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Loki</span>
                  <code className="rounded bg-slate-800/60 px-2 py-1 text-[13px] text-slate-300">http://localhost:3100</code>
                </div>
              </div>
            </div>
            <Button asChild className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-0 hover:from-emerald-400 hover:to-teal-500 shadow-md shadow-emerald-500/20">
              <a href={grafanaUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open Grafana in New Tab
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
