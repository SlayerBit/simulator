import cron, { type ScheduledTask } from 'node-cron';
import { getPrismaClient } from '../database/client.js';
import { createSimulationRecord, runSimulation, createSimulationName } from '../simulations/service.js';
import { assertVisibleFailureMethod, templateIsAllowlisted } from '../failures/allowlist.js';

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
      if (!templateIsAllowlisted(template)) {
        console.warn(`[Scheduler] Skipping non-allowlisted template ${template.id}`);
        return;
      }

      const admin = await db.user.findFirst({ where: { role: 'admin' } });
      if (!admin) return;

      const input: any = template.config || {};
      const method = input.method || 'delete-pods';
      try {
        assertVisibleFailureMethod(template.failureType, method);
      } catch {
        console.warn(`[Scheduler] Skipping template ${template.id} — method not on production allowlist`);
        return;
      }
      const sim = await createSimulationRecord(
        { id: admin.id, email: admin.email, role: 'admin' as any },
        {
          name: createSimulationName(`sched-${template.name}`),
          failureType: template.failureType as any,
          method,
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
      void runSimulation(sim.id).catch(async (e) => {
        console.error(`[Scheduler] Failed to run scheduled simulation ${sim.id}:`, e);
        await db.auditLog.create({
          data: {
            userId: admin.id,
            action: 'simulation.run_failed',
            simulationId: sim.id,
            metadata: { error: e?.message ?? String(e), source: 'scheduler' },
          },
        });
      });
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
