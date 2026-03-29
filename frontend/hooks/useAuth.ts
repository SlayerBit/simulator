'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/services/api';

type UserRole = 'admin' | 'engineer' | 'viewer';
type User = { id: string; email: string; role: UserRole };

const TOKEN_KEY = 'simulator_token';

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    setToken(t);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) {
      setUser(null);
      return;
    }
    const res = await api.me(token);
    setUser(res.authenticated ? (res.user as User) : null);
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return useMemo(
    () => ({ token, user, loading, login, signup, logout, refresh }),
    [token, user, loading, login, signup, logout, refresh],
  );
}

