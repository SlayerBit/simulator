export type ApiError = {
  message: string;
  status?: number;
  details?: unknown;
};

const TOKEN_KEY = 'simulator_token';

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
}

async function request<T>(path: string, opts: RequestInit & { token?: string } = {}): Promise<T> {
  // If the path already has /api, don't double prefix it.
  const cleanPath = path.startsWith('/api') ? path.substring(4) : path;
  const url = `${getApiBaseUrl()}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`;
  const headers = new Headers(opts.headers || {});
  headers.set('Content-Type', 'application/json');
  
  if (opts.token) {
    headers.set('Authorization', `Bearer ${opts.token}`);
  }

  const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
  
  // 401 Handling
  if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/login')) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login?expired=true';
    throw new Error('Session expired');
  }

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

  // Simulations
  listSimulations: (token: string) => request<{ simulations: any[] }>('/api/simulations', { method: 'GET', token }),
  createSimulation: (token: string, body: any) =>
    request<{ simulation: any }>('/api/simulations', { method: 'POST', token, body: JSON.stringify(body) }),
  stopSimulation: (token: string, id: string) =>
    request<{ id: string; status: string }>(`/api/simulations/${id}/stop`, { method: 'POST', token }),
  getSimulation: (token: string, id: string) =>
    request<any>(`/api/simulations/${id}`, { method: 'GET', token }),
  retrySimulation: (token: string, id: string) =>
    request<{ simulation: any }>(`/api/simulations/${id}/retry`, { method: 'POST', token }),

  // Templates
  listTemplates: (token: string) => request<{ templates: any[] }>('/api/templates', { method: 'GET', token }),
  getTemplate: (token: string, id: string) => request<{ template: any }>(`/api/templates/${id}`, { method: 'GET', token }),
  createTemplate: (token: string, body: any) =>
    request<{ template: any }>('/api/templates', { method: 'POST', token, body: JSON.stringify(body) }),
  updateTemplate: (token: string, id: string, body: any) =>
    request<{ template: any }>(`/api/templates/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
  deleteTemplate: (token: string, id: string) =>
    request<void>(`/api/templates/${id}`, { method: 'DELETE', token }),
  runTemplate: (token: string, id: string) => 
    request<{ simulation: any }>(`/api/templates/${id}/run`, { method: 'POST', token }),

  // Schedules
  listSchedules: (token: string) => request<{ schedules: any[] }>('/api/schedules', { method: 'GET', token }),
  createSchedule: (token: string, body: any) =>
    request<{ schedule: any }>('/api/schedules', { method: 'POST', token, body: JSON.stringify(body) }),
  updateSchedule: (token: string, id: string, body: any) =>
    request<{ schedule: any }>(`/api/schedules/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
  deleteSchedule: (token: string, id: string) =>
    request<void>(`/api/schedules/${id}`, { method: 'DELETE', token }),

  // Dependencies
  listDependencies: (token: string) => request<{ services: string[]; edges: any[] }>('/api/dependencies', { method: 'GET', token }),
  createDependency: (token: string, body: { fromService: string; toService: string; description?: string }) =>
    request<{ edge: any }>('/api/dependencies', { method: 'POST', token, body: JSON.stringify(body) }),
  deleteDependency: (token: string, id: string) =>
    request<void>(`/api/dependencies/${id}`, { method: 'DELETE', token }),

  // Analytics & Observability
  audit: (token: string) => request<{ events: any[] }>('/api/audit', { method: 'GET', token }),
  metrics: (token: string) => request<any>('/api/metrics', { method: 'GET', token }),
};

