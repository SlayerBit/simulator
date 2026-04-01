export interface RollbackAction {
  name: string;
  run: () => Promise<void>;
}

export class RollbackStack {
  private actions: RollbackAction[] = [];

  push(action: RollbackAction): void {
    this.actions.push(action);
  }

  get size(): number {
    return this.actions.length;
  }

  async rollbackAll(): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    // Process in reverse order (LIFO)
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const action = this.actions[i];
      if (!action) continue;

      let success = false;
      let lastError: any = null;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await action.run();
          success = true;
          break;
        } catch (e: any) {
          lastError = e;
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[Rollback] Action "${action.name}" failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, e?.message ?? e);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        errors.push(`${action.name}: ${lastError?.message ?? String(lastError)} (failed after ${maxRetries} attempts)`);
        console.error(`[Rollback] Action "${action.name}" failed permanently after ${maxRetries} attempts.`);
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
