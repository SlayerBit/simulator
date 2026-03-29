import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPrismaClient } from '../database/client.js';
import { authMiddleware } from '../auth/service.js';

export const metricsRouter = Router();

metricsRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const totalSimulations = await prisma.simulation.count();
  const activeSimulations = await prisma.simulation.count({ where: { state: 'running' } as any });
  const successfulSimulations = await prisma.simulation.count({ where: { state: 'completed' } as any });
  const failedSimulations = await prisma.simulation.count({ where: { state: 'failed' } as any });
  const rolledBackSimulations = await prisma.simulation.count({ where: { state: 'rolled_back' } as any });
  const cancelledSimulations = await prisma.simulation.count({ where: { state: 'cancelled' } as any });

  const byTypeRaw = await prisma.simulation.groupBy({ by: ['failureType'], _count: { _all: true } } as any);
  const perFailureTypeCounts = Object.fromEntries(byTypeRaw.map((r: any) => [r.failureType, r._count._all]));

  const reports = await prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: 200 } as any);
  const avgDurationSeconds =
    reports.length === 0
      ? 0
      : Math.round(
          reports.reduce((acc: number, r: any) => acc + Math.max(0, (new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000), 0) /
            reports.length,
        );
  const avgRecoveryTimeSeconds =
    reports.length === 0 ? 0 : Math.round(reports.reduce((acc: number, r: any) => acc + (r.recoveryTimeSeconds ?? 0), 0) / reports.length);

  res.json({
    totalSimulations,
    activeSimulations,
    successfulSimulations,
    failedSimulations,
    rolledBackSimulations,
    cancelledSimulations,
    avgDurationSeconds,
    avgRecoveryTimeSeconds,
    perFailureTypeCounts,
  });
});

metricsRouter.get('/prometheus', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const totalSimulations = await prisma.simulation.count();
  const activeSimulations = await prisma.simulation.count({ where: { state: 'running' } as any });
  const successfulSimulations = await prisma.simulation.count({ where: { state: 'completed' } as any });
  const failedSimulations = await prisma.simulation.count({ where: { state: 'failed' } as any });
  const rolledBackSimulations = await prisma.simulation.count({ where: { state: 'rolled_back' } as any });
  const cancelledSimulations = await prisma.simulation.count({ where: { state: 'cancelled' } as any });

  const lines = [
    `simulator_total_simulations ${totalSimulations}`,
    `simulator_successful_simulations ${successfulSimulations}`,
    `simulator_failed_simulations ${failedSimulations}`,
    `simulator_rolledback_simulations ${rolledBackSimulations}`,
    `simulator_active_simulations ${activeSimulations}`,
    `simulator_cancelled_simulations ${cancelledSimulations}`,
    '',
  ];
  res.type('text/plain').send(lines.join('\n'));
});
