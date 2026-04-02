import { nanoid } from 'nanoid';
import { getPrismaClient } from '../database/client.js';
import type { ExperimentState, FailureType, SimulationTarget, UserIdentity } from '../types/domain.js';
import { findFailureMethod } from '../failures/registry.js';
import type { FailureParams } from '../failures/types.js';
import { RollbackStack } from '../recovery/rollback.js';
import { countActiveRuns, endActiveRun, getActiveRun, registerActiveRun } from './active-runs.js';
import { loadConfig } from '../config/env.js';
import { replaceDeployment, scaleDeployment, replaceNetworkPolicy, deleteNetworkPolicy } from '../kubernetes/ops.js';
import { clearSimStepCounter } from './steps.js';

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
  manualRollback?: boolean;
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
      manualRollback: input.manualRollback ?? false,
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

  const currentActive = countActiveRuns();
  if (currentActive >= config.maxConcurrentSimulations) {
    console.log(`[Simulator:${simulationId}] [Concurrency] QUEUED: System at capacity (${currentActive}/${config.maxConcurrentSimulations})`);
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { state: 'queued', startedAt: null }
    });
    return;
  }

  console.log(`[Simulator:${simulationId}] Claim attempt`);
  const claimed = await prisma.simulation.updateMany({
    where: { id: simulationId, state: { in: ['pending', 'queued'] } as any },
    data: { state: 'running', startedAt: new Date() },
  });

  if (claimed.count === 0) {
    const s = await prisma.simulation.findUnique({ where: { id: simulationId } });
    console.log(`[Simulator:${simulationId}] Claim skipped (already claimed or invalid state: ${s?.state})`);
    return;
  }
  console.log(`[Simulator:${simulationId}] Claim success`);

  const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!sim) throw new Error('Simulation disappeared during claim');

  console.log(`[Simulator:${simulationId}] Starting simulation: ${simulationId} (type: ${sim.failureType})`);
  const rollback = new RollbackStack();
  const activeRun = registerActiveRun(simulationId);
  const signal = activeRun.controller.signal;
  const startedAtMs = Date.now();

  console.log(`[Simulator:${simulationId}] Simulation ${simulationId} marked as RUNNING`);

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
    signal,
  };

  await failureMethod.validate(params);

  rollback.push({
    name: `rollback:${failureMethod.supports}:${failureMethod.id}`,
    run: async (s) => failureMethod.rollback({ ...params, signal: s || signal }),
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

    // Update isRollbackable bit (S-07)
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { isRollbackable: true }
    });

    if (sim.manualRollback) {
      console.log(`[Simulator:${simulationId}] Simulation ${simulationId} is Manual Recovery mode. Skipping automatic rollback.`);
      // We keep it in 'running' state. The user must call the rollback endpoint.
      return;
    }

    // Wait for duration, then rollback.
    await sleepOrAbort(sim.durationSeconds * 1000);

    const recoveryStart = Date.now();
    const rb = await rollback.rollbackAll(signal);
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
    const rb = await rollback.rollbackAll(signal);
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
    console.error(`[Simulator:${simulationId}] Simulation ${simulationId} FAILED:`, e);
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
    clearSimStepCounter(simulationId);
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

