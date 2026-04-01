export type UserRole = 'admin' | 'engineer' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export type SimulationState = 
  | 'pending' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'cancelled' 
  | 'rolling_back' 
  | 'rolled_back';

export interface Simulation {
  id: string;
  name: string;
  failureType: string;
  state: SimulationState;
  namespace: string;
  targetService?: string;
  targetDeployment?: string;
  targetPod?: string;
  labelSelector?: string;
  intensity?: string;
  durationSeconds: number;
  dryRun: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  createdById: string;
  createdBy?: User;
}

export interface SimulationStep {
  id: string;
  simulationId: string;
  order: number;
  name: string;
  failureType: string;
  timestamp: string;
  stepType: string;
  status: 'success' | 'failed' | 'running';
  message?: string;
  error?: string;
}

export interface AuditEvent {
  id: string;
  userId?: string;
  user?: User;
  action: string;
  simulationId?: string;
  createdAt: string;
  metadata?: any;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  failureType: string;
  defaultNamespace?: string;
  defaultService?: string;
  defaultIntensity?: string;
  defaultDurationSeconds?: number;
  config?: any;
  createdAt: string;
  schedules?: Schedule[];
}

export interface Schedule {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  templateId?: string;
  template?: Template;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
