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
    throw new SafetyError('Global kill switch is enabled');
  }

  if (!config.allowedTargetNamespaces.includes(input.target.namespace)) {
    throw new SafetyError('Target namespace is not allowed');
  }

  if (input.durationSeconds > config.maxDurationSeconds) {
    throw new SafetyError('Duration exceeds safety maximum');
  }

  if (typeof input.intensityPercent === 'number' && input.intensityPercent > config.maxIntensityPercent) {
    throw new SafetyError('Intensity exceeds safety maximum');
  }

  if (typeof input.latencyMs === 'number' && input.latencyMs > config.maxLatencyMs) {
    throw new SafetyError('Latency exceeds safety maximum');
  }

  if (typeof input.packetLossPercent === 'number' && input.packetLossPercent > config.maxPacketLossPercent) {
    throw new SafetyError('Packet loss exceeds safety maximum');
  }
}
