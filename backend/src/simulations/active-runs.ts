export interface ActiveRun {
  simulationId: string;
  controller: AbortController;
  startedAt: number;
}

const active = new Map<string, ActiveRun>();

export function registerActiveRun(simulationId: string): ActiveRun {
  const existing = active.get(simulationId);
  if (existing) return existing;
  const run: ActiveRun = { simulationId, controller: new AbortController(), startedAt: Date.now() };
  active.set(simulationId, run);
  return run;
}

export function getActiveRun(simulationId: string): ActiveRun | undefined {
  return active.get(simulationId);
}

export function endActiveRun(simulationId: string): void {
  active.delete(simulationId);
}

export function countActiveRuns(): number {
  return active.size;
}

