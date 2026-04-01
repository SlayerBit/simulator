'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Play, Plus, Trash2, Edit3, Loader2 } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import type { Template } from '@/types';

export default function TemplatesPage() {
  const router = useRouter(); 
  const { token, loading, user, logout } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchTemplates = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.listTemplates(token);
      setTemplates(res.templates);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to fetch templates');
      console.error('Failed to fetch templates', e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token && !loading) {
      router.push('/login'); 
    }
    fetchTemplates();
  }, [token, loading, router]);

  const handleDelete = async (id: string) => {
    if (!token || !confirm('Are you sure you want to delete this template?')) return;
    await api.deleteTemplate(token, id);
    fetchTemplates();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    
    try {
      if (editingTemplate) {
        await api.updateTemplate(token, editingTemplate.id, data);
      } else {
        await api.createTemplate(token, data);
      }
      setModalOpen(false);
      setEditingTemplate(null);
      fetchTemplates();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canManage = user?.role === 'admin' || user?.role === 'engineer';

  return (
    <AppShell header={<AppHeader title="Templates" subtitle="Reusable failure experiment configurations." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={false} />}>
      <div className="mx-auto max-w-7xl animate-fade-in px-6">
        {err ? (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {err}
          </div>
        ) : null}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-200">Predefined Templates</h2>
          {canManage && (
            <Dialog open={modalOpen} onOpenChange={(open: boolean) => { setModalOpen(open); if (!open) setEditingTemplate(null); }}>
              <DialogTrigger asChild>
                <Button variant="default" size="sm" className="gap-2">
                  <Plus className="h-3.5 w-3.5" /> New Template
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-slate-950 border-slate-800">
                <form onSubmit={handleSubmit}>
                  <DialogHeader>
                    <DialogTitle>{editingTemplate ? 'Edit Template' : 'Create New Template'}</DialogTitle>
                    <DialogDescription>Define a reusable configuration for failure simulations.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Template Name</span>
                      <Input id="name" name="name" defaultValue={editingTemplate?.name} placeholder="e.g. Database Outage Stress Test" required className="bg-slate-900 border-slate-800" />
                    </div>
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Failure Type</span>
                      <select name="failureType" defaultValue={editingTemplate?.failureType || 'pod_crash'} className="flex h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-700">
                        <option value="pod_crash">Pod Crash</option>
                        <option value="network_latency">Network Latency</option>
                        <option value="service_unavailability">Service Unavailability</option>
                        <option value="database_connection_failure">DB Connection Failure</option>
                        <option value="cpu_saturation">CPU Saturation</option>
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Description</span>
                      <Input id="description" name="description" defaultValue={editingTemplate?.description} placeholder="Short summary of what this template tests..." className="bg-slate-900 border-slate-800" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <span className="text-xs font-medium text-slate-400">Namespace</span>
                        <Input name="defaultNamespace" defaultValue={editingTemplate?.defaultNamespace} placeholder="default" className="bg-slate-900 border-slate-800" />
                      </div>
                      <div className="grid gap-2">
                        <span className="text-xs font-medium text-slate-400">Duration (s)</span>
                        <Input name="defaultDurationSeconds" type="number" defaultValue={editingTemplate?.defaultDurationSeconds || 60} className="bg-slate-900 border-slate-800" />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isSubmitting} className="w-full">
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {editingTemplate ? 'Update Template' : 'Save Template'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {busy ? <Skeleton className="h-48 w-full" /> : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center">
            <Activity className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No templates configured</p>
            <p className="text-[13px] text-slate-500 mt-1">Templates store predefined failure configurations for quick launches.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.id} className="group hover:-translate-y-0.5 transition-all duration-200 bg-slate-900/50 border-slate-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="default" className="text-[10px] uppercase tracking-wider text-slate-500 border-slate-800 bg-transparent">{t.failureType?.replaceAll('_', ' ')}</Badge>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-slate-200" onClick={() => { setEditingTemplate(t); setModalOpen(true); }}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-destructive" onClick={() => handleDelete(t.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <CardTitle className="text-base font-semibold text-slate-200">{t.name}</CardTitle>
                  <CardDescription className="line-clamp-2 min-h-[40px] text-xs text-slate-400">{t.description || 'No description provided.'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-slate-950/50 p-3 space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Default Target</span>
                      <span className="text-slate-300 font-medium">{t.defaultNamespace || '—'}/{t.defaultService || '*'}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Duration</span>
                      <span className="text-slate-300 font-medium">{t.defaultDurationSeconds || 60}s</span>
                    </div>
                    {t.schedules && t.schedules.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800/50 mt-1">
                        <span className="text-[10px] text-slate-600 w-full mb-1 uppercase tracking-tighter">Active Schedules</span>
                        {t.schedules.map((s: any) => (
                           <Badge key={s.id} variant="neutral" className="text-[9px] h-4 px-1.5 bg-slate-800 text-slate-400">{s.name}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {canManage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 border-slate-800 hover:bg-slate-800 hover:text-slate-100 transition-colors shadow-sm"
                      onClick={async () => {
                        if (!token) return;
                        const res = await api.runTemplate(token, t.id);
                        window.location.href = `/simulations/${res.simulation.id}`;
                      }}
                    >
                      <Play className="h-3.5 w-3.5" /> Run experiment
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
