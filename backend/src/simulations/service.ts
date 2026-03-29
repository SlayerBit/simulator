import { nanoid } from 'nanoid';
import { getPrismaClient } from '../database/client.js';
import type { ExperimentState, FailureType, SimulationTarget, UserIdentity } from '../types/domain.js';
import { findFailureMethod } from '../failures/registry.js';
import type { FailureParams } from '../failures/types.js';
import { RollbackStack } from '../recovery/rollback.js';
import { countActiveRuns, endActiveRun, getActiveRun, registerActiveRun } from './active-runs.js';
import { loadConfig } from '../config/env.js';

export interface CreateSimulationInput {
  name: string;
  failureType: FailureType;
  method: string;
  target: SimulationTarget;
  durationSeconds: number;
  intensityPercent?: number | undefined;
  latencyMs?: number | undefined;
  packetLossPercent?: number | undefined;
  dryRun: boolean;
}

export async function createSimulationRecord(user: UserIdentity, input: CreateSimulationInput) {
  const prisma = getPrismaClient();
  const sim = await prisma.simulation.create({
    data: {
      name: input.name,
      failureType: input.failureType,
      state: 'pending',
      namespace: input.target.namespace,
      targetService: input.target.serviceName ?? null,
      targetDeployment: input.target.deploymentName ?? null,
      targetPod: input.target.podName ?? null,
      labelSelector: input.target.labelSelector ?? null,
      intensity: input.intensityPercent != null ? String(input.intensityPercent) : input.latencyMs != null ? `${input.latencyMs}ms` : null,
      durationSeconds: input.durationSeconds,
      dryRun: input.dryRun,
      createdById: user.id,
    },
  });

  await prisma.failureEvent.create({
    data: {
      simulationId: sim.id,
      method: input.method,
      state: 'pending',
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'simulation.created',
      simulationId: sim.id,
      metadata: {
        failureType: input.failureType,
        method: input.method,
        target: {
          namespace: input.target.namespace,
          ...(input.target.serviceName ? { serviceName: input.target.serviceName } : {}),
          ...(input.target.deploymentName ? { deploymentName: input.target.deploymentName } : {}),
          ...(input.target.podName ? { podName: input.target.podName } : {}),
          ...(input.target.labelSelector ? { labelSelector: input.target.labelSelector } : {}),
        },
        durationSeconds: input.durationSeconds,
        ...(typeof input.intensityPercent === 'number' ? { intensityPercent: input.intensityPercent } : {}),
        ...(typeof input.latencyMs === 'number' ? { latencyMs: input.latencyMs } : {}),
        ...(typeof input.packetLossPercent === 'number' ? { packetLossPercent: input.packetLossPercent } : {}),
        dryRun: input.dryRun,
      } as any,
    },
  });

  return sim;
}

