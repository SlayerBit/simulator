import { nanoid } from 'nanoid';
import { getPrismaClient } from '../database/client.js';
import type { ExperimentState, FailureType, SimulationTarget, UserIdentity } from '../types/domain.js';
import { findFailureMethod } from '../failures/registry.js';
import type { FailureParams } from '../failures/types.js';
import { RollbackStack } from '../recovery/rollback.js';
import { countActiveRuns, endActiveRun, getActiveRun, registerActiveRun } from './active-runs.js';
import { loadConfig } from '../config/env.js';
import { replaceDeployment, scaleDeployment, replaceNetworkPolicy, deleteNetworkPolicy } from '../kubernetes/ops.js';
import { clearSimStepCounter, recordSimulationStep } from './steps.js';
import { normalizeAndSaveParameters } from './normalization.js';
import { assertVisibleFailureMethod } from '../failures/allowlist.js';

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

  // Build intensity label using same priority as normalization:
  // latencyMs → packetLossPercent → intensityPercent
  const intensityLabel = input.latencyMs != null
    ? `${input.latencyMs}ms`
    : input.packetLossPercent != null
      ? `${input.packetLossPercent}%`
      : input.intensityPercent != null
        ? String(input.intensityPercent)
        : null;

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
      intensity: intensityLabel,
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

  console.log(`[Simulator:${sim.id}] [Created] method=${input.method} type=${input.failureType} ns=${input.target.namespace} intensity="${intensityLabel ?? 'nil'}" duration=${input.durationSeconds}s dryRun=${input.dryRun}`);

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

  await recordSimulationStep({
    simulationId,
    name: 'simulation_started',
    failureType: sim.failureType,
    stepType: 'execution',
    phase: 'pre-flight',
    status: 'success',
    message: `simulation_started id=${simulationId}`,
  });

  console.log(`[Simulator:${simulationId}] Starting simulation: ${simulationId} (type: ${sim.failureType})`);
  const rollback = new RollbackStack();
  const activeRun = registerActiveRun(simulationId);
  const signal = activeRun.controller.signal;
  const startedAtMs = Date.now();

  console.log(`[Simulator:${simulationId}] Simulation ${simulationId} marked as RUNNING`);

  let rollbackSucceeded: boolean | null = null;
  let methodId = 'unknown';

  try {
    // FIX-1: Window check is INSIDE try so finally always runs for audit+recoveryAction cleanup.
    // Throwing an AbortError here is caught below, sets wasCancelled=true, and the finally
    // block writes the recoveryAction and simulation.ended audit log regardless.
    {
      const freshCheck = await prisma.simulation.findUnique({ where: { id: simulationId }, select: { state: true } });
      if (freshCheck?.state === 'cancelled') {
        console.log(`[Simulator:${simulationId}] [Claim] Simulation was cancelled during startup window — aborting.`);
        const abortErr: any = new Error('Cancelled');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
    }

    const ev = await prisma.failureEvent.findFirst({ where: { simulationId } });
    methodId = ev?.method ?? 'unknown';

    assertVisibleFailureMethod(sim.failureType, methodId);
    const failureMethod = findFailureMethod(sim.failureType as FailureType, methodId);

    const target: any = { namespace: sim.namespace || 'default' };
    if (sim.targetService) target.serviceName = sim.targetService;
    if (sim.targetDeployment) target.deploymentName = sim.targetDeployment;
    if (sim.targetPod) target.podName = sim.targetPod;
    if (sim.labelSelector) target.labelSelector = sim.labelSelector;

    console.log(`[Simulator:${simulationId}] Starting failure method ${methodId} in namespace ${target.namespace}`);

    // --- Phase: pre-flight — payload construction ---
    let parsedIntensity = parseIntensityPercent(sim.intensity);
    let parsedPacketLoss = parsePacketLossPercent(sim.intensity);

    // Legacy support: "10" natively parses as intensity. If the method explicitly requires packet loss,
    // re-map the plain integer over to packet loss to prevent validation throwing on old simulations.
    if (parsedIntensity !== undefined && parsedPacketLoss === undefined && failureMethod.requirements?.requiresPacketLossPercent) {
      parsedPacketLoss = parsedIntensity;
      parsedIntensity = undefined;
    }

    const rawParams: FailureParams = {
      failureType: sim.failureType as FailureType,
      method: methodId,
      target,
      durationSeconds: sim.durationSeconds,
      intensityPercent: parsedIntensity,
      latencyMs: parseLatencyMs(sim.intensity),
      packetLossPercent: parsedPacketLoss,
      dryRun: sim.dryRun,
      simulationId: sim.id,
      rollback,
      signal,
    };

    await recordSimulationStep({
      simulationId,
      name: 'Payload Constructed',
      failureType: sim.failureType,
      stepType: 'execution',
      phase: 'pre-flight',
      status: 'running',
      message: `method=${methodId} ns=${target.namespace} deployment=${target.deploymentName ?? 'n/a'} selector=${target.labelSelector ?? 'n/a'} intensityPercent=${rawParams.intensityPercent ?? 'nil'} latencyMs=${rawParams.latencyMs ?? 'nil'} packetLossPercent=${rawParams.packetLossPercent ?? 'nil'} durationSeconds=${rawParams.durationSeconds}`,
    });

    // --- Phase: pre-flight — normalization ---
    console.log(`[Simulator:${simulationId}] [Lifecycle] Starting normalization`);
    const normResult = await normalizeAndSaveParameters(sim.id, failureMethod, rawParams);
    const params = normResult.params;

    const defaultsMsg = Object.keys(normResult.defaultsApplied).length > 0
      ? `Defaults applied: ${JSON.stringify(normResult.defaultsApplied)}`
      : 'No defaults applied';
    console.log(`[Simulator:${simulationId}] [Lifecycle] Normalization complete — ${defaultsMsg}`);

    await recordSimulationStep({
      simulationId,
      name: 'Parameters Normalized',
      failureType: sim.failureType,
      stepType: 'execution',
      phase: 'pre-flight',
      status: 'success',
      message: `${defaultsMsg}. Resolved: intensityPercent=${params.intensityPercent ?? 'nil'} latencyMs=${params.latencyMs ?? 'nil'} packetLossPercent=${params.packetLossPercent ?? 'nil'}`,
    });

    // --- Phase: pre-flight — validation ---
    console.log(`[Simulator:${simulationId}] [Lifecycle] Validation start`);
    await recordSimulationStep({
      simulationId,
      name: 'validation_started',
      failureType: sim.failureType,
      stepType: 'validation',
      phase: 'pre-flight',
      status: 'running',
      message: `validation_started method=${methodId}`,
    });
    try {
      await failureMethod.validate(params);
      console.log(`[Simulator:${simulationId}] [Lifecycle] Validation passed`);
      await recordSimulationStep({
        simulationId,
        name: 'validation_passed',
        failureType: sim.failureType,
        stepType: 'validation',
        phase: 'pre-flight',
        status: 'success',
        message: 'validation_passed',
      });
    } catch (valErr: any) {
      console.error(`[Simulator:${simulationId}] [Lifecycle] Validation FAILED: ${valErr.message}`);
      await recordSimulationStep({
        simulationId,
        name: 'Validation Failed',
        failureType: sim.failureType,
        stepType: 'validation',
        phase: 'pre-flight',
        status: 'failed',
        error: valErr.message,
        message: `Validation rejected for method "${methodId}"`,
      });
      throw valErr;
    }

    if (sim.dryRun) {
      await recordSimulationStep({
        simulationId,
        name: 'dry_run_started',
        failureType: sim.failureType,
        stepType: 'execution',
        phase: 'pre-flight',
        status: 'running',
        message: 'dry_run_started',
      });
      let planMsg = 'Dry-run: validation only; no Kubernetes mutations.';
      if (failureMethod.dryRunPlan) {
        const r = failureMethod.dryRunPlan(params);
        planMsg = typeof r === 'string' ? r : await r;
      }
      await recordSimulationStep({
        simulationId,
        name: 'dry_run_completed',
        failureType: sim.failureType,
        stepType: 'execution',
        phase: 'pre-flight',
        status: 'success',
        message: planMsg,
      });

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

    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: { state: 'running', startedAt: new Date() },
    });

    // --- Phase: chaos — apply ---
    console.log(`[Simulator:${simulationId}] [Lifecycle] Apply start`);
    await recordSimulationStep({
      simulationId,
      name: 'apply_started',
      failureType: sim.failureType,
      stepType: 'execution',
      phase: 'chaos',
      status: 'running',
      message: `apply_started method="${methodId}"`,
    });

    let applyResult;
    try {
      applyResult = await failureMethod.apply(params);
      console.log(`[Simulator:${simulationId}] [Lifecycle] Apply success — ${applyResult.message}`);
      await recordSimulationStep({
        simulationId,
        name: 'apply_step_completed',
        failureType: sim.failureType,
        stepType: 'execution',
        phase: 'chaos',
        status: 'success',
        message: applyResult.message,
      });
      if (failureMethod.verifyApplied) {
        const vStart = Date.now();
        await recordSimulationStep({
          simulationId,
          name: 'apply_verification_started',
          failureType: sim.failureType,
          stepType: 'execution',
          phase: 'chaos',
          status: 'running',
          message: 'Post-apply cluster verification',
        });
        try {
          await failureMethod.verifyApplied(params);
          await recordSimulationStep({
            simulationId,
            name: 'apply_verification_passed',
            failureType: sim.failureType,
            stepType: 'execution',
            phase: 'chaos',
            status: 'success',
            message: 'Cluster state matches expected failure impact',
            durationMs: Date.now() - vStart,
          });
        } catch (verErr: any) {
          await recordSimulationStep({
            simulationId,
            name: 'apply_verification_failed',
            failureType: sim.failureType,
            stepType: 'execution',
            phase: 'chaos',
            status: 'failed',
            error: verErr.message,
            message: 'Post-apply verification did not observe expected impact',
            durationMs: Date.now() - vStart,
          });
          throw verErr;
        }
      }
    } catch (applyErr: any) {
      console.error(`[Simulator:${simulationId}] [Lifecycle] Apply FAILED: ${applyErr.message}`);
      await recordSimulationStep({
        simulationId,
        name: 'apply_step_failed',
        failureType: sim.failureType,
        stepType: 'execution',
        phase: 'chaos',
        status: 'failed',
        error: applyErr.message,
        message: `Method "${methodId}" apply() threw an error`,
      });
      throw applyErr;
    }

    await prisma.simulation.update({
      where: { id: simulationId },
      data: { isRollbackable: true }
    });

    if (sim.manualRollback) {
      console.log(`[Simulator:${simulationId}] Simulation ${simulationId} is Manual Recovery mode. Skipping automatic rollback.`);
      await prisma.failureEvent.updateMany({
        where: { simulationId },
        data: { state: 'completed', endedAt: new Date() }
      });
      await prisma.simulation.update({
        where: { id: simulationId },
        data: { state: 'failure_active', completedAt: null }
      });
      return;
    }

    // Hold chaos for the configured window unless apply() already ran the full duration (e.g. disruption loop).
    const holdMs = failureMethod.consumesSimulationDurationInApply ? 0 : sim.durationSeconds * 1000;
    await sleepOrAbort(holdMs);

    // --- Phase: recovery — automatic rollback ---
    console.log(`[Simulator:${simulationId}] [Lifecycle] Automatic rollback start (${rollback.size} entries)`);
    await recordSimulationStep({
      simulationId,
      name: 'rollback_started',
      failureType: sim.failureType,
      stepType: 'rollback',
      phase: 'recovery',
      status: 'running',
      message: `Starting automatic rollback after ${sim.durationSeconds}s (${rollback.size} action(s) queued)`,
    });

    const recoveryStart = Date.now();
    const rollbackController = new AbortController();
    const rb = await rollback.rollbackAll(sim.id, sim.failureType, rollbackController.signal);
    rollbackSucceeded = rb.ok;
    const recoverySeconds = Math.max(0, Math.round((Date.now() - recoveryStart) / 1000));
    const rbErrors = rb.errors.join('; ');

    console.log(`[Simulator:${simulationId}] [Lifecycle] Rollback ${rb.ok ? 'SUCCEEDED' : 'FAILED'} in ${recoverySeconds}s`);
    await recordSimulationStep({
      simulationId,
      name: rb.ok ? 'rollback_completed' : 'rollback_failed',
      failureType: sim.failureType,
      stepType: 'rollback',
      phase: 'recovery',
      status: rb.ok ? 'success' : 'failed',
      durationMs: Date.now() - recoveryStart,
      message: rb.ok ? `All rollback actions completed in ${recoverySeconds}s` : `Rollback finished with ${rb.errors.length} error(s)`,
      error: rbErrors || null,
    });

    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: { state: rb.ok ? 'completed' : 'rolled_back', endedAt: new Date(), errorMessage: rbErrors || null },
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
        errors: rb.ok ? null : rbErrors,
      } as any,
    });
  } catch (e: any) {
    const wasCancelled = e?.name === 'AbortError' || String(e?.message ?? '').toLowerCase().includes('cancel');
    if (wasCancelled && !sim.dryRun) {
      await recordSimulationStep({
        simulationId,
        name: 'stop_completed',
        failureType: sim.failureType,
        stepType: 'execution',
        phase: 'recovery',
        status: 'running',
        message: 'stop_completed — executing rollback',
      });
    }

    // FIX-4: Manual rollback error path. If K8s was partially mutated (rollback.size > 0),
    // set state to failure_active so the user can invoke manual rollback. If nothing was
    // applied yet, set to failed (or cancelled). Never leave stuck in 'running'.
    if (sim.manualRollback) {
      rollbackSucceeded = null;
      // failure_active only when K8s mutations already exist and need reverting.
      const manualErrState: ExperimentState = rollback.size > 0
        ? ('failure_active' as ExperimentState)
        : (wasCancelled ? 'cancelled' : 'failed');

      if (rollback.size > 0) {
        await prisma.simulation.update({
          where: { id: simulationId },
          data: { isRollbackable: true },
        });
      }

      await prisma.failureEvent.updateMany({
        where: { simulationId },
        data: { state: wasCancelled ? 'rolled_back' : 'failed', endedAt: new Date(), errorMessage: e.message },
      });
      await prisma.simulation.update({
        where: { id: simulationId },
        data: {
          state: manualErrState,
          // failure_active has no completedAt — completion is deferred to manual rollback.
          completedAt: manualErrState === ('failure_active' as ExperimentState) ? null : new Date(),
        },
      });
      await prisma.report.create({
        data: {
          simulationId,
          summary: manualErrState === ('failure_active' as ExperimentState)
            ? 'Simulation partially applied — manual rollback required'
            : (wasCancelled ? 'Simulation cancelled' : 'Simulation failed before applying'),
          result: wasCancelled ? 'cancelled' : 'failed',
          failureType: sim.failureType,
          method: methodId,
          namespace: sim.namespace,
          targetService: sim.targetService ?? null,
          intensity: sim.intensity ?? null,
          durationSeconds: sim.durationSeconds,
          startedAt: sim.startedAt ?? new Date(),
          endedAt: new Date(),
          recoveryTimeSeconds: 0,
          errors: e.message,
        } as any,
      });
      console.error(`[Simulator:${simulationId}] Manual-mode simulation error (state=${manualErrState}):`, e);
      // Do NOT throw — sim is in a stable state. finally still runs for audit+recoveryAction.
      return;
    }

    // Non-manual path: automatic error rollback.
    const recoveryStart = Date.now();
    let recoverySeconds = 0;

    console.log(`[Simulator:${simulationId}] [Lifecycle] Error rollback start (${rollback.size} entries)`);
    await recordSimulationStep({
      simulationId,
      name: 'Rollback Start (Error Path)',
      failureType: sim.failureType,
      stepType: 'rollback',
      phase: 'recovery',
      status: 'running',
      message: `Starting rollback after error: ${e.message}`,
    });

    const rollbackController = new AbortController();
    const rb = await rollback.rollbackAll(sim.id, sim.failureType, rollbackController.signal);
    rollbackSucceeded = rb.ok;
    recoverySeconds = Math.max(0, Math.round((Date.now() - recoveryStart) / 1000));
    const rbErrors = rb.errors.join('; ');

    await recordSimulationStep({
      simulationId,
      name: rb.ok ? 'Error-path Rollback Complete' : 'Error-path Rollback Failed',
      failureType: sim.failureType,
      stepType: 'rollback',
      phase: 'recovery',
      status: rb.ok ? 'success' : 'failed',
      durationMs: Date.now() - recoveryStart,
      message: rb.ok ? 'Rollback after error completed' : `Rollback errored: ${rbErrors}`,
      error: rbErrors || null,
    });

    e.message = `${e?.message ?? String(e)}; rollback: ${rbErrors}`;

    await prisma.failureEvent.updateMany({
      where: { simulationId },
      data: {
        state: wasCancelled ? 'rolled_back' : 'failed',
        endedAt: new Date(),
        errorMessage: e.message,
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
        errors: e.message,
      } as any,
    });
    console.error(`[Simulator:${simulationId}] Simulation ${simulationId} FAILED:`, e);
    throw e;
  } finally {
    endActiveRun(simulationId);
    clearSimStepCounter(simulationId);
    if (!sim.dryRun && !sim.manualRollback) {
      await prisma.recoveryAction.create({
        data: {
          simulationId,
          description: 'Automatic rollback executed',
          success: rollbackSucceeded ?? false,
          completedAt: new Date(),
        },
      });
    }
    await prisma.auditLog.create({
      data: {
        userId: sim.createdById,
        action: 'simulation.ended',
        simulationId,
        metadata: { durationSeconds: Math.round((Date.now() - startedAtMs) / 1000) },
      },
    });
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
  // FIX-2: failure_active means K8s mutations are live and awaiting manual rollback.
  // Stopping without rollback would leave the cluster permanently mutated.
  if (sim.state === 'failure_active') {
    const err: any = new Error("Simulation has active failures — use the '/rollback' endpoint to restore cluster state before cancelling");
    err.status = 409;
    throw err;
  }

  await recordSimulationStep({
    simulationId,
    name: 'stop_requested',
    failureType: sim.failureType,
    stepType: 'execution',
    status: 'running',
    message: `stop_requested by=${stoppedBy.id}`,
  });

  const active = getActiveRun(simulationId);
  if (active) {
    // ISSUE-006: Abort the active execution. The runSimulation catch block will
    // perform rollback and write the terminal state — do not race it with a DB update here.
    active.controller.abort();
  } else {
    // ISSUE-006: No active run found — sim may be pending/queued or in the narrow
    // window between claim and registerActiveRun. Use updateMany with a state guard
    // so we never overwrite a terminal state that runSimulation may have just written.
    const updated = await prisma.simulation.updateMany({
      where: {
        id: simulationId,
        state: { notIn: ['completed', 'failed', 'rolled_back', 'cancelled'] as any },
      },
      data: { state: 'cancelled', completedAt: new Date() },
    });
    if (updated.count === 0) {
      console.log(`[Simulator:${simulationId}] [Stop] State already terminal — skipping cancel update`);
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: stoppedBy.id,
      action: 'simulation.stopped',
      simulationId,
      metadata: { by: stoppedBy.id },
    },
  });
}

