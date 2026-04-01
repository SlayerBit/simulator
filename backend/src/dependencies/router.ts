import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const dependenciesRouter = Router();

// GET /api/dependencies
dependenciesRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const edges = await prisma.dependencyEdge.findMany({ orderBy: { createdAt: 'desc' } });
  const services = Array.from(
    new Set(edges.flatMap((e: { fromService: string; toService: string }) => [
      e.fromService,
      e.toService,
    ]))
  ).sort();
  return res.json({
    services,
    edges,
  });
});

// POST /api/dependencies
dependenciesRouter.post('/', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const { fromService, toService, description } = req.body;

  try {
    const edge = await prisma.dependencyEdge.create({
      data: {
        fromService,
        toService,
        description: description || '',
      },
    });
    return res.status(201).json({ edge });
  } catch (err: any) {
    return res.status(400).json({ error: { message: err.message } });
  }
});

// DELETE /api/dependencies/:id
dependenciesRouter.delete('/:id', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  await prisma.dependencyEdge.delete({ where: { id } });
  return res.status(204).send();
});
