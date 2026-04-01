'use client';

import React, { createContext, useCallback, useEffect, useMemo, useState, useContext } from 'react';
import { api } from '@/services/api';

type UserRole = 'admin' | 'engineer' | 'viewer';
type User = { id: string; email: string; role: UserRole };

const TOKEN_KEY = 'simulator_token';

export interface AuthContextType {
  token: string | null;
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, role?: UserRole) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize from localStorage
  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    if (t) {
      setToken(t);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const res = await api.me(token);
      setUser(res.authenticated ? (res.user as User) : null);
    } catch (e) {
      console.error('Failed to refresh user profile', e);
      setUser(null);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void refresh();
    }
  }, [token, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, role?: UserRole) => {
    const body: any = { email, password };
    if (role) body.role = role;
    const res = await api.signup(body);
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, login, signup, logout, refresh }),
    [token, user, loading, login, signup, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
