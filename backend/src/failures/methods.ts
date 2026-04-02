import { registerFailureMethod } from './registry.js';
import type { FailureMethod, FailureParams, FailureResult } from './types.js';
import { assertSafetyGuards } from '../safety/guards.js';
import {
  deleteNetworkPolicy,
  deletePodsBySelector,
  patchDeploymentTemplate,
  readDeployment,
  readNetworkPolicy,
  replaceDeployment,
  replaceNetworkPolicy,
  scaleDeployment,
  upsertNetworkPolicy,
  listPodsBySelector,
  execCommandInPod,
  type StepRef,
} from '../kubernetes/ops.js';
import { recordSimulationStep } from '../simulations/steps.js';
import { getPrismaClient } from '../database/client.js';

type Snapshot =
  | { kind: 'deployment'; deploymentName: string; namespace: string; body: any }
  | { kind: 'replicas'; deploymentName: string; namespace: string; replicas: number | null }
  | { kind: 'networkpolicy'; policyName: string; namespace: string; body: any | null };

const snapshots = new Map<string, Snapshot>();

function snapKey(simulationId: string, kind: Snapshot['kind'], name: string): string {
  return `${simulationId}:${kind}:${name}`;
}

async function snapshotDeployment(simulationId: string, namespace: string, deploymentName: string): Promise<void> {
  const key = snapKey(simulationId, 'deployment', deploymentName);
  if (snapshots.has(key)) return;
  const current = await readDeployment(namespace, deploymentName);
  snapshots.set(key, { kind: 'deployment', namespace, deploymentName, body: current });

  // Persistence (C-05)
  await getPrismaClient().rollbackEntry.create({
    data: {
      simulationId,
      actionName: 'restore-deployment',
      resourceType: 'deployment',
      resourceName: deploymentName,
      namespace,
      snapshotData: current as any,
    },
  });
}

async function restoreDeployment(simulationId: string, namespace: string, deploymentName: string, ref?: StepRef): Promise<void> {
  const key = snapKey(simulationId, 'deployment', deploymentName);
  const snap = snapshots.get(key);
  if (!snap || snap.kind !== 'deployment') return;
  await replaceDeployment(namespace, deploymentName, snap.body, ref);
  snapshots.delete(key);

  // Persistence (C-05)
  await getPrismaClient().rollbackEntry.updateMany({
    where: { simulationId, actionName: 'restore-deployment', resourceName: deploymentName, namespace },
    data: { status: 'completed', completedAt: new Date() },
  });
}

async function snapshotReplicas(simulationId: string, namespace: string, deploymentName: string): Promise<void> {
  const key = snapKey(simulationId, 'replicas', deploymentName);
  if (snapshots.has(key)) return;
  const current = await readDeployment(namespace, deploymentName);
  const replicas = current?.spec?.replicas ?? null;
  snapshots.set(key, { kind: 'replicas', namespace, deploymentName, replicas });

  // Persistence (C-05)
  await getPrismaClient().rollbackEntry.create({
    data: {
      simulationId,
      actionName: 'restore-replicas',
      resourceType: 'deployment',
      resourceName: deploymentName,
      namespace,
      snapshotData: { replicas } as any,
    },
  });
}

async function restoreReplicas(simulationId: string, namespace: string, deploymentName: string, ref?: StepRef): Promise<void> {
  const key = snapKey(simulationId, 'replicas', deploymentName);
  const snap = snapshots.get(key);
  if (!snap || snap.kind !== 'replicas') return;
  if (typeof snap.replicas === 'number') {
    await scaleDeployment(namespace, deploymentName, snap.replicas, ref);
  }
  snapshots.delete(key);

  // Persistence (C-05)
  await getPrismaClient().rollbackEntry.updateMany({
    where: { simulationId, actionName: 'restore-replicas', resourceName: deploymentName, namespace },
    data: { status: 'completed', completedAt: new Date() },
  });
}

async function snapshotNetworkPolicy(simulationId: string, namespace: string, policyName: string): Promise<void> {
  const key = snapKey(simulationId, 'networkpolicy', policyName);
  if (snapshots.has(key)) return;
  const existing = await readNetworkPolicy(namespace, policyName);
  snapshots.set(key, { kind: 'networkpolicy', namespace, policyName, body: existing });

  // Persistence (C-05)
  await getPrismaClient().rollbackEntry.create({
    data: {
      simulationId,
      actionName: 'restore-networkpolicy',
      resourceType: 'networkpolicy',
      resourceName: policyName,
      namespace,
      snapshotData: existing as any,
    },
  });
}

