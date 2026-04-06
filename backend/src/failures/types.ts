import type { FailureType, SimulationTarget } from '../types/domain.js';
import type { RollbackStack } from '../recovery/rollback.js';

export interface FailureParams {
  failureType: FailureType;
  method: string;
  target: SimulationTarget;
  durationSeconds: number;
  intensityPercent?: number | undefined;
  latencyMs?: number | undefined;
  packetLossPercent?: number | undefined;
  dryRun: boolean;
  simulationId: string;
  rollback: RollbackStack;
  signal?: AbortSignal;
}

export interface FailureResult {
  applied: boolean;
  message: string;
}

export interface MethodRequirements {
  requiresNamespace?: boolean;
  requiresDeployment?: boolean;
  requiresLabelSelector?: boolean;
  requiresService?: boolean;
  requiresPod?: boolean;
  requiresDuration?: boolean;
  /** Set to true when the method reads and relies on latencyMs */
  requiresLatencyMs?: boolean;
  /** Set to true when the method reads and relies on intensityPercent */
  requiresIntensityPercent?: boolean;
  /** Set to true when the method reads and relies on packetLossPercent */
  requiresPacketLossPercent?: boolean;
  safeDefaults?: {
    intensityPercent?: number;
    latencyMs?: number;
    packetLossPercent?: number;
    durationSeconds?: number;
  };
}

export interface FailureMethod {
  id: string;
  title: string;
  supports: FailureType;
  requirements: MethodRequirements;
  validate: (params: FailureParams) => Promise<void>;
  apply: (params: FailureParams) => Promise<FailureResult>;
  rollback: (params: FailureParams) => Promise<void>;
}
