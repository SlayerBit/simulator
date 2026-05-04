'use client';

import React, { useState } from 'react';
import { Menu, Zap, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Activity, CalendarClock, FileClock, FileText, GitBranch, LayoutDashboard, Shield } from 'lucide-react';

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

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="md:hidden">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="px-2">
            <Menu className="h-5 w-5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-slate-950 border-slate-800 p-0 sm:max-w-xs h-full flex flex-col justify-start">
          <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-800">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground tracking-tight">Cloud Simulator</div>
              <div className="text-[11px] text-muted-foreground">Control Plane</div>
            </div>
          </div>
          
          <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-2">
            {items.map((item) => {
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <button
                  key={item.href}
                  className={cn(
                    'group flex w-full items-center gap-4 rounded-lg px-4 py-3 text-[14px] font-medium transition-all duration-200',
                    active
                      ? 'bg-primary/10 text-primary shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => {
                    router.push(item.href);
                    setOpen(false);
                  }}
                >
                  <item.icon
                    className={cn(
                      'h-5 w-5 transition-colors duration-200',
                      active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                    )}
                  />
                  {item.label}
                  {active && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </button>
              );
            })}
          </nav>
          
          <div className="border-t border-slate-800 p-4 mt-auto">
            <div className="rounded-lg bg-slate-900/50 px-4 py-3 text-[11px] text-slate-500">
              <span className="text-slate-300 font-medium">v1.0.0</span> · Production Environment
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