async function restoreNetworkPolicy(simulationId: string, namespace: string, policyName: string, ref?: StepRef): Promise<void> {
  const key = snapKey(simulationId, 'networkpolicy', policyName);
  const snap = snapshots.get(key);
  if (!snap || snap.kind !== 'networkpolicy') return;
  if (snap.body) {
    await replaceNetworkPolicy(namespace, policyName, snap.body, ref);
  } else {
    await deleteNetworkPolicy(namespace, policyName, ref);
  }
  snapshots.delete(key);

  // Persistence (C-05)
  await getPrismaClient().rollbackEntry.updateMany({
    where: { simulationId, actionName: 'restore-networkpolicy', resourceName: policyName, namespace },
    data: { status: 'completed', completedAt: new Date() },
  });
}

function ensureTargetBasics(p: FailureParams): void {
  if (!p.target.namespace) throw new Error('target.namespace is required');
  const guardInput: any = {
    target: p.target,
    durationSeconds: p.durationSeconds,
  };
  if (typeof p.intensityPercent === 'number') guardInput.intensityPercent = p.intensityPercent;
  if (typeof p.latencyMs === 'number') guardInput.latencyMs = p.latencyMs;
  if (typeof p.packetLossPercent === 'number') guardInput.packetLossPercent = p.packetLossPercent;
  assertSafetyGuards(guardInput);
}

function requireDeployment(p: FailureParams): string {
  if (!p.target.deploymentName) {
    const err: any = new Error('target.deploymentName is required for this method');
    err.status = 400;
    throw err;
  }
  return p.target.deploymentName;
}

function requireLabelSelector(p: FailureParams): string {
  if (!p.target.labelSelector) {
    const err: any = new Error('target.labelSelector is required for this method');
    err.status = 400;
    throw err;
  }
  return p.target.labelSelector;
}

function npName(simulationId: string, suffix: string): string {
  return `sim-${simulationId}-${suffix}`.slice(0, 63);
}

async function ok(message: string): Promise<FailureResult> {
  return { applied: true, message };
}

function selectorToMatchLabels(selector: string): Record<string, string> {
  // Minimal parser: supports comma-separated key=value pairs.
  const labels: Record<string, string> = {};
  for (const part of selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    labels[k.trim()] = v.trim();
  }
  return labels;
}

