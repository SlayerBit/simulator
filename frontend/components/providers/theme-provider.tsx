'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
type Accent = 'purple' | 'blue' | 'green' | 'orange' | 'red' | 'teal';

interface ThemeProviderState {
  theme: Theme;
  accent: Accent;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [accent, setAccent] = useState<Accent>('purple');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Load persisted preferences
    const storedTheme = localStorage.getItem('simulator-theme') as Theme;
    const storedAccent = localStorage.getItem('simulator-accent') as Accent;
    
    if (storedTheme) setTheme(storedTheme);
    if (storedAccent) setAccent(storedAccent);
    
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('simulator-theme', theme);
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    
    const root = document.documentElement;
    root.setAttribute('data-accent', accent);
    localStorage.setItem('simulator-accent', accent);
  }, [accent, mounted]);

  // Prevent hydration mismatch by blocking render until loaded, or just passing context gracefully
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeProviderContext.Provider value={{ theme, accent, setTheme, setAccent }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    // Return graceful defaults if not strictly inside provider yet during hydration
    return {
      theme: 'dark' as Theme,
      accent: 'purple' as Accent,
      setTheme: () => null,
      setAccent: () => null,
    };
  }
  return context;
};
