export type ApiError = {
  message: string;
  status?: number;
  details?: unknown;
};

export function getApiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return '';
  return base.replace(/\/+$/, '');
}

async function request<T>(path: string, opts: RequestInit & { token?: string } = {}): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(opts.headers || {});
  headers.set('Content-Type', 'application/json');
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = {
      message: data?.error?.message || data?.message || 'Request failed',
      status: res.status,
      details: data?.error?.details,
    };
    throw err;
  }
  return data as T;
}

export const api = {
  signup: (body: { email: string; password: string; role?: 'admin' | 'engineer' | 'viewer' }) =>
    request<{ user: any; token: string }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: any; token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: (token: string) => request<{ authenticated: boolean; user?: any }>('/api/auth/me', { method: 'GET', token }),
  listSimulations: (token: string) => request<{ simulations: any[] }>('/api/simulations', { method: 'GET', token }),
  createSimulation: (token: string, body: any) =>
    request<{ simulation: any }>('/api/simulations', { method: 'POST', token, body: JSON.stringify(body) }),
  stopSimulation: (token: string, id: string) =>
    request<{ id: string; status: string }>(`/api/simulations/${id}/stop`, { method: 'POST', token }),
  getSimulation: (token: string, id: string) =>
    request<any>(`/api/simulations/${id}`, { method: 'GET', token }),
  templates: (token: string) => request<{ templates: any[] }>('/api/templates', { method: 'GET', token }),
  runTemplate: (token: string, id: string) => request<{ simulation: any }>(`/api/templates/${id}/run`, { method: 'POST', token }),
  schedules: (token: string) => request<{ schedules: any[] }>('/api/schedules', { method: 'GET', token }),
  audit: (token: string) => request<{ events: any[] }>('/api/audit', { method: 'GET', token }),
  dependencies: (token: string) => request<any>('/api/dependencies', { method: 'GET', token }),
  metrics: (token: string) => request<any>('/api/metrics', { method: 'GET', token }),
};