// ─── Parse helpers ────────────────────────────────────────────────────────────
// The intensity column stores three distinct formats:
//   "30"     → intensityPercent = 30
//   "200ms"  → latencyMs = 200
//   "10%"    → packetLossPercent = 10

function parseIntensityPercent(intensity: string | null): number | undefined {
  if (!intensity) return undefined;
  // Must be a plain integer (no suffix) to be an intensityPercent value
  if (intensity.endsWith('ms') || intensity.endsWith('%')) return undefined;
  const n = Number(intensity);
  return Number.isFinite(n) ? n : undefined;
}

function parseLatencyMs(intensity: string | null): number | undefined {
  if (!intensity) return undefined;
  const m = intensity.match(/^(\d+)ms$/);
  if (!m) return undefined;
  return Number(m[1]);
}

function parsePacketLossPercent(intensity: string | null): number | undefined {
  if (!intensity) return undefined;
  const m = intensity.match(/^(\d+)%$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 100 ? n : undefined;
}
// ─────────────────────────────────────────────────────────────────────────────

export function createSimulationName(prefix = 'sim'): string {
  return `${prefix}-${nanoid(8)}`;
}

export async function rollbackSimulation(simulationId: string, user: UserIdentity): Promise<void> {
  const prisma = getPrismaClient();
  const sim = await prisma.simulation.findUnique({
    where: { id: simulationId },
    include: { rollbackEntries: { where: { status: { in: ['pending', 'failed'] } } } }
  });

  if (!sim) throw new Error('Simulation not found');

  // ISSUE-005: Guard valid states for manual rollback. Only failure_active sims (or sims
  // that completed apply but are awaiting manual recovery) may be rolled back this way.
  const rollbackableStates = ['failure_active', 'failed'];
  if (!rollbackableStates.includes(sim.state)) {
    const err: any = new Error(`Cannot manually roll back a simulation in state '${sim.state}'. Allowed states: ${rollbackableStates.join(', ')}`);
    err.status = 409;
    throw err;
  }

  if (!sim.isRollbackable) throw new Error('No pending rollback actions for this simulation');

  // FIX-3: Atomic claim — prevents two concurrent POST /rollback requests from both
  // proceeding. updateMany returns count=0 if another request already cleared isRollbackable.
  const rollbackClaim = await prisma.simulation.updateMany({
    where: {
      id: simulationId,
      isRollbackable: true,
      state: { in: rollbackableStates as any },
    },
    data: { isRollbackable: false },
  });
  if (rollbackClaim.count === 0) {
    const err: any = new Error('Rollback already in progress or no pending rollback actions remain');
    err.status = 409;
    throw err;
  }

  console.log(`[Simulator:${sim.id}] [Rollback] Manually rolling back simulation by user ${user.id}`);

  await recordSimulationStep({
    simulationId: sim.id,
    failureType: sim.failureType,
    name: 'Manual Rollback Start',
    stepType: 'rollback',
    phase: 'recovery',
    status: 'running',
    message: `Manual rollback initiated by user ${user.id} (${sim.rollbackEntries.length} action(s))`,
  });

  const rollbackStartMs = Date.now();
  const errors: string[] = [];

  for (const entry of sim.rollbackEntries) {
    if (entry.status === 'completed') {
      console.log(`[Simulator:${sim.id}] [Rollback] Skipping already completed entry ${entry.id}`);
      continue;
    }
    try {
      console.log(`[Simulator:${sim.id}] [Rollback] Executing action: ${entry.actionName} for ${entry.resourceName}`);

      await recordSimulationStep({
        simulationId: sim.id,
        failureType: sim.failureType,
        name: `Rollback: ${entry.actionName}`,
        stepType: 'rollback',
        phase: 'recovery',
        status: 'running',
        message: `Manually rolling back ${entry.resourceName}`,
        resourceName: entry.resourceName,
        namespace: entry.namespace,
      });
      const startMs = Date.now();

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
      } else if (entry.actionName === 'cleanup-tc-qdisc') {
        const snap = data as { selector: string; container: string };
        const { listPodsBySelector, execCommandInPod } = await import('../kubernetes/ops.js');
        const pods = await listPodsBySelector(entry.namespace!, snap.selector);
        for (const pod of pods) {
          if (pod.metadata?.name) {
            await execCommandInPod(entry.namespace!, pod.metadata.name, snap.container || '',
              ['sh', '-c', 'tc qdisc del dev eth0 root 2>/dev/null || true']
            );
          }
        }
      }

      await prisma.rollbackEntry.update({
        where: { id: entry.id },
        data: { status: 'completed', completedAt: new Date() }
      });

      await recordSimulationStep({
        simulationId: sim.id,
        failureType: sim.failureType,
        name: `Rollback: ${entry.actionName}`,
        stepType: 'rollback',
        phase: 'recovery',
        status: 'success',
        durationMs: Date.now() - startMs,
        resourceName: entry.resourceName,
        namespace: entry.namespace,
      });
    } catch (err: any) {
      console.error(`[Simulator:${sim.id}] [Rollback] Failed to execute rollback entry ${entry.id}:`, err);
      await prisma.rollbackEntry.update({
        where: { id: entry.id },
        data: { status: 'failed', error: err.message }
      });

      await recordSimulationStep({
        simulationId: sim.id,
        failureType: sim.failureType,
        name: `Rollback: ${entry.actionName}`,
        stepType: 'rollback',
        phase: 'recovery',
        status: 'failed',
        error: err.message,
        resourceName: entry.resourceName,
        namespace: entry.namespace,
      });

      errors.push(`${entry.actionName}/${entry.resourceName}: ${err.message}`);
    }
  }

  // ISSUE-005: Use 'rolled_back' for partial failure, not 'failed'. 'failed' implies the
  // simulation itself failed to execute. 'rolled_back' is the correct terminal state after
  // rollback (even partial). Keep isRollbackable=true only if there are still pending entries.
  const finalState: ExperimentState = errors.length === 0 ? 'completed' : ('rolled_back' as ExperimentState);
  const rollbackDurationMs = Date.now() - rollbackStartMs;

  await recordSimulationStep({
    simulationId: sim.id,
    failureType: sim.failureType,
    name: errors.length === 0 ? 'Manual Rollback Complete' : 'Manual Rollback Partial/Failed',
    stepType: 'rollback',
    phase: 'recovery',
    status: errors.length === 0 ? 'success' : 'failed',
    durationMs: rollbackDurationMs,
    message: errors.length === 0
      ? `All ${sim.rollbackEntries.length} rollback action(s) completed`
      : `${errors.length}/${sim.rollbackEntries.length} rollback action(s) failed`,
    error: errors.length > 0 ? errors.join('; ') : null,
  });

  await prisma.simulation.update({
    where: { id: sim.id },
    data: { state: finalState, isRollbackable: errors.length > 0, completedAt: new Date() }
  });

  await prisma.recoveryAction.create({
    data: {
      simulationId: sim.id,
      description: 'Manual rollback executed',
      success: errors.length === 0,
      completedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'simulation.manual_rollback',
      simulationId: sim.id,
      metadata: { by: user.id, errors: errors.length > 0 ? errors : undefined } as any,
    },
  });

  if (errors.length > 0) {
    throw new Error(`Rollback partially failed (${errors.length} errors): ${errors.join('; ')}`);
  }
}

