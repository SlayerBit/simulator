import { recordSimulationStep } from '../simulations/steps.js';

export interface RollbackAction {
  name: string;
  description?: string;
  command?: string;
  run: (signal?: AbortSignal) => Promise<void>;
}

export class RollbackStack {
  private actions: RollbackAction[] = [];

  push(action: RollbackAction): void {
    this.actions.push(action);
  }

  get size(): number {
    return this.actions.length;
  }

  async rollbackAll(
    simulationId: string,
    failureType: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Phase 1: Recovery Triggered log
    await recordSimulationStep({
      simulationId,
      name: 'Recovery Phase Started',
      failureType,
      stepType: 'rollback',
      status: 'success',
      message: 'Self-healing context initialized. Dispatched restoration sequence.',
    });

    // Process in reverse order (LIFO). Do not bail early when signal is aborted: still attempt
    // later steps (#8 — best-effort restore; failures are aggregated).
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const action = this.actions[i];
      if (!action) continue;

      const actionStart = Date.now();
      await recordSimulationStep({
        simulationId,
        name: `Restoring: ${action.name}`,
        failureType,
        stepType: 'rollback',
        status: 'running',
        command: action.command ?? null,
        message: action.description ?? `Executing restoration step: ${action.name}`,
      });

      let success = false;
      let lastError: any = null;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await action.run(signal);
          success = true;
          break;
        } catch (e: any) {
          lastError = e;
          // ISSUE-009: Detect AbortError by both name and message since new Error('AbortError')
          // sets name='Error', not 'AbortError'. Stop retrying on abort.
          const isAbort = e?.name === 'AbortError' || e?.message === 'AbortError';
          if (isAbort) {
            success = false;
            break;
          }
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[Rollback] Action "${action.name}" failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, e?.message ?? e);

            // Wait with abort support. If abort fires during the delay, stop retrying.
            try {
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, delay);
                if (signal?.aborted) {
                  clearTimeout(t);
                  reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
                  return;
                }
                signal?.addEventListener('abort', () => {
                  clearTimeout(t);
                  reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
                }, { once: true });
              });
            } catch (abortErr: any) {
              lastError = abortErr;
              success = false;
              break;
            }
          }
        }
      }

      if (success) {
        await recordSimulationStep({
          simulationId,
          name: `Restored: ${action.name}`,
          failureType,
          stepType: 'rollback',
          status: 'success',
          command: action.command ?? null,
          message: `Successfully completed: ${action.name}`,
          durationMs: Date.now() - actionStart,
        });
      } else {
        errors.push(`${action.name}: ${lastError?.message ?? String(lastError)} (failed after ${maxRetries} attempts)`);
        console.error(`[Rollback] Action "${action.name}" failed permanently after ${maxRetries} attempts.`);

        await recordSimulationStep({
          simulationId,
          name: `Failed: ${action.name}`,
          failureType,
          stepType: 'rollback',
          status: 'failed',
          command: action.command ?? null,
          error: lastError?.message ?? String(lastError),
          durationMs: Date.now() - actionStart,
        });
      }
    }

    // Final lifecycle log
    await recordSimulationStep({
      simulationId,
      name: errors.length === 0 ? 'Recovery Phase Completed' : 'Recovery Phase Partial Failure',
      failureType,
      stepType: 'rollback',
      status: errors.length === 0 ? 'success' : 'failed',
      message: errors.length === 0 
        ? 'System fully restored to stable state.' 
        : `Recovery completed with ${errors.length} errors. Manual intervention may be required.`,
    });

    return { ok: errors.length === 0, errors };
  }
}
