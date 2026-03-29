import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';
import { createSimulationName, createSimulationRecord, runSimulation } from '../simulations/service.js';

export const templatesRouter = Router();

// GET /api/templates
templatesRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const templates = await prisma.template.findMany({ orderBy: { name: 'asc' } });
  return res.json({ templates });
});

// POST /api/templates/:id/run
templatesRouter.post('/:id/run', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const user = (req as RequestWithUser).user!;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) return res.status(404).json({ error: { message: 'Template not found' } });

  const input: any = template.config || {};
  const sim = await createSimulationRecord(user, {
    name: createSimulationName(template.name),
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
  });

  void runSimulation(sim.id);
  return res.status(201).json({ simulation: sim });
});