// 1) Pod / Container Crash
const podCrashDeletePods: FailureMethod = {
  id: 'delete-pods',
  title: 'Delete pods temporarily (controller will recreate)',
  supports: 'pod_crash',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Delete Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would delete pods by selector');
    console.log(`[Failure-Method] Executing delete-pods in namespace ${p.target.namespace} for selector ${p.target.labelSelector}`);
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Deleted ${count} pods`);
  },
  rollback: async () => { },
};

const podCrashScaleToZero: FailureMethod = {
  id: 'scale-to-zero',
  title: 'Scale deployment to 0 briefly (crash-like impact)',
  supports: 'pod_crash',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale to Zero', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale deployment to 0');
    const dep = requireDeployment(p);
    console.log(`[Failure-Method] Executing scale-to-zero for deployment ${dep} in namespace ${p.target.namespace}`);
    await snapshotReplicas(p.simulationId, p.target.namespace, dep);
    await scaleDeployment(p.target.namespace, dep, 0, ref);
    return ok('Scaled to 0');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Replicas', failureType: p.failureType };
    await restoreReplicas(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const podCrashCrashLoopEnv: FailureMethod = {
  id: 'crashloop-env',
  title: 'Inject CRASH_LOOP=1 env var (requires app to honor)',
  supports: 'pod_crash',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject Env', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch deployment env CRASH_LOOP=1');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: {
          template: {
            spec: {
              containers: [{ env: [{ name: 'CRASH_LOOP', value: '1' }] }],
            },
          },
        },
      },
    }, ref);
    return ok('Patched CRASH_LOOP=1');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const podCrashInvalidCommand: FailureMethod = {
  id: 'invalid-command',
  title: 'Patch container command to exit 137 (reversible)',
  supports: 'pod_crash',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Invalid Command', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch command to invalid');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: {
          template: {
            spec: {
              containers: [{ command: ['sh', '-c', 'exit 137'] }],
            },
          },
        },
      },
    }, ref);
    return ok('Patched command to exit 137');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

// 2) Service Unavailability
const svcUnavailableScaleZero: FailureMethod = {
  id: 'scale-to-zero',
  title: 'Scale deployment to 0',
  supports: 'service_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale to Zero', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale to 0');
    const dep = requireDeployment(p);
    await snapshotReplicas(p.simulationId, p.target.namespace, dep);
    await scaleDeployment(p.target.namespace, dep, 0, ref);
    return ok('Scaled to 0');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Replicas', failureType: p.failureType };
    await restoreReplicas(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const svcUnavailableNetpolDenyIngress: FailureMethod = {
  id: 'deny-ingress-netpol',
  title: 'Deny all ingress to pods (NetworkPolicy)',
  supports: 'service_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'deny-ing');
    const ref = { simulationId: p.simulationId, name: 'Deny Ingress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would apply deny-ingress NetworkPolicy');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Ingress'],
        ingress: [],
      },
    }, ref);
    return ok('Applied deny-ingress NetworkPolicy');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'deny-ing'), ref);
  },
};

const svcUnavailableNetpolDenyEgress: FailureMethod = {
  id: 'deny-egress-netpol',
  title: 'Deny all egress from pods (NetworkPolicy)',
  supports: 'service_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'deny-eg');
    const ref = { simulationId: p.simulationId, name: 'Deny Egress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would apply deny-egress NetworkPolicy');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Egress'],
        egress: [],
      },
    }, ref);
    return ok('Applied deny-egress NetworkPolicy');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'deny-eg'), ref);
  },
};

const svcUnavailableRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Delete pods to force restart (transient unavailability)',
  supports: 'service_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

// 3) Database Connection Failure
const dbFailPatchEnvBadUrl: FailureMethod = {
  id: 'bad-db-env',
  title: 'Inject invalid DATABASE_URL env var',
  supports: 'database_connection_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject Bad DB URL', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch DATABASE_URL');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: { template: { spec: { containers: [{ env: [{ name: 'DATABASE_URL', value: 'postgresql://invalid' }] }] } } },
      },
    }, ref);
    return ok('Patched DATABASE_URL to invalid');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const dbFailNetpolDenyEgressAll: FailureMethod = {
  id: 'deny-egress',
  title: 'Block egress (simulates DB unreachable for this app)',
  supports: 'database_connection_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'db-eg');
    const ref = { simulationId: p.simulationId, name: 'Block DB Egress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would apply egress deny policy');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Egress'],
        egress: [],
      },
    }, ref);
    return ok('Applied egress deny NetworkPolicy');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'db-eg'), ref);
  },
};

const dbFailHostAliasPoison: FailureMethod = {
  id: 'poison-dns-hostalias',
  title: 'Poison DB hostname via hostAliases (requires app uses DB_HOST)',
  supports: 'database_connection_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Poison DNS', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch hostAliases for DB_HOST');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/merge-patch+json',
      body: { spec: { template: { spec: { hostAliases: [{ ip: '203.0.113.99', hostnames: ['DB_HOST'] }] } } } },
    }, ref);
    return ok('Injected hostAliases for DB_HOST');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const dbFailRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart app pods (transient DB connection flaps)',
  supports: 'database_connection_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

// 4) Cache Unavailability
const cacheKillPods: FailureMethod = {
  id: 'kill-cache-pods',
  title: 'Kill cache pods (delete pods by selector)',
  supports: 'cache_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Kill Cache Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would delete cache pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Deleted ${count} cache pods`);
  },
  rollback: async () => { },
};

const cacheBlockTraffic: FailureMethod = {
  id: 'deny-egress',
  title: 'Block egress from app (simulates cache unreachable)',
  supports: 'cache_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'cache-eg');
    const ref = { simulationId: p.simulationId, name: 'Block Cache Egress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would apply deny egress');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Egress'],
        egress: [],
      },
    }, ref);
    return ok('Applied deny-egress policy');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'cache-eg'), ref);
  },
};

