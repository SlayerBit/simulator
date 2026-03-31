import type { FailureType, SimulationTarget } from '../types/domain.js';

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
}

export interface FailureResult {
  applied: boolean;
  message: string;
}

export interface FailureMethod {
  id: string;
  title: string;
  supports: FailureType;
  validate: (params: FailureParams) => Promise<void>;
  apply: (params: FailureParams) => Promise<FailureResult>;
  rollback: (params: FailureParams) => Promise<void>;
}