export async function runSimulation(simulationId: string): Promise<void> {
  const prisma = getPrismaClient();
  const config = loadConfig();
  if (config.globalKillSwitch) {
    const err: any = new Error('Global kill switch is enabled');
    err.status = 400;
    throw err;
  }

  const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!sim) throw new Error('Simulation not found');
  if (sim.state === 'running') return;

  const runningCount = await prisma.simulation.count({ where: { state: 'running' } as any });
  if (runningCount + countActiveRuns() >= config.maxConcurrentSimulations) {
    const err: any = new Error('Maximum concurrent simulations reached');
    err.status = 429;
    throw err;
  }

  const rollback = new RollbackStack();
  const activeRun = registerActiveRun(simulationId);
  const signal = activeRun.controller.signal;
  const startedAtMs = Date.now();

  await prisma.simulation.update({
    where: { id: simulationId },
    data: { state: 'running', startedAt: new Date() },
  });

  const ev = await prisma.failureEvent.findFirst({ where: { simulationId } });
  const methodId = ev?.method ?? 'unknown';

  const failureMethod = findFailureMethod(sim.failureType as FailureType, methodId);

  const target: any = { namespace: sim.namespace };
  if (sim.targetService) target.serviceName = sim.targetService;
  if (sim.targetDeployment) target.deploymentName = sim.targetDeployment;
  if (sim.targetPod) target.podName = sim.targetPod;
  if (sim.labelSelector) target.labelSelector = sim.labelSelector;

  const params: FailureParams = {
    failureType: sim.failureType as FailureType,
    method: methodId,
    target,
    durationSeconds: sim.durationSeconds,
    intensityPercent: parseIntensity(sim.intensity),
    latencyMs: parseLatency(sim.intensity),
    packetLossPercent: parsePacketLoss(sim.intensity),
    dryRun: sim.dryRun,
    simulationId: sim.id,
  };

  failureMethod.validate(params);

  rollback.push({
    name: `rollback:${failureMethod.supports}:${failureMethod.id}`,
    run: async () => failureMethod.rollback(params),
  });

  if (sim.dryRun) {
    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: { state: 'completed', endedAt: new Date(), errorMessage: null },
    });
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { state: 'completed', completedAt: new Date() },
    });
    await prisma.report.create({
      data: {
        simulationId,
        summary: `Dry-run completed`,
        result: 'completed',
        failureType: sim.failureType,
        method: methodId,
        namespace: sim.namespace,
        targetService: sim.targetService ?? null,
        intensity: sim.intensity ?? null,
        durationSeconds: sim.durationSeconds,
        startedAt: sim.startedAt ?? new Date(),
        endedAt: new Date(),
        recoveryTimeSeconds: 0,
        errors: null,
      } as any,
    });
    endActiveRun(simulationId);
    return;
  }

  const sleepOrAbort = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        cleanup();
        const e: any = new Error('Cancelled');
        e.name = 'AbortError';
        reject(e);
      };
      const cleanup = () => {
        clearTimeout(t);
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort);
    });

  try {
    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: { state: 'running', startedAt: new Date() },
    });

    await failureMethod.apply(params);

    // Wait for duration, then rollback.
    await sleepOrAbort(sim.durationSeconds * 1000);

    const recoveryStart = Date.now();
    const rb = await rollback.rollbackAll();
    const recoverySeconds = Math.max(0, Math.round((Date.now() - recoveryStart) / 1000));

    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: { state: rb.ok ? 'completed' : 'rolled_back', endedAt: new Date(), errorMessage: rb.errors.join('; ') || null },
    });

    await prisma.simulation.update({
      where: { id: simulationId },
      data: { state: rb.ok ? 'completed' : ('rolled_back' as ExperimentState), completedAt: new Date() },
    });

    await prisma.report.create({
      data: {
        simulationId,
        summary: rb.ok ? `Simulation completed` : `Simulation rolled back with errors`,
        result: rb.ok ? 'completed' : 'rolled_back',
        failureType: sim.failureType,
        method: methodId,
        namespace: sim.namespace,
        targetService: sim.targetService ?? null,
        intensity: sim.intensity ?? null,
        durationSeconds: sim.durationSeconds,
        startedAt: sim.startedAt ?? new Date(),
        endedAt: new Date(),
        recoveryTimeSeconds: recoverySeconds,
        errors: rb.ok ? null : rb.errors.join('; '),
      } as any,
    });
  } catch (e: any) {
    const wasCancelled = e?.name === 'AbortError' || String(e?.message ?? '').toLowerCase().includes('cancel');
    const recoveryStart = Date.now();
    const rb = await rollback.rollbackAll();
    const recoverySeconds = Math.max(0, Math.round((Date.now() - recoveryStart) / 1000));
    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: {
        state: wasCancelled ? 'rolled_back' : 'failed',
        endedAt: new Date(),
        errorMessage: `${e?.message ?? String(e)}; rollback: ${rb.errors.join('; ')}`,
      },
    });
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { state: wasCancelled ? 'cancelled' : 'failed', completedAt: new Date() },
    });
    await prisma.report.create({
      data: {
        simulationId,
        summary: wasCancelled ? 'Simulation cancelled' : 'Simulation failed',
        result: wasCancelled ? 'cancelled' : 'failed',
        failureType: sim.failureType,
        method: methodId,
        namespace: sim.namespace,
        targetService: sim.targetService ?? null,
        intensity: sim.intensity ?? null,
        durationSeconds: sim.durationSeconds,
        startedAt: sim.startedAt ?? new Date(),
        endedAt: new Date(),
        recoveryTimeSeconds: recoverySeconds,
        errors: `${e?.message ?? String(e)}; rollback: ${rb.errors.join('; ')}`,
      } as any,
    });
    throw e;
  } finally {
    await prisma.recoveryAction.create({
      data: {
        simulationId,
        description: 'Automatic rollback executed',
        success: rollback.size > 0,
        completedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: sim.createdById,
        action: 'simulation.ended',
        simulationId,
        metadata: { durationSeconds: Math.round((Date.now() - startedAtMs) / 1000) },
      },
    });
    endActiveRun(simulationId);
  }
}

export async function stopSimulation(simulationId: string, stoppedBy: UserIdentity): Promise<void> {
  const prisma = getPrismaClient();
  const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!sim) throw new Error('Simulation not found');
  if (['completed', 'failed', 'rolled_back', 'cancelled'].includes(sim.state)) {
    const err: any = new Error('Simulation is already in a terminal state');
    err.status = 409;
    throw err;
  }

  const active = getActiveRun(simulationId);
  if (active) {
    active.controller.abort();
  }

  await prisma.simulation.update({
    where: { id: simulationId },
    data: { state: 'cancelled', completedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      userId: stoppedBy.id,
      action: 'simulation.stopped',
      simulationId,
      metadata: { by: stoppedBy.id },
    },
  });
}

function parseIntensity(intensity: string | null): number | undefined {
  if (!intensity) return undefined;
  const n = Number(intensity);
  return Number.isFinite(n) ? n : undefined;
}

function parseLatency(intensity: string | null): number | undefined {
  if (!intensity) return undefined;
  const m = intensity.match(/^(\d+)ms$/);
  if (!m) return undefined;
  return Number(m[1]);
}

function parsePacketLoss(_intensity: string | null): number | undefined {
  if (!_intensity) return undefined;
  const n = Number(_intensity);
  if (!Number.isFinite(n)) return undefined;
  return n >= 1 && n <= 100 ? n : undefined;
}

export function createSimulationName(prefix = 'sim'): string {
  return `${prefix}-${nanoid(8)}`;
}
