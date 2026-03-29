import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const dependenciesRouter = Router();

// GET /api/dependencies
dependenciesRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const edges = await prisma.dependencyEdge.findMany({ orderBy: { createdAt: 'desc' } });
  const services = Array.from(new Set(edges.flatMap((e) => [e.fromService, e.toService]))).sort();
  res.json({
    services,
    edges,
  });
});
