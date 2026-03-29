import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';
import type { FailureType } from '../types/domain.js';
import { createSimulationName, createSimulationRecord, runSimulation, stopSimulation } from './service.js';

export const simulationsRouter = Router();

const CreateSimulationSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  failureType: z.string().min(1) as any as z.ZodType<FailureType>,
  method: z.string().min(1).max(64),
  target: z.object({
    namespace: z.string().min(1).max(63),
    serviceName: z.string().min(1).max(63).optional(),
    deploymentName: z.string().min(1).max(63).optional(),
    podName: z.string().min(1).max(253).optional(),
    labelSelector: z.string().min(1).max(256).optional(),
  }),
  durationSeconds: z.number().int().min(5).max(3600),
  intensityPercent: z.number().int().min(1).max(100).optional(),
  latencyMs: z.number().int().min(10).max(60000).optional(),
  packetLossPercent: z.number().int().min(1).max(100).optional(),
  dryRun: z.boolean().default(false),
});

// POST /api/simulations
simulationsRouter.post('/', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const parsed = CreateSimulationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { message: 'Invalid request', details: parsed.error.flatten() } });
  }

  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  const name = parsed.data.name ?? createSimulationName();
  const sim = await createSimulationRecord(user, {
    ...parsed.data,
    name,
  });

  // Fire-and-forget execution
  void runSimulation(sim.id).catch(async (e) => {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'simulation.run_failed',
        simulationId: sim.id,
        metadata: { error: e?.message ?? String(e) },
      },
    });
  });

  return res.status(201).json({ simulation: sim });
});

// POST /api/simulations/:id/stop
simulationsRouter.post('/:id/stop', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;
  const sim = await prisma.simulation.findUnique({ where: { id } });
  if (!sim) return res.status(404).json({ error: { message: 'Not found' } });
  if (user.role !== 'admin' && sim.createdById !== user.id) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  await stopSimulation(id, user);
  return res.status(200).json({ id, status: 'cancelled' });
});

// GET /api/simulations
simulationsRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  const where =
    user.role === 'admin'
      ? {}
      : {
          createdById: user.id,
        };
  const sims = await prisma.simulation.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
  return res.json({ simulations: sims });
});

// GET /api/simulations/:id
simulationsRouter.get('/:id', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;
  const sim = await prisma.simulation.findUnique({ where: { id } });
  if (!sim) return res.status(404).json({ error: { message: 'Not found' } });
  if (user.role !== 'admin' && sim.createdById !== user.id) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  const events = await prisma.failureEvent.findMany({ where: { simulationId: id }, orderBy: { startedAt: 'asc' } });
  const recovery = await prisma.recoveryAction.findMany({ where: { simulationId: id }, orderBy: { startedAt: 'asc' } });
  const reports = await prisma.report.findMany({ where: { simulationId: id }, orderBy: { createdAt: 'desc' }, take: 1 });
  return res.json({ simulation: sim, failureEvents: events, recoveryActions: recovery, report: reports[0] ?? null });
});

// POST /api/simulations/:id/retry
simulationsRouter.post('/:id/retry', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;
  const sim = await prisma.simulation.findUnique({ where: { id } });
  if (!sim) return res.status(404).json({ error: { message: 'Not found' } });
  if (user.role !== 'admin' && sim.createdById !== user.id) return res.status(403).json({ error: { message: 'Forbidden' } });

  const newSim = await prisma.simulation.create({
    data: {
      ...sim,
      id: undefined as any,
      createdAt: undefined as any,
      updatedAt: undefined as any,
      startedAt: null,
      completedAt: null,
      state: 'pending',
      name: `${sim.name}-retry`,
    } as any,
  });
  void runSimulation(newSim.id);
  return res.status(201).json({ simulation: newSim });
});

// POST /api/simulations/:id/dry-run
simulationsRouter.post('/:id/dry-run', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;
  const sim = await prisma.simulation.findUnique({ where: { id } });
  if (!sim) return res.status(404).json({ error: { message: 'Not found' } });
  if (user.role !== 'admin' && sim.createdById !== user.id) return res.status(403).json({ error: { message: 'Forbidden' } });
  const updated = await prisma.simulation.update({ where: { id }, data: { dryRun: true } });
  void runSimulation(updated.id);
  return res.status(200).json({ simulation: updated });
});
