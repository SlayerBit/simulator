import { loadConfig } from '../config/env.js';
import type { SimulationTarget } from '../types/domain.js';

export class SafetyError extends Error {
  status = 400;
}

export function assertSafetyGuards(input: {
  target: SimulationTarget;
  durationSeconds: number;
  intensityPercent?: number;
  latencyMs?: number;
  packetLossPercent?: number;
}): void {
  const config = loadConfig();

  if (config.globalKillSwitch) {
    console.error('[Safety] Rejecting simulation: Global kill switch is enabled');
    throw new SafetyError('Global kill switch is enabled');
  }

  if (!config.allowedTargetNamespaces.includes('*') && !config.allowedTargetNamespaces.includes(input.target.namespace)) {
    console.error(`[Safety] Rejecting simulation: namespace "${input.target.namespace}" not in allowed list [${config.allowedTargetNamespaces.join(', ')}]`);
    throw new SafetyError(`Target namespace "${input.target.namespace}" is not allowed by safety configuration.`);
  }

  if (input.durationSeconds > config.maxDurationSeconds) {
    console.error(`[Safety] Rejecting simulation: duration ${input.durationSeconds}s exceeds maximum ${config.maxDurationSeconds}s`);
    throw new SafetyError('Duration exceeds safety maximum');
  }

  if (typeof input.intensityPercent === 'number' && input.intensityPercent > config.maxIntensityPercent) {
    console.error(`[Safety] Rejecting simulation: intensity ${input.intensityPercent}% exceeds maximum ${config.maxIntensityPercent}%`);
    throw new SafetyError('Intensity exceeds safety maximum');
  }

  if (typeof input.latencyMs === 'number' && input.latencyMs > config.maxLatencyMs) {
    console.error(`[Safety] Rejecting simulation: latency ${input.latencyMs}ms exceeds maximum ${config.maxLatencyMs}ms`);
    throw new SafetyError('Latency exceeds safety maximum');
  }

  if (typeof input.packetLossPercent === 'number' && input.packetLossPercent > config.maxPacketLossPercent) {
    console.error(`[Safety] Rejecting simulation: packet loss ${input.packetLossPercent}% exceeds maximum ${config.maxPacketLossPercent}%`);
    throw new SafetyError('Packet loss exceeds safety maximum');
  }
}