// Janitor: Roll back stale simulations' K8s resources before cancelling.
async function rollbackAndFailStaleSimulation(simulationId: string): Promise<void> {
  const prisma = getPrismaClient();
  const sim = await prisma.simulation.findUnique({
    where: { id: simulationId },
    include: { rollbackEntries: { where: { status: 'pending' } } }
  });
  if (!sim) return;

  console.log(`[Simulator:${simulationId}] [Janitor] Starting stale-simulation rollback (${sim.rollbackEntries.length} entries)`);

  await recordSimulationStep({
    simulationId: sim.id,
    failureType: sim.failureType,
    name: 'Janitor Rollback Start',
    stepType: 'rollback',
    phase: 'recovery',
    status: 'running',
    message: `[Janitor] Stale simulation detected — rolling back ${sim.rollbackEntries.length} orphaned action(s)`,
  });

  const janitorStartMs = Date.now();
  let janitorHasErrors = false;

  for (const entry of sim.rollbackEntries) {
    try {
      await recordSimulationStep({
        simulationId: sim.id,
        failureType: sim.failureType,
        name: `Rollback: ${entry.actionName}`,
        stepType: 'rollback',
        phase: 'recovery',
        status: 'running',
        message: `[Janitor] Rolling back orphaned ${entry.resourceName}`,
        resourceName: entry.resourceName,
        namespace: entry.namespace,
      });
      const startMs = Date.now();

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
      } else if (entry.actionName === 'cleanup-tc-qdisc') {
        // ISSUE-008: Execute tc cleanup persisted in DB — idempotent with '|| true'
        const snap = data as { selector: string; container: string };
        const { listPodsBySelector, execCommandInPod } = await import('../kubernetes/ops.js');
        const pods = await listPodsBySelector(entry.namespace!, snap.selector);
        for (const pod of pods) {
          if (pod.metadata?.name) {
            await execCommandInPod(
              entry.namespace!, pod.metadata.name, snap.container || '',
              ['sh', '-c', 'tc qdisc del dev eth0 root 2>/dev/null || true']
            );
          }
        }
      }

      await prisma.rollbackEntry.update({
        where: { id: entry.id },
        data: { status: 'completed', completedAt: new Date() }
      });

      await recordSimulationStep({
        simulationId: sim.id,
        failureType: sim.failureType,
        name: `Rollback: ${entry.actionName}`,
        stepType: 'rollback',
        phase: 'recovery',
        status: 'success',
        durationMs: Date.now() - startMs,
        resourceName: entry.resourceName,
        namespace: entry.namespace,
      });
    } catch (err: any) {
      // ISSUE-024: Track errors so final summary step reports correct status
      janitorHasErrors = true;
      console.error(`[Simulator:${simulationId}] [Janitor] Rollback failed for entry ${entry.id}:`, err);
      await prisma.rollbackEntry.update({
        where: { id: entry.id },
        data: { status: 'failed', error: err.message }
      });

      await recordSimulationStep({
        simulationId: sim.id,
        failureType: sim.failureType,
        name: `Rollback: ${entry.actionName}`,
        stepType: 'rollback',
        phase: 'recovery',
        status: 'failed',
        error: err.message,
        resourceName: entry.resourceName,
        namespace: entry.namespace,
      });
      // Continue with remaining rollback entries — do not abort on partial failure
    }
  }

  // ISSUE-024: Final summary correctly reflects whether any steps failed
  await recordSimulationStep({
    simulationId: sim.id,
    failureType: sim.failureType,
    name: janitorHasErrors ? 'Janitor Rollback Completed with Errors' : 'Janitor Rollback Complete',
    stepType: 'rollback',
    phase: 'recovery',
    status: janitorHasErrors ? 'failed' : 'success',
    durationMs: Date.now() - janitorStartMs,
    message: janitorHasErrors
      ? '[Janitor] Stale simulation rollback finished with errors — manual intervention may be required'
      : '[Janitor] Stale simulation rollback finished successfully',
  });

  const active = getActiveRun(simulationId);
  if (active) {
    active.controller.abort();
  }

  // ISSUE-024: Correctly reflect janitor outcome. Clean rollback → 'cancelled' (the
  // simulation was stale/orphaned but Kubernetes state was restored). Errors → 'failed'.
  await prisma.simulation.update({
    where: { id: simulationId },
    data: { state: janitorHasErrors ? 'failed' : 'cancelled', completedAt: new Date() },
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

        await recordSimulationStep({
          simulationId: sim.id,
          failureType: sim.failureType,
          name: 'Startup Recovery Start',
          stepType: 'rollback',
          phase: 'recovery',
          status: 'running',
          message: `[Worker] Orphaned simulation detected at startup — rolling back ${sim.rollbackEntries.length} pending action(s)`,
        });

        const workerStartMs = Date.now();
        let workerHasErrors = false;

        for (const entry of sim.rollbackEntries) {
          try {
            console.log(`[Simulator:${sim.id}] [Recovery] Executing rollback action: ${entry.actionName} for ${entry.resourceName}`);

            await recordSimulationStep({
              simulationId: sim.id,
              failureType: sim.failureType,
              name: `Rollback: ${entry.actionName}`,
              stepType: 'rollback',
              phase: 'recovery',
              status: 'running',
              message: `[Worker] Recovering ${entry.resourceName}`,
              resourceName: entry.resourceName,
              namespace: entry.namespace,
            });
            const startMs = Date.now();

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
            } else if (entry.actionName === 'cleanup-tc-qdisc') {
              // ISSUE-008: Execute tc cleanup from persisted DB entry — idempotent with '|| true'
              const snap = data as { selector: string; container: string };
              const { listPodsBySelector, execCommandInPod } = await import('../kubernetes/ops.js');
              const pods = await listPodsBySelector(entry.namespace!, snap.selector);
              for (const pod of pods) {
                if (pod.metadata?.name) {
                  await execCommandInPod(
                    entry.namespace!, pod.metadata.name, snap.container || '',
                    ['sh', '-c', 'tc qdisc del dev eth0 root 2>/dev/null || true']
                  );
                }
              }
            }

            await prisma.rollbackEntry.update({
              where: { id: entry.id },
              data: { status: 'completed', completedAt: new Date() }
            });

            await recordSimulationStep({
              simulationId: sim.id,
              failureType: sim.failureType,
              name: `Rollback: ${entry.actionName}`,
              stepType: 'rollback',
              phase: 'recovery',
              status: 'success',
              durationMs: Date.now() - startMs,
              resourceName: entry.resourceName,
              namespace: entry.namespace,
            });
          } catch (err: any) {
            // Track error but continue with remaining entries — do not abort on partial failure
            workerHasErrors = true;
            console.error(`[Simulator:${sim.id}] [Recovery] Failed to recover rollback entry ${entry.id}:`, err);
            await prisma.rollbackEntry.update({
              where: { id: entry.id },
              data: { status: 'failed', error: err.message }
            });

            await recordSimulationStep({
              simulationId: sim.id,
              failureType: sim.failureType,
              name: `Rollback: ${entry.actionName}`,
              stepType: 'rollback',
              phase: 'recovery',
              status: 'failed',
              error: err.message,
              resourceName: entry.resourceName,
              namespace: entry.namespace,
            });
          }
        }

        await recordSimulationStep({
          simulationId: sim.id,
          failureType: sim.failureType,
          name: workerHasErrors ? 'Startup Recovery Completed with Errors' : 'Startup Recovery Complete',
          stepType: 'rollback',
          phase: 'recovery',
          status: workerHasErrors ? 'failed' : 'success',
          durationMs: Date.now() - workerStartMs,
          message: workerHasErrors
            ? '[Worker] Startup recovery finished with errors — some resources may need manual intervention'
            : '[Worker] Startup recovery finished successfully',
        });

        const workerFinalState = workerHasErrors ? ('rolled_back' as ExperimentState) : ('completed' as ExperimentState);

        await prisma.simulation.update({
          where: { id: sim.id },
          data: { state: workerFinalState, completedAt: new Date() },
        });

        await prisma.failureEvent.updateMany({
          where: { simulationId: sim.id, state: 'running' },
          data: {
            state: workerHasErrors ? 'rolled_back' : 'completed',
            endedAt: new Date(),
            errorMessage: workerHasErrors
              ? 'Recovered from worker restart; rollback completed with errors.'
              : 'Recovered from worker restart; rollback executed.',
          },
        });

        await prisma.report.create({
          data: {
            simulationId: sim.id,
            summary: workerHasErrors ? 'Recovered from worker restart (with errors)' : 'Recovered from worker restart',
            result: workerHasErrors ? 'rolled_back' : 'completed',
            failureType: sim.failureType,
            method: 'unknown',
            namespace: sim.namespace,
            durationSeconds: sim.durationSeconds,
            startedAt: sim.startedAt ?? new Date(),
            endedAt: new Date(),
            errors: workerHasErrors
              ? 'Simulation orphaned after worker crash/restart; rollback executed with errors.'
              : null,
          } as any,
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
        console.log(`[Simulator:${s.id}] [Timeout] Janitor: Triggering force-rollback for stale RUNNING simulation (>10m).`);
        void rollbackAndFailStaleSimulation(s.id).catch(err => {
          console.error(`[Simulator:${s.id}] [Timeout] Janitor: Failed to rollback stale simulation:`, err);
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
          void rollbackAndFailStaleSimulation(s.id).catch(err => {
            console.error(`[Simulator:${s.id}] [Timeout] Janitor: Failed to emergency rollback stale simulation:`, err);
          });
        }
      }

      // 3. Fetch QUEUED first (priority), then PENDING
      let candidates = await prisma.simulation.findMany({
        where: { state: 'queued' as any },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      if (candidates.length < 10) {
        const pending = await prisma.simulation.findMany({
          where: { state: 'pending' as any },
          orderBy: { createdAt: 'asc' },
          take: 10 - candidates.length,
        });
        candidates = [...candidates, ...pending];
      }

      if (candidates.length === 0) {
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
        void runSimulation(sim.id).catch(async (e) => {
          console.error(`[Simulator:${sim.id}] [Worker] Execution failed:`, e);
          try {
            const current = await prisma.simulation.findUnique({ where: { id: sim.id } });
            if (current && ['pending', 'queued'].includes(current.state)) {
              await prisma.simulation.update({
                where: { id: sim.id },
                data: { state: 'failed', completedAt: new Date() }
              });
              await prisma.failureEvent.updateMany({
                where: { simulationId: sim.id, state: { in: ['pending', 'running'] } as any },
                data: { state: 'failed', endedAt: new Date(), errorMessage: e?.message ?? String(e) }
              });
            }
          } catch (dbErr) {
            console.error(`[Simulator:${sim.id}] [Worker] Failed to mark simulation as failed:`, dbErr);
          }
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
