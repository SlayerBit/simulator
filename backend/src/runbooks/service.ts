import { getPrismaClient } from '../database/client.js';
import { loadConfig } from '../config/env.js';
import { recordSimulationStep } from '../simulations/steps.js';

type AgentRunbookPayload = {
  incident_type?: string;
  incidentType?: string;
  severity?: string;
  [key: string]: any;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSerializable<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function extractIncidentType(payload: AgentRunbookPayload): string {
  return String(payload.incident_type ?? payload.incidentType ?? 'Unknown Failure');
}

function extractSeverity(payload: AgentRunbookPayload): string {
  return String(payload.severity ?? 'unknown');
}

export async function captureRunbookForSimulation(simulationId: string): Promise<void> {
  const prisma = getPrismaClient();
  const cfg = loadConfig();

  const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
  const durationSeconds = Math.max(0, sim?.durationSeconds ?? 0);
  // Keep stabilization short so brief outages are still observed, but scale slightly with the hold window.
  const stabilizationSeconds = Math.min(6, Math.max(0.5, durationSeconds * 0.12));
  const maxDelayMs = Math.max(0, durationSeconds * 1000 - Math.round(stabilizationSeconds * 1000) - 250);
  const effectiveDelayMs = Math.min(cfg.agent1AnalyzeDelayMs, maxDelayMs);

  await recordSimulationStep({
    simulationId,
    name: 'agent_analysis_scheduled',
    failureType: 'agent_analysis',
    stepType: 'execution',
    phase: 'chaos',
    status: 'running',
    message: `Agent 1 analysis scheduled in ${Math.round(effectiveDelayMs / 1000)}s (stabilization=${stabilizationSeconds.toFixed(
      1,
    )}s) for duration=${durationSeconds}s`,
  });

  await sleep(effectiveDelayMs);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(cfg.agent1AnalyzeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stabilization_seconds: stabilizationSeconds }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Agent1 analyze failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as AgentRunbookPayload;
    const serializedPayload = toSerializable(payload);
    const incidentType = extractIncidentType(payload);
    const severity = extractSeverity(payload);

    await prisma.agentRunbook.create({
      data: {
        simulationId,
        incidentType,
        severity,
        payload: serializedPayload as any,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'runbook.generated',
        simulationId,
        metadata: {
          source: 'agent1-live',
          incidentType,
          severity,
        } as any,
      },
    });

    await recordSimulationStep({
      simulationId,
      name: 'agent_analysis_completed',
      failureType: 'agent_analysis',
      stepType: 'execution',
      phase: 'recovery',
      status: 'success',
      message: `Runbook captured from Agent 1: incident=${incidentType}, severity=${severity}`,
    });
  } catch (error: any) {
    await prisma.auditLog.create({
      data: {
        action: 'runbook.generation_failed',
        simulationId,
        metadata: {
          source: 'agent1-live',
          error: error?.message ?? String(error),
        } as any,
      },
    });

    await recordSimulationStep({
      simulationId,
      name: 'agent_analysis_failed',
      failureType: 'agent_analysis',
      stepType: 'execution',
      phase: 'recovery',
      status: 'failed',
      error: error?.message ?? String(error),
      message: 'Agent 1 analysis failed',
    });
  } finally {
    clearTimeout(timer);
  }
}

export function scheduleRunbookCapture(simulationId: string): void {
  void captureRunbookForSimulation(simulationId).catch((error) => {
    // Last-resort guard to avoid unhandled promise rejections from fire-and-forget orchestration.
    // eslint-disable-next-line no-console
    console.error(`[Runbook:${simulationId}] Unhandled capture failure`, error);
  });
}
