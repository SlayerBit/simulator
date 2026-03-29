import type { ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';

export function AppShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <AppSidebar />
        <section className="flex-1">
          {header}
          <div className="p-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
