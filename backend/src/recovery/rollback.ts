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
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const action = this.actions[i];
      if (!action) continue;
      try {
        await action.run();
      } catch (e: any) {
        errors.push(`${action.name}: ${e?.message ?? String(e)}`);
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