const cacheInjectLatencyEnv: FailureMethod = {
  id: 'latency-env',
  title: 'Inject CACHE_LATENCY_MS env var (requires app to honor)',
  supports: 'cache_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject Cache Latency', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch CACHE_LATENCY_MS');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: { template: { spec: { containers: [{ env: [{ name: 'CACHE_LATENCY_MS', value: String(p.latencyMs ?? 500) }] }] } } },
      },
    }, ref);
    return ok('Patched CACHE_LATENCY_MS');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const cacheInjectBadEnv: FailureMethod = {
  id: 'bad-cache-env',
  title: 'Inject invalid CACHE_URL env var',
  supports: 'cache_unavailability',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject Bad Cache URL', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch CACHE_URL invalid');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'CACHE_URL', value: 'redis://invalid:6379' }] }] } } } },
    }, ref);
    return ok('Patched CACHE_URL invalid');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

// 5) Network Latency Between Services
const netLatencyEnv: FailureMethod = {
  id: 'inject-latency-env',
  title: 'Inject HTTP_LATENCY_MS env var (requires app to honor)',
  supports: 'network_latency',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    if (!p.latencyMs) {
      const err: any = new Error('latencyMs is required');
      err.status = 400;
      throw err;
    }
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject HTTP Latency', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch HTTP_LATENCY_MS');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    
    // Hard Chaos Attempt: tc netem (Requires CAP_NET_ADMIN)
    try {
        const pods = await listPodsBySelector(p.target.namespace, p.target.labelSelector || `app=${dep}`);
        for (const pod of pods) {
            if (pod.metadata?.name) {
                console.log(`[Simulator:${p.simulationId}] [Chaos] Attempting tc injection on pod ${pod.metadata.name}`);
                const res = await execCommandInPod(p.target.namespace, pod.metadata.name, dep, 
                    ['sh', '-c', `tc qdisc add dev eth0 root netem delay ${p.latencyMs}ms`], ref);
                if (res.code !== 0) {
                    console.warn(`[Simulator:${p.simulationId}] [Chaos] tc injection failed (likely missing CAP_NET_ADMIN): ${res.stderr}`);
                }
            }
        }
    } catch (err) {
        console.warn(`[Simulator:${p.simulationId}] [Chaos] Failed to execute tc injection:`, err);
    }

    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ name: dep, env: [{ name: 'HTTP_LATENCY_MS', value: String(p.latencyMs) }] }] } } } },
    }, ref);
    return ok('Injected HTTP_LATENCY_MS (Soft Chaos) and attempted tc (Hard Chaos)');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    const dep = requireDeployment(p);

    // Rollback Hard Chaos: tc qdisc del
    try {
        const pods = await listPodsBySelector(p.target.namespace, p.target.labelSelector || `app=${dep}`);
        for (const pod of pods) {
            if (pod.metadata?.name) {
                await execCommandInPod(p.target.namespace, pod.metadata.name, dep, 
                    ['sh', '-c', 'tc qdisc del dev eth0 root'], ref);
            }
        }
    } catch (err) { /* ignore rollback errors if pod already gone */ }

    await restoreDeployment(p.simulationId, p.target.namespace, dep, ref);
  },
};

const netLatencyRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (transient latency spike via cold start)',
  supports: 'network_latency',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

const netLatencyDenyEgressBrief: FailureMethod = {
  id: 'deny-egress',
  title: 'Deny egress (simulates upstream timeouts)',
  supports: 'network_latency',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'lat-eg');
    const ref = { simulationId: p.simulationId, name: 'Deny Egress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would deny egress');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Egress'],
        egress: [],
      },
    }, ref);
    return ok('Applied deny-egress');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'lat-eg'), ref);
  },
};

const netLatencyScaleDown: FailureMethod = {
  id: 'scale-down',
  title: 'Scale deployment down to 1 (load-induced latency)',
  supports: 'network_latency',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale Down', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale down to 1');
    await scaleDeployment(p.target.namespace, requireDeployment(p), 1, ref);
    return ok('Scaled to 1');
  },
  rollback: async () => { },
};

