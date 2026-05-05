import './globals.css';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { NotificationProvider } from '@/components/providers/notification-provider';

export const metadata = {
  title: 'Cloud Failure Simulator',
  description: 'Safe, reversible failure simulation and recovery training for cloud infrastructure.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/30">
        <AuthProvider>
          <ThemeProvider>
            <NotificationProvider>{children}</NotificationProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
