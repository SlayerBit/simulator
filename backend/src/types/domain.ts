export type UserRole = 'admin' | 'engineer' | 'viewer';

export type ExperimentState =
  | 'draft'
  | 'scheduled'
  | 'pending'
  | 'queued'
  | 'running'
  | 'failure_active'
  | 'completed'
  | 'failed'
  | 'rollback_pending'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_failed'
  | 'partial_rollback'
  | 'cancelled';

export type FailureType =
  | 'pod_crash'
  | 'service_unavailability'
  | 'network_failure'
  | 'resource_pressure'
  | 'rollout_failure'
  | 'database_connection_failure'
  | 'cache_unavailability'
  | 'network_latency'
  | 'packet_loss'
  | 'cpu_saturation'
  | 'memory_pressure'
  | 'disk_pressure'
  | 'deployment_misconfiguration'
  | 'autoscaling_failure'
  | 'failing_health_probes'
  | 'ingress_misrouting';

export interface UserIdentity {
  id: string;
  email: string;
  role: UserRole;
}

export interface SimulationTarget {
  namespace: string;
  serviceName?: string | undefined;
  deploymentName?: string | undefined;
  podName?: string | undefined;
  labelSelector?: string | undefined;
}

export interface SimulationLimits {
  maxConcurrentSimulations: number;
  maxDurationSeconds: number;
}
