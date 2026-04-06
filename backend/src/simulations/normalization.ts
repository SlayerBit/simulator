import type { FailureMethod, FailureParams } from '../failures/types.js';
import { getPrismaClient } from '../database/client.js';

export interface DefaultsApplied {
  intensityPercent?: number;
  latencyMs?: number;
  packetLossPercent?: number;
  durationSeconds?: number;
}

export interface NormalizationResult {
  params: FailureParams;
  defaultsApplied: DefaultsApplied;
  resolvedIntensityLabel: string | null;
}

/**
 * Applies safe defaults from method.requirements.safeDefaults for any
 * optional numeric field that was not supplied by the caller.
 *
 * Also fixes the packetLossPercent parse collision: intensity is stored as
 * a single string with three encodings:
 *   "30"      → intensityPercent = 30
 *   "200ms"   → latencyMs = 200
 *   "10%"     → packetLossPercent = 10  (was previously parsed same as intensityPercent)
 *
 * Writes the resolved durationSeconds + intensity back to the Simulation row.
 */
export async function normalizeAndSaveParameters(
  simulationId: string,
  method: FailureMethod,
  rawParams: FailureParams
): Promise<NormalizationResult> {
  const result: FailureParams = { ...rawParams };
  const defaultsApplied: DefaultsApplied = {};
  const defaults = method.requirements?.safeDefaults;

  console.log(
    `[Simulator:${simulationId}] [Normalize] Raw params → ` +
    `intensityPercent=${rawParams.intensityPercent ?? 'nil'}, ` +
    `latencyMs=${rawParams.latencyMs ?? 'nil'}, ` +
    `packetLossPercent=${rawParams.packetLossPercent ?? 'nil'}, ` +
    `durationSeconds=${rawParams.durationSeconds}`
  );

  if (defaults) {
    if (result.intensityPercent === undefined && defaults.intensityPercent !== undefined) {
      result.intensityPercent = defaults.intensityPercent;
      defaultsApplied.intensityPercent = defaults.intensityPercent;
      console.log(`[Simulator:${simulationId}] [Normalize] Applied default intensityPercent=${defaults.intensityPercent}`);
    }
    if (result.latencyMs === undefined && defaults.latencyMs !== undefined) {
      result.latencyMs = defaults.latencyMs;
      defaultsApplied.latencyMs = defaults.latencyMs;
      console.log(`[Simulator:${simulationId}] [Normalize] Applied default latencyMs=${defaults.latencyMs}`);
    }
    if (result.packetLossPercent === undefined && defaults.packetLossPercent !== undefined) {
      result.packetLossPercent = defaults.packetLossPercent;
      defaultsApplied.packetLossPercent = defaults.packetLossPercent;
      console.log(`[Simulator:${simulationId}] [Normalize] Applied default packetLossPercent=${defaults.packetLossPercent}`);
    }
    if (result.durationSeconds === undefined && defaults.durationSeconds !== undefined) {
      result.durationSeconds = defaults.durationSeconds;
      defaultsApplied.durationSeconds = defaults.durationSeconds;
      console.log(`[Simulator:${simulationId}] [Normalize] Applied default durationSeconds=${defaults.durationSeconds}`);
    }
  }

  // Warn if a required numeric param is still absent after defaults
  const reqs = method.requirements ?? {};
  if (reqs.requiresLatencyMs && result.latencyMs === undefined) {
    console.warn(`[Simulator:${simulationId}] [Normalize] WARNING: requiresLatencyMs=true but latencyMs is still undefined after normalization`);
  }
  if (reqs.requiresIntensityPercent && result.intensityPercent === undefined) {
    console.warn(`[Simulator:${simulationId}] [Normalize] WARNING: requiresIntensityPercent=true but intensityPercent is still undefined after normalization`);
  }
  if (reqs.requiresPacketLossPercent && result.packetLossPercent === undefined) {
    console.warn(`[Simulator:${simulationId}] [Normalize] WARNING: requiresPacketLossPercent=true but packetLossPercent is still undefined after normalization`);
  }

  // Build intensity label for storage — priority: latencyMs > packetLossPercent > intensityPercent
  let resolvedIntensityLabel: string | null = null;
  if (result.latencyMs !== undefined) {
    resolvedIntensityLabel = `${result.latencyMs}ms`;
  } else if (result.packetLossPercent !== undefined) {
    resolvedIntensityLabel = `${result.packetLossPercent}%`;
  } else if (result.intensityPercent !== undefined) {
    resolvedIntensityLabel = String(result.intensityPercent);
  }

  console.log(
    `[Simulator:${simulationId}] [Normalize] Resolved → ` +
    `intensityPercent=${result.intensityPercent ?? 'nil'}, ` +
    `latencyMs=${result.latencyMs ?? 'nil'}, ` +
    `packetLossPercent=${result.packetLossPercent ?? 'nil'}, ` +
    `intensityLabel="${resolvedIntensityLabel ?? 'nil'}"`
  );

  const defaultsStr = Object.keys(defaultsApplied).length > 0
    ? JSON.stringify(defaultsApplied)
    : 'none';
  console.log(`[Simulator:${simulationId}] [Normalize] Defaults applied: ${defaultsStr}`);

  const prisma = getPrismaClient();
  await prisma.simulation.update({
    where: { id: simulationId },
    data: {
      durationSeconds: result.durationSeconds,
      intensity: resolvedIntensityLabel,
    },
  });

  return { params: result, defaultsApplied, resolvedIntensityLabel };
}
