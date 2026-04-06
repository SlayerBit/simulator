import { getPrismaClient } from '../database/client.js';

// Per-simulation step counters — prevents ordering collisions in concurrent runs.
const simStepCounters = new Map<string, number>();

function nextOrder(simulationId: string): number {
    const n = (simStepCounters.get(simulationId) ?? 0) + 1;
    simStepCounters.set(simulationId, n);
    return n;
}

export function clearSimStepCounter(simulationId: string): void {
    simStepCounters.delete(simulationId);
}

export async function recordSimulationStep(params: {
    simulationId: string;
    name: string;
    failureType: string;
    stepType: 'validation' | 'execution' | 'rollback';
    /** Optional lifecycle phase tag for UI grouping */
    phase?: 'pre-flight' | 'chaos' | 'recovery';
    status: 'pending' | 'running' | 'success' | 'failed' | 'rolled_back';
    command?: string | null;
    message?: string | null;
    error?: string | null;
    resourceType?: string | null;
    resourceName?: string | null;
    namespace?: string | null;
    durationMs?: number | null;
}): Promise<void> {
    const prisma = getPrismaClient();
    try {
        await prisma.simulationStep.create({
            data: {
                ...params,
                order: nextOrder(params.simulationId),
            },
        });
    } catch (e) {
        console.error(`[Simulator] Failed to record step "${params.name}":`, e);
    }
}