// 6) Packet Loss Between Services
const pktLossEnv: FailureMethod = {
  id: 'inject-loss-env',
  title: 'Inject PACKET_LOSS_PERCENT env var (requires app to honor)',
  supports: 'packet_loss',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    if (typeof p.packetLossPercent !== 'number') {
      const err: any = new Error('packetLossPercent is required');
      err.status = 400;
      throw err;
    }
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject Packet Loss', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch PACKET_LOSS_PERCENT');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);

    // Hard Chaos Attempt: tc netem loss (Requires CAP_NET_ADMIN)
    try {
        const pods = await listPodsBySelector(p.target.namespace, p.target.labelSelector || `app=${dep}`);
        for (const pod of pods) {
            if (pod.metadata?.name) {
                console.log(`[Simulator:${p.simulationId}] [Chaos] Attempting tc loss injection on pod ${pod.metadata.name}`);
                const res = await execCommandInPod(p.target.namespace, pod.metadata.name, dep, 
                    ['sh', '-c', `tc qdisc add dev eth0 root netem loss ${p.packetLossPercent}%`], ref);
                if (res.code !== 0) {
                    console.warn(`[Simulator:${p.simulationId}] [Chaos] tc injection failed: ${res.stderr}`);
                }
            }
        }
    } catch (err) { /* ignore */ }

    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ name: dep, env: [{ name: 'PACKET_LOSS_PERCENT', value: String(p.packetLossPercent) }] }] } } } },
    }, ref);
    return ok('Injected PACKET_LOSS_PERCENT (Soft Chaos) and attempted tc (Hard Chaos)');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    const dep = requireDeployment(p);

    // Rollback Hard Chaos
    try {
        const pods = await listPodsBySelector(p.target.namespace, p.target.labelSelector || `app=${dep}`);
        for (const pod of pods) {
            if (pod.metadata?.name) {
                await execCommandInPod(p.target.namespace, pod.metadata.name, dep, 
                    ['sh', '-c', 'tc qdisc del dev eth0 root'], ref);
            }
        }
    } catch (err) { /* ignore */ }

    await restoreDeployment(p.simulationId, p.target.namespace, dep, ref);
  },
};

const pktLossDenyEgress: FailureMethod = {
  id: 'deny-egress',
  title: 'Deny egress (loss-like behavior via timeouts)',
  supports: 'packet_loss',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'loss-eg');
    const ref = { simulationId: p.simulationId, name: 'Deny Egress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would deny egress');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Egress'],
        egress: [],
      },
    }, ref);
    return ok('Applied deny-egress');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'loss-eg'), ref);
  },
};

const pktLossRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (transient connection drops)',
  supports: 'packet_loss',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

const pktLossScaleDown: FailureMethod = {
  id: 'scale-down',
  title: 'Scale down to 1 (saturation resembles loss)',
  supports: 'packet_loss',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale Down', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale to 1');
    await scaleDeployment(p.target.namespace, requireDeployment(p), 1, ref);
    return ok('Scaled to 1');
  },
  rollback: async () => { },
};

// 7) CPU Saturation
const cpuEnvLoop: FailureMethod = {
  id: 'cpu-hog-env',
  title: 'Inject CPU_HOG env knobs (requires app to honor)',
  supports: 'cpu_saturation',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    if (typeof p.intensityPercent !== 'number') {
      const err: any = new Error('intensityPercent is required');
      err.status = 400;
      throw err;
    }
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject CPU Hog', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch CPU_HOG');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);

    // Hard Chaos: Patch CPU limits based on intensity
    // map intensity 0-100 to cpu limits. e.g. 80% intensity -> limit 20% of current or fixed low.
    // Simplifying: If intensity > 50, set limit to 100m.
    const cpuLimit = p.intensityPercent && p.intensityPercent > 70 ? '100m' : '500m';

    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: dep, // Assume container name matches deployment
                  resources: {
                    limits: { cpu: cpuLimit },
                    requests: { cpu: '10m' }
                  },
                  env: [
                    { name: 'CPU_HOG', value: '1' },
                    { name: 'CPU_HOG_INTENSITY', value: String(p.intensityPercent) },
                  ],
                },
              ],
            },
          },
        },
      },
    }, ref);
    return ok('Injected CPU_HOG');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const cpuRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (CPU spike via warmup)',
  supports: 'cpu_saturation',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

const cpuScaleDown: FailureMethod = {
  id: 'scale-down',
  title: 'Scale down to 1 (CPU saturation under load)',
  supports: 'cpu_saturation',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale Down', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale down');
    await scaleDeployment(p.target.namespace, requireDeployment(p), 1, ref);
    return ok('Scaled down');
  },
  rollback: async () => { },
};