export async function rollbackSimulation(simulationId: string, user: UserIdentity): Promise<void> {
  const prisma = getPrismaClient();
  const sim = await prisma.simulation.findUnique({
    where: { id: simulationId },
    include: { rollbackEntries: { where: { status: 'pending' } } }
  });

  if (!sim) throw new Error('Simulation not found');
  if (!sim.isRollbackable) throw new Error('No pending rollback actions for this simulation');

  console.log(`[Simulator:${sim.id}] [Rollback] Manually rolling back simulation by user ${user.id}`);

  for (const entry of sim.rollbackEntries) {
    if (entry.status === 'completed') {
      console.log(`[Simulator:${sim.id}] [Rollback] Skipping already completed entry ${entry.id}`);
      continue;
    }
    try {
      console.log(`[Simulator:${sim.id}] [Rollback] Executing action: ${entry.actionName} for ${entry.resourceName}`);
      const data: any = entry.snapshotData;

      if (entry.actionName === 'restore-deployment') {
        await replaceDeployment(entry.namespace!, entry.resourceName!, data);
      } else if (entry.actionName === 'restore-replicas') {
        await scaleDeployment(entry.namespace!, entry.resourceName!, Number(data.replicas));
      } else if (entry.actionName === 'restore-networkpolicy') {
        if (data) {
          await replaceNetworkPolicy(entry.namespace!, entry.resourceName!, data);
        } else {
          await deleteNetworkPolicy(entry.namespace!, entry.resourceName!);
        }
      }

      await prisma.rollbackEntry.update({
        where: { id: entry.id },
        data: { status: 'completed', completedAt: new Date() }
      });
    } catch (err: any) {
      console.error(`[Simulator:${sim.id}] [Rollback] Failed to execute rollback entry ${entry.id}:`, err);
      await prisma.rollbackEntry.update({
        where: { id: entry.id },
        data: { status: 'failed', error: err.message }
      });
      throw new Error(`Rollback failed: ${err.message}`);
    }
  }

  await prisma.simulation.update({
    where: { id: sim.id },
    data: { state: 'completed', isRollbackable: false, completedAt: new Date() }
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'simulation.manual_rollback',
      simulationId: sim.id,
      metadata: { by: user.id },
    },
  });
}

