import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const runbooksRouter = Router();

// GET /api/runbooks
runbooksRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  const skip = (page - 1) * limit;

  const where =
    user.role === 'admin'
      ? {}
      : {
          simulation: { createdById: user.id },
        };

  const [rows, total] = await Promise.all([
    prisma.agentRunbook.findMany({
      where: where as any,
      include: {
        simulation: {
          select: { id: true, name: true, createdById: true, failureType: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.agentRunbook.count({ where: where as any }),
  ]);

  return res.json({
    runbooks: rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /api/runbooks/:id
runbooksRouter.get('/:id', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  const id = String(req.params.id);

  const row = await prisma.agentRunbook.findUnique({
    where: { id },
    include: {
      simulation: {
        select: { id: true, name: true, createdById: true, failureType: true },
      },
    },
  });

  if (!row) {
    return res.status(404).json({ error: { message: 'Runbook not found' } });
  }
  if (user.role !== 'admin' && row.simulation?.createdById !== user.id) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }

  return res.json({ runbook: row });
});
