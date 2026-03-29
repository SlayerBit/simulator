'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Play } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export default function TemplatesPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => { if (!loading && !token) router.push('/login'); }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    api.templates(token).then((r) => setTemplates(r.templates)).catch(() => {}).finally(() => setBusy(false));
  }, [token]);

  const canRun = user?.role === 'admin' || user?.role === 'engineer';

  return (
    <AppShell header={<AppHeader title="Templates" subtitle="Reusable failure experiment configurations." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={user?.role !== 'viewer'} />}>
      <div className="mx-auto max-w-7xl animate-fade-in">
        {busy ? <Skeleton className="h-48 w-full" /> : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <Activity className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No templates configured</p>
            <p className="text-[13px] text-slate-500 mt-1">Templates store predefined failure configurations for quick launches.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.id} className="group hover:-translate-y-0.5 transition-all duration-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <Badge variant="default">{t.failureType?.replaceAll('_', ' ')}</Badge>
                  </div>
                  <CardDescription>{t.description || 'No description'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-[13px]">
                    <div className="text-slate-500">Namespace</div>
                    <div className="text-slate-300">{t.defaultNamespace || '—'}</div>
                    <div className="text-slate-500">Duration</div>
                    <div className="text-slate-300">{t.defaultDurationSeconds || 60}s</div>
                  </div>
                  {canRun ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={async () => {
                        if (!token) return;
                        const res = await api.runTemplate(token, t.id);
                        router.push(`/simulations/${res.simulation.id}`);
                      }}
                    >
                      <Play className="h-3.5 w-3.5" /> Run Template
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