export async function startSimulationWorker(): Promise<void> {
  console.log("[Simulator:Worker] [Worker] started");

  try {
    const prisma = getPrismaClient();
    const runningSims = await prisma.simulation.findMany({
      where: { state: 'running' },
      include: { rollbackEntries: { where: { status: 'pending' } } }
    });

    if (runningSims.length > 0) {
      console.log(`[Simulator:Worker] [Worker] Found ${runningSims.length} orphaned running simulations. Attempting recovery...`);

      const { replaceDeployment, scaleDeployment, replaceNetworkPolicy, deleteNetworkPolicy } = await import('../kubernetes/ops.js');

      for (const sim of runningSims) {
        console.log(`[Simulator:${sim.id}] [Worker] Recovering orphaned running simulation.`);

        // Execute pending rollbacks (C-05)
        for (const entry of sim.rollbackEntries) {
          try {
            console.log(`[Simulator:${sim.id}] [Recovery] Executing rollback action: ${entry.actionName} for ${entry.resourceName}`);
            const data: any = entry.snapshotData;

            if (entry.actionName === 'restore-deployment') {
              await replaceDeployment(entry.namespace!, entry.resourceName!, data);
            } else if (entry.actionName === 'restore-replicas') {
              await scaleDeployment(entry.namespace!, entry.resourceName!, Number(data.replicas));
            } else if (entry.actionName === 'restore-networkpolicy') {
              if (data) {
                await replaceNetworkPolicy(entry.namespace!, entry.resourceName!, data);
              } else {
                await deleteNetworkPolicy(entry.namespace!, entry.resourceName!);
              }
            }

            await prisma.rollbackEntry.update({
              where: { id: entry.id },
              data: { status: 'completed', completedAt: new Date() }
            });
          } catch (err: any) {
            console.error(`[Simulator:${sim.id}] [Recovery] Failed to recover rollback entry ${entry.id}:`, err);
            await prisma.rollbackEntry.update({
              where: { id: entry.id },
              data: { status: 'failed', error: err.message }
            });
          }
        }

        await prisma.simulation.update({
          where: { id: sim.id },
          data: { state: 'failed', completedAt: new Date() }
        });

        await prisma.failureEvent.updateMany({
          where: { simulationId: sim.id, state: 'running' },
          data: { state: 'failed', endedAt: new Date(), errorMessage: 'Recovered from worker restart; rollback executed.' }
        });

        await prisma.report.create({
          data: {
            simulationId: sim.id,
            summary: 'Recovered from worker restart',
            result: 'failed',
            failureType: sim.failureType,
            method: 'unknown', // Best effort
            namespace: sim.namespace,
            durationSeconds: sim.durationSeconds,
            startedAt: sim.startedAt ?? new Date(),
            endedAt: new Date(),
            errors: 'Simulation orphaned after worker crash/restart; state restored.'
          } as any
        });
      }
    }
  } catch (e) {
    console.warn('[Simulator:Worker] [Worker] Failed to cleanup orphaned simulations', e);
  }

  // Periodically check for queued/pending simulations and stale runs
  const poll = async () => {
    console.log('[Simulator:Worker] Poll cycle started');
    try {
      const prisma = getPrismaClient();
      const config = loadConfig();

      // 1. Check for stale RUNNING simulations (> 10 mins)
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
      const staleSims = await prisma.simulation.findMany({
        where: { state: 'running', startedAt: { lte: staleThreshold } },
      });

      for (const s of staleSims) {
        console.log(`[Simulator:${s.id}] [Timeout] Janitor: Triggering force-failure for stale RUNNING simulations (>10m).`);
        void stopSimulation(s.id, { id: 'system', email: 'system@simulator.local', role: 'admin' }).catch(err => {
          console.error(`[Simulator:${s.id}] [Timeout] Janitor: Failed to auto-stop stale simulation:`, err);
        });
      }

      // 2. Check for stale FAILURE_ACTIVE simulations (exceeded duration + 10m buffer)
      const activeFailures = await prisma.simulation.findMany({
        where: { state: 'failure_active' },
      });

      for (const s of activeFailures) {
        if (!s.startedAt) continue;
        const expectedEndTime = new Date(s.startedAt.getTime() + s.durationSeconds * 1000);
        if (Date.now() > expectedEndTime.getTime() + 10 * 60 * 1000) {
          console.log(`[Simulator:${s.id}] [Timeout] Janitor: Triggering emergency rollback for stale FAILURE_ACTIVE simulation.`);
          void stopSimulation(s.id, { id: 'system', email: 'system@simulator.local', role: 'admin' }).catch(err => {
            console.error(`[Simulator:${s.id}] [Timeout] Janitor: Failed to emergency rollback stale simulation:`, err);
          });
        }
      }

      // 3. Fetch QUEUED first (priority), then PENDING
      const candidates = await prisma.simulation.findMany({
        where: { state: { in: ['queued', 'pending'] } as any },
        orderBy: [
          { state: 'desc' }, // 'queued' (q) comes before 'pending' (p) in desc order.
          { createdAt: 'asc' }
        ],
        take: 10,
      });

      if (candidates.length === 0) {
        // Reduced noise but keeps heartbeat visible
        const counts = await prisma.simulation.groupBy({
          by: ['state'],
          where: { state: { in: ['queued', 'pending', 'running', 'failed', 'completed'] } as any },
          _count: true
        });
        const stateStr = counts.map((c: any) => `${c.state}:${c._count}`).join(', ') || 'none';
        console.log(`[Simulator:Worker] Running count: ${countActiveRuns()}/${config.maxConcurrentSimulations}`);
        console.log(`[Simulator:Worker] Candidates found: 0 (Global stats: ${stateStr})`);
      } else {
        console.log(`[Simulator:Worker] Running count: ${countActiveRuns()}/${config.maxConcurrentSimulations}`);
        console.log(`[Simulator:Worker] Candidates found: ${candidates.length}`);
      }

      for (const sim of candidates) {
        console.log(`[Simulator:${sim.id}] [Worker] Picking up simulation (state: ${sim.state})`);
        void runSimulation(sim.id).catch((e) => {
          console.error(`[Simulator:${sim.id}] [Worker] Execution failed:`, e);
        });
      }
    } catch (e) {
      console.error('[Simulator:Worker] [Worker] Poll failed', e);
    }
  };

  // Poll every 30 seconds
  setInterval(() => {
    void poll();
  }, 30000);

  // Initial immediate run (Startup Recovery)
  console.log('[Simulator:Worker] Startup recovery running...');
  void poll();
}
