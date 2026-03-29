type Id = string;

export function createMockPrisma() {
  const users: any[] = [];
  const simulations: any[] = [];
  const failureEvents: any[] = [];
  const recoveryActions: any[] = [];
  const reports: any[] = [];
  const auditLogs: any[] = [];
  const templates: any[] = [];
  const schedules: any[] = [];

  const now = () => new Date();
  const id = () => Math.random().toString(36).slice(2);

  return {
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.email === where.email || u.id === where.id) ?? null,
      findFirst: async ({ where }: any) => users.find((u) => (where?.role ? u.role === where.role : true)) ?? null,
      create: async ({ data }: any) => {
        const u = { id: id(), createdAt: now(), updatedAt: now(), ...data };
        users.push(u);
        return u;
      },
    },
    simulation: {
      create: async ({ data }: any) => {
        const s = { id: id(), createdAt: now(), updatedAt: now(), ...data };
        simulations.push(s);
        return s;
      },
      findUnique: async ({ where }: any) => simulations.find((s) => s.id === where.id) ?? null,
      findMany: async ({ where }: any) => {
        if (!where || Object.keys(where).length === 0) return simulations.slice();
        if (where.createdById) return simulations.filter((s) => s.createdById === where.createdById);
        return simulations.slice();
      },
      update: async ({ where, data }: any) => {
        const idx = simulations.findIndex((s) => s.id === where.id);
        if (idx < 0) throw new Error('not found');
        simulations[idx] = { ...simulations[idx], ...data, updatedAt: now() };
        return simulations[idx];
      },
    },
    failureEvent: {
      create: async ({ data }: any) => {
        const e = { id: id(), ...data };
        failureEvents.push(e);
        return e;
      },
      findFirst: async ({ where }: any) => failureEvents.find((e) => e.simulationId === where.simulationId) ?? null,
      findMany: async ({ where }: any) => failureEvents.filter((e) => e.simulationId === where.simulationId),
      updateMany: async ({ where, data }: any) => {
        for (let i = 0; i < failureEvents.length; i++) {
          if (failureEvents[i].simulationId === where.simulationId) failureEvents[i] = { ...failureEvents[i], ...data };
        }
        return { count: 1 };
      },
    },
    recoveryAction: {
      create: async ({ data }: any) => {
        const r = { id: id(), startedAt: now(), ...data };
        recoveryActions.push(r);
        return r;
      },
      findMany: async ({ where }: any) => recoveryActions.filter((r) => r.simulationId === where.simulationId),
    },
    report: {
      create: async ({ data }: any) => {
        const r = { id: id(), createdAt: now(), ...data };
        reports.push(r);
        return r;
      },
      findMany: async ({ where }: any) => reports.filter((r) => r.simulationId === where.simulationId),
    },
    auditLog: {
      create: async ({ data }: any) => {
        const a = { id: id(), createdAt: now(), ...data };
        auditLogs.push(a);
        return a;
      },
      findMany: async ({ where }: any) => {
        if (!where || Object.keys(where).length === 0) return auditLogs.slice();
        if (where.userId) return auditLogs.filter((a) => a.userId === where.userId);
        return auditLogs.slice();
      },
    },
    template: {
      findMany: async () => templates.slice(),
      findUnique: async ({ where }: any) => templates.find((t) => t.id === where.id) ?? null,
    },
    schedule: {
      findMany: async ({ where }: any) => schedules.filter((s) => (where?.enabled ? s.enabled === true : true)),
    },
    __data: { users, simulations, failureEvents, recoveryActions, reports, auditLogs, templates, schedules },
  };
}

