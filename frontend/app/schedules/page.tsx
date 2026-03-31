'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Plus, Trash2, Edit3, Loader2, PlayCircle } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export default function SchedulesPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [sRes, tRes] = await Promise.all([
        api.listSchedules(token),
        api.listTemplates(token)
      ]);
      setSchedules(sRes.schedules);
      setTemplates(tRes.templates);
    } catch (err) {
      console.error('Failed to fetch schedules', err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!loading && !token) router.push('/login');
    fetchData();
  }, [loading, token, router]);

  const handleDelete = async (id: string) => {
    if (!token || !confirm('Are you sure you want to delete this schedule?')) return;
    await api.deleteSchedule(token, id);
    fetchData();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    
    // Convert 'enabled' checkbox
    (data as any).enabled = formData.get('enabled') === 'on';

    try {
      if (editingSchedule) {
        await api.updateSchedule(token, editingSchedule.id, data);
      } else {
        await api.createSchedule(token, data);
      }
      setModalOpen(false);
      setEditingSchedule(null);
      fetchData();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canManage = user?.role === 'admin' || user?.role === 'engineer';

  return (
    <AppShell header={<AppHeader title="Schedules" subtitle="Cron-based recurring failure experiments." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={false} />}>
      <div className="mx-auto max-w-7xl animate-fade-in px-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-200">Recurring Simulations</h2>
          {canManage && (
            <Dialog open={modalOpen} onOpenChange={(open: boolean) => { setModalOpen(open); if (!open) setEditingSchedule(null); }}>
              <DialogTrigger asChild>
                <Button variant="default" size="sm" className="gap-2 shadow-lg">
                  <Plus className="h-3.5 w-3.5" /> New Schedule
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-slate-950 border-slate-800">
                <form onSubmit={handleSubmit}>
                  <DialogHeader>
                    <DialogTitle>{editingSchedule ? 'Edit Schedule' : 'Create New Schedule'}</DialogTitle>
                    <DialogDescription>Automate simulations by linking them to a template and cron expression.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Schedule Name</span>
                      <Input id="name" name="name" defaultValue={editingSchedule?.name} placeholder="e.g. Weekly Latency Sweep" required className="bg-slate-900 border-slate-800" />
                    </div>
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Link Template</span>
                      <select name="templateId" defaultValue={editingSchedule?.templateId || ''} required className="flex h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-700">
                        <option value="" disabled>Select a template...</option>
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Cron Expression</span>
                      <Input id="cronExpression" name="cronExpression" defaultValue={editingSchedule?.cronExpression || '0 0 * * *'} placeholder="0 0 * * * (Daily at midnight)" required className="bg-slate-900 border-slate-800 font-mono" />
                    </div>
                    <label className="flex items-center gap-3 rounded-lg bg-slate-900 border border-slate-800 px-4 py-3 cursor-pointer">
                      <input type="checkbox" name="enabled" defaultChecked={editingSchedule ? editingSchedule.enabled : true} className="accent-indigo-500 h-4 w-4" />
                      <div>
                        <div className="text-sm font-medium text-slate-200">Enable Schedule</div>
                        <div className="text-[11px] text-slate-500">Uncheck to pause recurring runs</div>
                      </div>
                    </label>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isSubmitting} className="w-full">
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {editingSchedule ? 'Update Schedule' : 'Create Schedule'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {busy ? <Skeleton className="h-48 w-full" /> : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center bg-slate-900/10">
            <CalendarClock className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No schedules configured</p>
            <p className="text-[13px] text-slate-500 mt-1">Schedule recurring simulations via cron expressions linked to templates.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/20 overflow-hidden shadow-xl">
            <Table>
              <TableHeader className="bg-slate-900/50">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Name</TableHead>
                  <TableHead className="text-slate-400">Template</TableHead>
                  <TableHead className="text-slate-400">Cron Pattern</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-right text-slate-400 px-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id} className="border-slate-800 hover:bg-slate-800/30 transition-colors group">
                    <TableCell className="py-4">
                       <div className="font-semibold text-slate-200">{s.name}</div>
                       <div className="text-[11px] text-slate-500 uppercase tracking-tighter mt-0.5">ID: {s.id.slice(0, 8)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                         <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                         <span className="text-sm text-slate-300">{s.template?.name || 'Unknown Template'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[13px] text-slate-400 bg-slate-950/20 px-3 py-1 rounded w-fit">
                      {s.cronExpression}
                    </TableCell>
                    <TableCell>
                      {s.enabled ? (
                        <Badge variant="success" className="animate-pulse-slow">Active</Badge>
                      ) : (
                        <Badge variant="neutral">Paused</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canManage && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-200" onClick={() => { setEditingSchedule(s); setModalOpen(true); }}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-destructive" onClick={() => handleDelete(s.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-400">
                          <PlayCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
