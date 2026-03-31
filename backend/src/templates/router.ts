import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';
import { createSimulationName, createSimulationRecord, runSimulation } from '../simulations/service.js';

export const templatesRouter = Router();

// GET /api/templates
templatesRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const templates = await prisma.template.findMany({ 
    include: { schedules: true },
    orderBy: { name: 'asc' } 
  });
  return res.json({ templates });
});

// GET /api/templates/:id
templatesRouter.get('/:id', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const template = await prisma.template.findUnique({ where: { id: String(req.params.id) } });
  if (!template) return res.status(404).json({ error: { message: 'Template not found' } });
  return res.json({ template });
});

// POST /api/templates
templatesRouter.post('/', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const { name, description, failureType, defaultNamespace, defaultService, defaultIntensity, defaultDurationSeconds, config } = req.body;
  
  try {
    const template = await prisma.template.create({
      data: {
        name,
        description: description || '',
        failureType,
        defaultNamespace,
        defaultService,
        defaultIntensity: String(defaultIntensity || ''),
        defaultDurationSeconds: Number(defaultDurationSeconds || 60),
        config: config || {},
      },
    });
    return res.status(201).json({ template });
  } catch (err: any) {
    return res.status(400).json({ error: { message: err.message } });
  }
});

// PATCH /api/templates/:id
templatesRouter.patch('/:id', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const data = req.body;

  try {
    const template = await prisma.template.update({
      where: { id },
      data: {
        ...data,
        defaultDurationSeconds: data.defaultDurationSeconds ? Number(data.defaultDurationSeconds) : undefined,
      },
    });
    return res.json({ template });
  } catch (err: any) {
    return res.status(400).json({ error: { message: err.message } });
  }
});

// DELETE /api/templates/:id
templatesRouter.delete('/:id', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  await prisma.template.delete({ where: { id } });
  return res.status(204).send();
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
