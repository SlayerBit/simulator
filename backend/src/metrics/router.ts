import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPrismaClient } from '../database/client.js';
import { authMiddleware } from '../auth/service.js';

export const metricsRouter = Router();

let metricsCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL_MS = 30000;

metricsRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const now = Date.now();
  if (metricsCache && now - metricsCache.timestamp < CACHE_TTL_MS) {
    return res.json(metricsCache.data);
  }

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

  const data = {
    totalSimulations,
    activeSimulations,
    successfulSimulations,
    failedSimulations,
    rolledBackSimulations,
    cancelledSimulations,
    avgDurationSeconds,
    avgRecoveryTimeSeconds,
    perFailureTypeCounts,
  };

  metricsCache = { data, timestamp: now };
  res.json(data);
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
    '# HELP simulator_total_simulations Total number of simulations created',
    '# TYPE simulator_total_simulations counter',
    `simulator_total_simulations ${totalSimulations}`,
    '# HELP simulator_successful_simulations Number of successfully completed simulations',
    '# TYPE simulator_successful_simulations counter',
    `simulator_successful_simulations ${successfulSimulations}`,
    '# HELP simulator_failed_simulations Number of simulations that ended in failure',
    '# TYPE simulator_failed_simulations counter',
    `simulator_failed_simulations ${failedSimulations}`,
    '# HELP simulator_rolledback_simulations Number of simulations that were rolled back',
    '# TYPE simulator_rolledback_simulations counter',
    `simulator_rolledback_simulations ${rolledBackSimulations}`,
    '# HELP simulator_active_simulations Number of simulations currently running',
    '# TYPE simulator_active_simulations gauge',
    `simulator_active_simulations ${activeSimulations}`,
    '# HELP simulator_cancelled_simulations Number of simulations that were cancelled',
    '# TYPE simulator_cancelled_simulations counter',
    `simulator_cancelled_simulations ${cancelledSimulations}`,
    '',
  ];
  res.type('text/plain').send(lines.join('\n'));
});
