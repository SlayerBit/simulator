'use client';

import { Bell, Plus, UserRound, LogOut, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeSwitcher } from '@/components/layout/theme-switcher';
import { MobileNav } from '@/components/layout/mobile-nav';
import { useNotifications } from '@/components/providers/notification-provider';

export function AppHeader({
  title,
  subtitle,
  userLabel,
  onLogout,
  canCreate,
}: {
  title: string;
  subtitle: string;
  userLabel: string;
  onLogout: () => void;
  canCreate: boolean;
}) {
  const router = useRouter();
  const { notifications, unread, markAllRead } = useNotifications();
  const routeFor = (type: string, simulationId?: string, runbookId?: string) => {
    if (type === 'agent1_triggered' && simulationId) return `/simulations/${simulationId}`;
    if ((type === 'runbook_generated' || type === 'runbook_sent_redis') && runbookId) return `/runbooks/${runbookId}`;
    if (type === 'agent2_runbook_received' || type === 'agent2_executed') return '/agent-activity';
    if (type === 'recovery_successful' && simulationId) return `/simulations/${simulationId}`;
    return null;
  };
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <MobileNav />
          <div className="animate-fade-in group">
            <h1 className="text-xl font-semibold text-foreground tracking-tight flex items-center gap-2">
              {title}
            </h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push('/simulations/new')}
              className="bg-primary text-primary-foreground border-0 hover:brightness-110 shadow-md shadow-primary/20 transition-all duration-200"
            >
              <Plus className="h-3.5 w-3.5" /> New Simulation
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="relative text-muted-foreground hover:text-foreground">
                <Bell className="h-4 w-4" />
                {unread > 0 ? <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" /> : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[420px] p-0">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm font-semibold">Notifications</p>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllRead}>
                  Mark all read
                </Button>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-2">
                {notifications.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-muted-foreground">No notifications yet.</p>
                ) : (
                  notifications.slice(0, 40).map((n) => {
                    const to = routeFor(n.type, n.simulation_id, n.runbook_id);
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (to) router.push(to);
                        }}
                        className="mb-1 w-full rounded-md border px-3 py-2 text-left transition hover:bg-muted/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{n.title}</p>
                          <span className="text-[10px] text-muted-foreground">{new Date(n.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          status: {n.status} | sim: {n.simulation_id ?? 'n/a'} {n.runbook_id ? `| runbook: ${n.runbook_id}` : ''}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-border/60">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                  <UserRound className="h-3 w-3 text-primary" />
                </div>
                <span className="text-muted-foreground text-xs font-medium">{userLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push('/grafana')} className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" /> Observability
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="gap-2 text-destructive focus:text-destructive">
                <LogOut className="h-3.5 w-3.5" /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
