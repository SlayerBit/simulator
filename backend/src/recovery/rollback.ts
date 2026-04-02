export interface RollbackAction {
  name: string;
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

  async rollbackAll(signal?: AbortSignal): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    // Process in reverse order (LIFO)
    for (let i = this.actions.length - 1; i >= 0; i--) {
      if (signal?.aborted) {
        errors.push(`Rollback aborted by signal at step ${i}`);
        break;
      }
      const action = this.actions[i];
      if (!action) continue;

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
          if (e?.name === 'AbortError') {
            success = false;
            break;
          }
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[Rollback] Action "${action.name}" failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, e?.message ?? e);
            
            // Wait with abort support
            await new Promise((resolve, reject) => {
              const t = setTimeout(resolve, delay);
              signal?.addEventListener('abort', () => {
                clearTimeout(t);
                reject(new Error('AbortError'));
              }, { once: true });
            });
          }
        }
      }

      if (!success) {
        errors.push(`${action.name}: ${lastError?.message ?? String(lastError)} (failed after ${maxRetries} attempts)`);
        console.error(`[Rollback] Action "${action.name}" failed permanently after ${maxRetries} attempts.`);
        if (lastError?.name === 'AbortError') break;
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
