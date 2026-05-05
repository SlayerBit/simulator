import type { FailureType } from '../types/domain.js';

/**
 * Strict UI + API allowlist: exactly 10 selectable (failureType, methodId) pairs.
 * All other registered methods remain in the backend for replay/audit compatibility
 * but must not be returned from public meta or accepted for new runs.
 */
export const VISIBLE_FAILURE_METHOD_KEYS = [
  'pod_crash:delete-pods',
  'pod_crash:scale-to-zero',
  'service_unavailability:scale-to-zero',
  'service_unavailability:scale-down',
  'network_failure:deny-ingress',
  'network_failure:deny-egress',
  'resource_pressure:reduce-memory-limits',
  'resource_pressure:update-cpu-resources',
  'ingress_misrouting:scale-to-zero',
  'rollout_failure:restart-deployment',
  'rollout_failure:invalid-command',
] as const;

export type VisibleFailureMethodKey = (typeof VISIBLE_FAILURE_METHOD_KEYS)[number];

const visibleSet = new Set<string>(VISIBLE_FAILURE_METHOD_KEYS);

export function isVisibleFailureMethod(failureType: string, methodId: string): boolean {
  return visibleSet.has(`${failureType}:${methodId}`);
}

export function assertVisibleFailureMethod(failureType: FailureType | string, methodId: string): void {
  if (!isVisibleFailureMethod(failureType, methodId)) {
    const err: any = new Error(
      `Failure method is not on the production allowlist: ${failureType}/${methodId}`
    );
    err.status = 400;
    throw err;
  }
}

export function templateIsAllowlisted(t: { failureType: string; config: unknown }): boolean {
  const method = (t.config as any)?.method;
  if (!method || typeof method !== 'string') return false;
  return isVisibleFailureMethod(t.failureType, method);
}
