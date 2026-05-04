'use client';

import { Activity, CalendarClock, FileClock, FileText, GitBranch, LayoutDashboard, Zap, Shield } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/simulations/new', label: 'New Simulation', icon: Zap },
  { href: '/history', label: 'History', icon: FileClock },
  { href: '/runbooks', label: 'Runbooks', icon: FileText },
  { href: '/audit', label: 'Audit Log', icon: FileText },
  { href: '/templates', label: 'Templates', icon: Activity },
  { href: '/schedules', label: 'Schedules', icon: CalendarClock },
  { href: '/dependencies', label: 'Dependencies', icon: GitBranch },
  { href: '/grafana', label: 'Observability', icon: Shield },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-gradient-to-b from-background to-muted/20">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <Zap className="h-4.5 w-4.5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground tracking-tight">Cloud Simulator</div>
          <div className="text-[11px] text-muted-foreground">Control Plane</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-2 pb-2 text-[11px] uppercase tracking-widest text-muted-foreground font-medium">Navigation</div>
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <button
              key={item.href}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                active
                  ? 'bg-primary/10 text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => router.push(item.href)}
            >
              <item.icon
                className={cn(
                  'h-4 w-4 transition-colors duration-200',
                  active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                )}
              />
              {item.label}
              {active && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
          <span className="text-foreground font-medium">v1.0.0</span> · Production
        </div>
      </div>
    </aside>
  );
}
