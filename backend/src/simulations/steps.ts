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
    status: 'pending' | 'running' | 'success' | 'failed' | 'rolled_back';
    command?: string;
    message?: string;
    error?: string;
    resourceType?: string;
    resourceName?: string;
    namespace?: string;
    durationMs?: number;
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
