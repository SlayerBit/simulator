import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';
import type { FailureType } from '../types/domain.js';
import { createSimulationName, createSimulationRecord, runSimulation, stopSimulation, rollbackSimulation } from './service.js';
import { assertVisibleFailureMethod } from '../failures/allowlist.js';

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
  manualRollback: z.boolean().default(false),
});

// POST /api/simulations
simulationsRouter.post('/', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const parsed = CreateSimulationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { message: 'Invalid request', details: parsed.error.flatten() } });
  }

  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  const config = await import('../config/env.js').then(m => m.loadConfig());

  const name = parsed.data.name ?? createSimulationName();
  assertVisibleFailureMethod(parsed.data.failureType, parsed.data.method);
  const sim = await createSimulationRecord(user, {
    ...parsed.data,
    name,
  });

  // Fire-and-forget execution
  // BUG-29 fix: Mark simulation as failed if runSimulation throws before claim.
  void runSimulation(sim.id).catch(async (e) => {
    try {
      const current = await prisma.simulation.findUnique({ where: { id: sim.id } });
      if (current && ['pending', 'queued'].includes(current.state)) {
        await prisma.simulation.update({
          where: { id: sim.id },
          data: { state: 'failed', completedAt: new Date() }
        });
      }
    } catch { }
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

// POST /api/simulations/:id/rollback
simulationsRouter.post('/:id/rollback', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;
  try {
    await rollbackSimulation(id, user);
    return res.status(200).json({ id, status: 'completed' });
  } catch (e: any) {
    return res.status(400).json({ error: { message: e.message ?? String(e) } });
  }
});

// GET /api/simulations/meta
simulationsRouter.get('/meta', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const { getVisibleFailureMethods } = await import('../failures/registry.js');
  const methods = getVisibleFailureMethods().map(m => ({
    id: m.id,
    title: m.title,
    supports: m.supports,
    requirements: m.requirements || {}
  }));
  return res.json({ methods });
});

// GET /api/simulations
simulationsRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  const skip = (page - 1) * limit;

  const where =
    user.role === 'admin'
      ? {}
      : {
        createdById: user.id,
      };

  const [sims, total] = await Promise.all([
    prisma.simulation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.simulation.count({ where })
  ]);

  return res.json({
    simulations: sims,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
});

// GET /api/simulations/:id
simulationsRouter.get('/:id', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;

  const sim = await prisma.simulation.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { timestamp: 'asc' } },
      failureEvents: { orderBy: { startedAt: 'asc' } },
      recoveryActions: { orderBy: { startedAt: 'asc' } },
      reports: { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  });

  if (!sim) return res.status(404).json({ error: { message: 'Not found' } });
  if (user.role !== 'admin' && sim.createdById !== user.id) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }

  return res.json({
    simulation: sim,
    steps: sim.steps,
    failureEvents: sim.failureEvents,
    recoveryActions: sim.recoveryActions,
    report: sim.reports[0] ?? null
  });
});

// POST /api/simulations/:id/retry
simulationsRouter.post('/:id/retry', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;

  // ISSUE-013: Wrap the terminal-state check and new simulation creation in a single
  // transaction so concurrent retry requests cannot both pass the guard and create
  // duplicate simulations for the same original simulation.
  let newSim: any = null;
  try {
    newSim = await prisma.$transaction(async (tx: typeof prisma) => {
      const sim = await tx.simulation.findUnique({ where: { id } });
      if (!sim) {
        const e: any = new Error('Not found'); e.status = 404; throw e;
      }
      if (user.role !== 'admin' && sim.createdById !== user.id) {
        const e: any = new Error('Forbidden'); e.status = 403; throw e;
      }
      if (!['completed', 'failed', 'cancelled', 'rolled_back', 'rollback_failed'].includes(sim.state)) {
        const e: any = new Error('Simulation is still active and cannot be retried'); e.status = 409; throw e;
      }
      if (sim.isRollbackable) {
        const e: any = new Error('Simulation still has pending rollback actions and cannot be retried yet'); e.status = 409; throw e;
      }

      // Fetch original failure event so we clone the method name.
      const origEvent = await tx.failureEvent.findFirst({ where: { simulationId: id } });

      const created = await tx.simulation.create({
        data: {
          name: `${sim.name}-retry`,
          failureType: sim.failureType,
          state: 'pending',
          namespace: sim.namespace,
          targetService: sim.targetService ?? null,
          targetDeployment: sim.targetDeployment ?? null,
          targetPod: sim.targetPod ?? null,
          labelSelector: sim.labelSelector ?? null,
          intensity: sim.intensity ?? null,
          durationSeconds: sim.durationSeconds,
          dryRun: sim.dryRun,
          manualRollback: sim.manualRollback,
          createdById: user.id,
        },
      });

      // Clone the FailureEvent so runSimulation can find the method id.
      await tx.failureEvent.create({
        data: {
          simulationId: created.id,
          method: origEvent?.method ?? 'delete-pods',
          state: 'pending',
        },
      });

      return created;
    });
  } catch (e: any) {
    const status = e?.status ?? 500;
    if (status === 404) return res.status(404).json({ error: { message: 'Not found' } });
    if (status === 403) return res.status(403).json({ error: { message: 'Forbidden' } });
    if (status === 409) return res.status(409).json({ error: { message: e.message } });
    throw e;
  }

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

  // BUG-09 fix: Only allow dry-run re-trigger on failed or pending simulations.
  if (['completed', 'running', 'cancelled'].includes(sim.state)) {
    return res.status(409).json({ error: { message: `Cannot re-run dry-run on simulation in '${sim.state}' state` } });
  }

  const updated = await prisma.simulation.update({
    where: { id },
    data: {
      dryRun: true,
      state: 'pending',
      startedAt: null,
      completedAt: null,
    },
  });

  void runSimulation(updated.id);
  return res.status(200).json({ simulation: updated });
});
