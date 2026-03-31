'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitBranch, ArrowRight, Plus, Trash2, Loader2, Info } from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export default function DependenciesPage() {
  const router = useRouter();
  const { token, loading, user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchDependencies = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await api.listDependencies(token);
      setData(r);
    } catch (err) {
      console.error('Failed to fetch dependencies', err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!loading && !token) router.push('/login');
    fetchDependencies();
  }, [loading, token, router]);

  const handleDelete = async (id: string) => {
    if (!token || !confirm('Are you sure you want to remove this dependency?')) return;
    await api.deleteDependency(token, id);
    fetchDependencies();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const body = {
      fromService: formData.get('fromService') as string,
      toService: formData.get('toService') as string,
      description: formData.get('description') as string,
    };
    
    try {
      await api.createDependency(token, body);
      setModalOpen(false);
      fetchDependencies();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canManage = user?.role === 'admin' || user?.role === 'engineer';

  return (
    <AppShell header={<AppHeader title="Service Dependencies" subtitle="Directed graph of service relationships." userLabel={user?.role ?? 'user'} onLogout={logout} canCreate={false} />}>
      <div className="mx-auto max-w-7xl animate-fade-in px-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-200">System Architecture</h2>
          {canManage && (
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
              <DialogTrigger asChild>
                <Button variant="default" size="sm" className="gap-2 shadow-lg">
                  <Plus className="h-3.5 w-3.5" /> Add Dependency
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-slate-950 border-slate-800">
                <form onSubmit={handleSubmit}>
                  <DialogHeader>
                    <DialogTitle>Define New Relationship</DialogTitle>
                    <DialogDescription>Manually define a service-to-service call path for propagation analysis.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Source Service</span>
                      <Input name="fromService" placeholder="e.g. gateway" required className="bg-slate-900 border-slate-800" />
                    </div>
                    <div className="flex justify-center">
                      <ArrowRight className="h-5 w-5 text-slate-600 rotate-90 sm:rotate-0" />
                    </div>
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Target Service</span>
                      <Input name="toService" placeholder="e.g. auth-service" required className="bg-slate-900 border-slate-800" />
                    </div>
                    <div className="grid gap-2">
                      <span className="text-xs font-medium text-slate-400">Description (Link Type)</span>
                      <Input name="description" placeholder="e.g. gRPC, REST, Async Event" className="bg-slate-900 border-slate-800" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isSubmitting} className="w-full">
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save Dependency
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {busy ? <Skeleton className="h-48 w-full" /> : !data?.edges?.length ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 py-16 text-center bg-slate-900/10">
            <GitBranch className="h-10 w-10 text-slate-600 mb-4" />
            <p className="text-sm text-slate-400 font-medium">No dependency edges defined</p>
            <p className="text-[13px] text-slate-500 mt-1 max-w-sm">Dependencies help the simulator understand how failures propagate through your microservices architecture.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1">
              <Card className="bg-slate-900/30 border-slate-800/60 shadow-lg h-full">
                <CardHeader>
                  <CardTitle className="text-base">Active Services</CardTitle>
                  <CardDescription className="text-xs">Identified from known dependency nodes.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {(data.services ?? []).map((s: string) => (
                      <div key={s} className="rounded-full bg-slate-800/80 border border-slate-700/50 px-3 py-1 text-[12px] font-medium text-slate-300">
                        {s}
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10 flex gap-3 italic">
                    <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-slate-400">Total of {(data.services ?? []).length} logical nodes and {(data.edges ?? []).length} directed edges identified.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <div className="md:col-span-2 space-y-3">
              <h3 className="text-sm font-medium text-slate-400 px-1 mb-2">Relationship Audit</h3>
              {(data.edges ?? []).map((e: any) => (
                <Card key={e.id} className="group bg-slate-900/30 border-slate-800/60 hover:bg-slate-900/50 transition-colors">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="flex flex-col items-center">
                          <div className="text-xs font-bold text-slate-200 bg-slate-800 px-2 py-1 rounded border border-slate-700">{e.fromService}</div>
                       </div>
                       <ArrowRight className="h-4 w-4 text-slate-600" />
                       <div className="flex flex-col items-center">
                          <div className="text-xs font-bold text-slate-200 bg-slate-800 px-2 py-1 rounded border border-slate-700">{e.toService}</div>
                       </div>
                    </div>
                    
                    <div className="flex items-center gap-4 ml-auto">
                      {e.description && <span className="text-[11px] text-slate-500 italic bg-slate-950/40 px-2 py-0.5 rounded">{e.description}</span>}
                      {canManage && (
                        <Button
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleDelete(e.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
