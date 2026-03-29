import cron, { type ScheduledTask } from 'node-cron';
import { getPrismaClient } from '../database/client.js';
import { createSimulationRecord, runSimulation, createSimulationName } from '../simulations/service.js';

const tasks = new Map<string, ScheduledTask>();

export async function refreshSchedules(): Promise<void> {
  const prisma = getPrismaClient();
  const schedules = await prisma.schedule.findMany({ where: { enabled: true } });
  const existingIds = new Set(tasks.keys());

  for (const sched of schedules) {
    existingIds.delete(sched.id);
    if (tasks.has(sched.id)) continue;

    if (!cron.validate(sched.cronExpression)) continue;

    const task = cron.schedule(sched.cronExpression, async () => {
      const db = getPrismaClient();
      if (!sched.templateId) return;
      const template = await db.template.findUnique({ where: { id: sched.templateId } });
      if (!template) return;

      const admin = await db.user.findFirst({ where: { role: 'admin' } });
      if (!admin) return;

      const input: any = template.config || {};
      const sim = await createSimulationRecord(
        { id: admin.id, email: admin.email, role: 'admin' as any },
        {
          name: createSimulationName(`sched-${template.name}`),
          failureType: template.failureType as any,
          method: input.method || 'delete-pods',
          target: {
            namespace: template.defaultNamespace || input.namespace || 'simulator',
            serviceName: template.defaultService || input.serviceName,
            deploymentName: input.deploymentName,
            labelSelector: input.labelSelector,
          },
          durationSeconds: template.defaultDurationSeconds || input.durationSeconds || 60,
          intensityPercent: template.defaultIntensity ? Number(template.defaultIntensity) : input.intensityPercent,
          latencyMs: input.latencyMs,
          packetLossPercent: input.packetLossPercent,
          dryRun: Boolean(input.dryRun ?? true),
        },
      );
      void runSimulation(sim.id);
    });

    tasks.set(sched.id, task);
  }

  // Stop removed schedules
  for (const id of existingIds) {
    const t = tasks.get(id);
    if (t) t.stop();
    tasks.delete(id);
  }
}

export async function startScheduler(): Promise<void> {
  await refreshSchedules();
  // Refresh every minute to pick up DB changes.
  cron.schedule('*/1 * * * *', async () => {
    await refreshSchedules();
  });
}