const cpuTightLoopCommand: FailureMethod = {
  id: 'tight-loop-command',
  title: 'Patch command to tight loop (reversible)',
  supports: 'cpu_saturation',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Tight Loop', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch command to tight loop');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ command: ['sh', '-c', 'while true; do :; done'] }] } } } },
    }, ref);
    return ok('Patched command to tight loop');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

// 8) Memory Pressure
const memEnvLeak: FailureMethod = {
  id: 'memory-leak-env',
  title: 'Inject MEMORY_LEAK=1 env var (requires app to honor)',
  supports: 'memory_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    if (typeof p.intensityPercent !== 'number') {
      const err: any = new Error('intensityPercent is required');
      err.status = 400;
      throw err;
    }
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Inject Mem Leak', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch MEMORY_LEAK');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'MEMORY_LEAK', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected MEMORY_LEAK');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const memPatchLimitsDown: FailureMethod = {
  id: 'reduce-memory-limits',
  title: 'Reduce memory limits (may trigger OOM, reversible)',
  supports: 'memory_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Reduce Mem Limits', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch resources.limits.memory');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ resources: { limits: { memory: '64Mi' } } }] } } } },
    }, ref);
    return ok('Reduced memory limit to 64Mi');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const memRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (memory pressure via cache warmup)',
  supports: 'memory_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

const memAllocateMemoryCommand: FailureMethod = {
  id: 'allocate-memory-loop',
  title: 'Patch command to allocate memory (reversible)',
  supports: 'memory_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Alloc Memory', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch memory allocation loop');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  command: [
                    'sh',
                    '-c',
                    'node -e \"const a=[]; setInterval(()=>a.push(\\\"x\\\".repeat(1024*1024)), 10)\"',
                  ],
                },
              ],
            },
          },
        },
      },
    }, ref);
    return ok('Patched command to allocate memory');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

// 9) Disk Pressure
const diskFillEnv: FailureMethod = {
  id: 'disk-fill-env',
  title: 'Inject DISK_FILL_MB env var (requires app to honor)',
  supports: 'disk_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Fill Disk', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch DISK_FILL_MB');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'DISK_FILL_MB', value: '500' }] }] } } } },
    }, ref);
    return ok('Injected DISK_FILL_MB');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const diskLogExplosionEnv: FailureMethod = {
  id: 'log-explosion-env',
  title: 'Inject LOG_EXPLOSION=1 env var (requires app to honor)',
  supports: 'disk_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Log Explosion', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch LOG_EXPLOSION');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'LOG_EXPLOSION', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected LOG_EXPLOSION');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const diskReduceEphemeral: FailureMethod = {
  id: 'reduce-ephemeral',
  title: 'Reduce ephemeral storage request (reversible, may cause eviction)',
  supports: 'disk_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Reduce Disk', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch ephemeral-storage requests');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: { template: { spec: { containers: [{ resources: { requests: { 'ephemeral-storage': '1Mi' } } }] } } },
      },
    }, ref);
    return ok('Reduced ephemeral-storage requests');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const diskRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (disk IO spike from rehydration)',
  supports: 'disk_pressure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

// 10) Deployment Misconfiguration
const misconfigBadEnv: FailureMethod = {
  id: 'bad-env',
  title: 'Inject wrong env vars (reversible)',
  supports: 'deployment_misconfiguration',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Bad Env', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch MISCONFIG=1');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'MISCONFIG', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected MISCONFIG=1');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const misconfigBadPort: FailureMethod = {
  id: 'bad-port',
  title: 'Patch container port to wrong value (reversible)',
  supports: 'deployment_misconfiguration',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Bad Port', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch containerPort');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ ports: [{ containerPort: 6553 }] }] } } } },
    }, ref);
    return ok('Patched containerPort');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const misconfigRemoveEnv: FailureMethod = {
  id: 'remove-env',
  title: 'Remove env block (reversible)',
  supports: 'deployment_misconfiguration',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Remove Env', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would remove env');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [] }] } } } },
    }, ref);
    return ok('Cleared env');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const misconfigRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods to simulate misconfig rollout',
  supports: 'deployment_misconfiguration',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

