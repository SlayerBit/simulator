'use client';

import { Bell, Plus, UserRound, LogOut, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeSwitcher } from '@/components/layout/theme-switcher';
import { MobileNav } from '@/components/layout/mobile-nav';

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
          <Button variant="ghost" size="sm" className="relative text-muted-foreground hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
          </Button>
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