// 11) Auto-scaling Failure
const autoscalingScaleZero: FailureMethod = {
  id: 'scale-to-zero',
  title: 'Scale to 0 (simulates autoscaling failure)',
  supports: 'autoscaling_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale to Zero', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale to 0');
    const dep = requireDeployment(p);
    await snapshotReplicas(p.simulationId, p.target.namespace, dep);
    await scaleDeployment(p.target.namespace, dep, 0, ref);
    return ok('Scaled to 0');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Replicas', failureType: p.failureType };
    await restoreReplicas(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const autoscalingScaleDown: FailureMethod = {
  id: 'scale-down',
  title: 'Scale down to 1',
  supports: 'autoscaling_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale Down', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale to 1');
    await scaleDeployment(p.target.namespace, requireDeployment(p), 1, ref);
    return ok('Scaled to 1');
  },
  rollback: async () => { },
};

const autoscalingRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (mimics scaling instability)',
  supports: 'autoscaling_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

const autoscalingBadEnv: FailureMethod = {
  id: 'disable-scaling-env',
  title: 'Inject DISABLE_SCALING=1 env (requires platform to honor)',
  supports: 'autoscaling_failure',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Disable Scaling', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch DISABLE_SCALING');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'DISABLE_SCALING', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected DISABLE_SCALING');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

// 12) Failing Health Probes
const probesFailReadiness: FailureMethod = {
  id: 'fail-readiness',
  title: 'Inject READINESS_FAIL=1 env (requires app to honor)',
  supports: 'failing_health_probes',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Fail Readiness', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch READINESS_FAIL');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'READINESS_FAIL', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected READINESS_FAIL');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const probesFailLiveness: FailureMethod = {
  id: 'fail-liveness',
  title: 'Inject LIVENESS_FAIL=1 env (requires app to honor)',
  supports: 'failing_health_probes',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Fail Liveness', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch LIVENESS_FAIL');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'LIVENESS_FAIL', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected LIVENESS_FAIL');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const probesDelayEnv: FailureMethod = {
  id: 'delay-probes',
  title: 'Inject PROBE_DELAY_MS env (requires app to honor)',
  supports: 'failing_health_probes',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Delay Probes', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch PROBE_DELAY_MS');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'PROBE_DELAY_MS', value: String(p.latencyMs ?? 1000) }] }] } } } },
    }, ref);
    return ok('Injected PROBE_DELAY_MS');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const probesInvalidEndpointEnv: FailureMethod = {
  id: 'invalid-probe-endpoint',
  title: 'Inject PROBE_ENDPOINT_OVERRIDE env (requires app to honor)',
  supports: 'failing_health_probes',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Invalid Probe URL', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch PROBE_ENDPOINT_OVERRIDE');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'PROBE_ENDPOINT_OVERRIDE', value: '/__invalid' }] }] } } } },
    }, ref);
    return ok('Injected PROBE_ENDPOINT_OVERRIDE');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

// 13) Ingress Misrouting
const ingressMisrouteEnv: FailureMethod = {
  id: 'misroute-env',
  title: 'Inject INGRESS_MISROUTE=1 env (requires app/ingress to honor)',
  supports: 'ingress_misrouting',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Misroute Env', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would patch INGRESS_MISROUTE');
    const dep = requireDeployment(p);
    await snapshotDeployment(p.simulationId, p.target.namespace, dep);
    await patchDeploymentTemplate(p.target.namespace, dep, {
      contentType: 'application/strategic-merge-patch+json',
      body: { spec: { template: { spec: { containers: [{ env: [{ name: 'INGRESS_MISROUTE', value: '1' }] }] } } } },
    }, ref);
    return ok('Injected INGRESS_MISROUTE');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Deployment', failureType: p.failureType };
    await restoreDeployment(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const ingressMisrouteScaleZero: FailureMethod = {
  id: 'scale-to-zero',
  title: 'Scale deployment to 0 (ingress will route to nothing)',
  supports: 'ingress_misrouting',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireDeployment(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Scale to Zero', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would scale to 0');
    const dep = requireDeployment(p);
    await snapshotReplicas(p.simulationId, p.target.namespace, dep);
    await scaleDeployment(p.target.namespace, dep, 0, ref);
    return ok('Scaled to 0');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore Replicas', failureType: p.failureType };
    await restoreReplicas(p.simulationId, p.target.namespace, requireDeployment(p), ref);
  },
};

const ingressMisrouteDenyIngress: FailureMethod = {
  id: 'deny-ingress',
  title: 'Deny ingress to backend pods (ingress returns errors)',
  supports: 'ingress_misrouting',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const selector = requireLabelSelector(p);
    const name = npName(p.simulationId, 'ing-deny');
    const ref = { simulationId: p.simulationId, name: 'Deny Ingress', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would deny ingress to pods');
    await snapshotNetworkPolicy(p.simulationId, p.target.namespace, name);
    await upsertNetworkPolicy(p.target.namespace, name, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name, namespace: p.target.namespace },
      spec: {
        podSelector: { matchLabels: selectorToMatchLabels(selector) },
        policyTypes: ['Ingress'],
        ingress: [],
      },
    }, ref);
    return ok('Denied ingress');
  },
  rollback: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restore NetPol', failureType: p.failureType };
    await restoreNetworkPolicy(p.simulationId, p.target.namespace, npName(p.simulationId, 'ing-deny'), ref);
  },
};

const ingressMisrouteRestartPods: FailureMethod = {
  id: 'restart-pods',
  title: 'Restart pods (brief 502/504s via restart)',
  supports: 'ingress_misrouting',
  validate: async (p) => {
    ensureTargetBasics(p);
    requireLabelSelector(p);
    await recordSimulationStep({
      simulationId: p.simulationId,
      name: 'Validation',
      failureType: p.failureType,
      stepType: 'validation',
      status: 'success',
      message: 'Validation passed',
    });
  },
  apply: async (p) => {
    const ref = { simulationId: p.simulationId, name: 'Restart Pods', failureType: p.failureType };
    if (p.dryRun) return ok('Dry-run: would restart pods');
    const count = await deletePodsBySelector(p.target.namespace, requireLabelSelector(p), ref);
    return ok(`Restarted ${count} pods`);
  },
  rollback: async () => { },
};

export function registerAllFailureMethods(): void {
  const all: FailureMethod[] = [
    // pod_crash
    podCrashDeletePods,
    podCrashScaleToZero,
    podCrashCrashLoopEnv,
    podCrashInvalidCommand,

    // service_unavailability
    svcUnavailableScaleZero,
    svcUnavailableNetpolDenyIngress,
    svcUnavailableNetpolDenyEgress,
    svcUnavailableRestartPods,

    // database_connection_failure
    dbFailPatchEnvBadUrl,
    dbFailNetpolDenyEgressAll,
    dbFailHostAliasPoison,
    dbFailRestartPods,

    // cache_unavailability
    cacheKillPods,
    cacheBlockTraffic,
    cacheInjectLatencyEnv,
    cacheInjectBadEnv,

    // network_latency
    netLatencyEnv,
    netLatencyRestartPods,
    netLatencyDenyEgressBrief,
    netLatencyScaleDown,

    // packet_loss
    pktLossEnv,
    pktLossDenyEgress,
    pktLossRestartPods,
    pktLossScaleDown,

    // cpu_saturation
    cpuEnvLoop,
    cpuRestartPods,
    cpuScaleDown,
    cpuTightLoopCommand,

    // memory_pressure
    memEnvLeak,
    memPatchLimitsDown,
    memRestartPods,
    memAllocateMemoryCommand,

    // disk_pressure
    diskFillEnv,
    diskLogExplosionEnv,
    diskReduceEphemeral,
    diskRestartPods,

    // deployment_misconfiguration
    misconfigBadEnv,
    misconfigBadPort,
    misconfigRemoveEnv,
    misconfigRestartPods,

    // autoscaling_failure
    autoscalingScaleZero,
    autoscalingScaleDown,
    autoscalingRestartPods,
    autoscalingBadEnv,

    // failing_health_probes
    probesFailReadiness,
    probesFailLiveness,
    probesDelayEnv,
    probesInvalidEndpointEnv,

    // ingress_misrouting
    ingressMisrouteEnv,
    ingressMisrouteScaleZero,
    ingressMisrouteDenyIngress,
    ingressMisrouteRestartPods,
  ];

  for (const m of all) registerFailureMethod(m);
}
